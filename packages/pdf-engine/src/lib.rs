//! Byte-oriented PDF parsing and serialization for Clausid.

mod edit;
mod font;
pub use edit::{Edit, TextBlock};

mod syntax;

#[cfg(target_arch = "wasm32")]
mod wasm;

use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    fmt,
    io::{Read, Write},
};

use syntax::Parser;
pub use syntax::{Dictionary, Reference, Value};

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    Malformed(&'static str),
    Unsupported(&'static str),
    Limit(&'static str),
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(reason) => write!(f, "Malformed PDF: {reason}"),
            Self::Unsupported(reason) => write!(f, "Unsupported PDF: {reason}"),
            Self::Limit(reason) => write!(f, "PDF limit exceeded: {reason}"),
        }
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_OBJECTS: usize = 100_000;

#[derive(Debug)]
pub struct Object<'a> {
    pub value: Value,
    pub stream: Option<&'a [u8]>,
    raw: Option<&'a [u8]>,
}

pub struct Document<'a> {
    bytes: &'a [u8],
    entries: BTreeMap<Reference, Location>,
    pub root: Reference,
    trailer: Dictionary,
    version: &'a [u8],
    decoded_bytes: Cell<usize>,
}

fn offset(number: i64) -> Result<usize> {
    usize::try_from(number).map_err(|_| Error::Malformed("invalid byte offset"))
}

fn object_number(number: i64) -> Result<u32> {
    u32::try_from(number).map_err(|_| Error::Malformed("invalid object number"))
}

fn generation(number: i64) -> Result<u16> {
    u16::try_from(number).map_err(|_| Error::Malformed("invalid object generation"))
}

#[derive(Clone, Copy)]
enum Location {
    Direct(usize),
    Packed { container: u32, index: usize },
}

type XrefEntries = BTreeMap<u32, Option<(u16, Location)>>;

fn integer_field(dict: &Dictionary, key: &[u8]) -> Result<usize> {
    match dict.get(key) {
        Some(Value::Integer(value)) => offset(*value),
        _ => Err(Error::Malformed("missing integer stream field")),
    }
}

fn stream_bytes<'a>(parser: &mut Parser<'a>, length: usize) -> Result<&'a [u8]> {
    if parser.bytes.get(parser.pos) == Some(&b'\r') {
        parser.pos += 1;
        if parser.bytes.get(parser.pos) == Some(&b'\n') {
            parser.pos += 1;
        }
    } else if parser.bytes.get(parser.pos) == Some(&b'\n') {
        parser.pos += 1;
    } else {
        return Err(Error::Malformed("stream missing line ending"));
    }
    let end = parser
        .pos
        .checked_add(length)
        .ok_or(Error::Malformed("stream overflow"))?;
    let bytes = parser
        .bytes
        .get(parser.pos..end)
        .ok_or(Error::Malformed("truncated stream"))?;
    parser.pos = end;
    parser.expect(b"endstream")?;
    parser.expect(b"endobj")?;
    Ok(bytes)
}

pub(crate) fn decode_stream<'a>(
    stream: &'a [u8],
    dict: &Dictionary,
    max: usize,
) -> Result<std::borrow::Cow<'a, [u8]>> {
    use std::borrow::Cow;
    let Some(filter) = dict.get(b"Filter".as_slice()) else {
        if stream.len() > max {
            return Err(Error::Limit("decoded stream bytes"));
        }
        return Ok(Cow::Borrowed(stream));
    };
    if !matches!(filter, Value::Name(name) if name == b"FlateDecode")
        || !matches!(
            dict.get(b"DecodeParms".as_slice()),
            None | Some(Value::Null)
        )
    {
        return Err(Error::Unsupported("stream filter or decode parameters"));
    }
    let mut decoder = flate2::bufread::ZlibDecoder::new(stream).take(max as u64 + 1);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|_| Error::Malformed("invalid Flate stream"))?;
    if decoded.len() > max {
        return Err(Error::Limit("decoded stream bytes"));
    }
    if !decoder.into_inner().get_ref().is_empty() {
        return Err(Error::Malformed("trailing Flate stream data"));
    }
    Ok(Cow::Owned(decoded))
}

fn classic_xref(bytes: &[u8], xref: usize, upper: usize) -> Result<(XrefEntries, Dictionary)> {
    let mut parser = Parser::new(&bytes[..upper], xref);
    if parser.word()? != b"xref" {
        return Err(Error::Unsupported("cross-reference streams"));
    }
    let mut entries = BTreeMap::new();
    let mut numbers = BTreeSet::new();
    loop {
        let position = parser.pos;
        if parser.word()? == b"trailer" {
            break;
        }
        parser.pos = position;
        let first = object_number(parser.integer()?)?;
        let count = offset(parser.integer()?)?;
        if count > MAX_OBJECTS - numbers.len() {
            return Err(Error::Limit("cross-reference entries"));
        }
        for index in 0..count {
            let number = first
                .checked_add(index as u32)
                .ok_or(Error::Malformed("cross-reference object overflow"))?;
            let location = offset(parser.integer()?)?;
            let generation = generation(parser.integer()?)?;
            if !numbers.insert(number) {
                return Err(Error::Malformed("duplicate cross-reference entry"));
            }
            match parser.word()? {
                b"f" => {
                    entries.insert(number, None);
                }
                b"n" if number != 0 && location < xref => {
                    entries.insert(number, Some((generation, Location::Direct(location))));
                }
                _ => return Err(Error::Malformed("invalid cross-reference entry")),
            }
        }
    }
    let Value::Dictionary(trailer) = parser.value(0)? else {
        return Err(Error::Malformed("missing PDF trailer dictionary"));
    };
    Ok((entries, trailer))
}

fn xref_stream(bytes: &[u8], xref: usize, upper: usize) -> Result<(XrefEntries, Dictionary)> {
    let mut parser = Parser::new(&bytes[..upper], xref);
    let object = object_number(parser.integer()?)?;
    let generation_id = generation(parser.integer()?)?;
    parser.expect(b"obj")?;
    let Value::Dictionary(dict) = parser.value(0)? else {
        return Err(Error::Malformed("cross-reference stream dictionary"));
    };
    if !matches!(dict.get(b"Type".as_slice()), Some(Value::Name(name)) if name == b"XRef") {
        return Err(Error::Malformed("cross-reference stream type"));
    }
    let Some(Value::Array(width)) = dict.get(b"W".as_slice()) else {
        return Err(Error::Malformed("cross-reference stream widths"));
    };
    let [
        Value::Integer(kind),
        Value::Integer(first),
        Value::Integer(second),
    ] = width.as_slice()
    else {
        return Err(Error::Malformed("cross-reference stream widths"));
    };
    let widths = [offset(*kind)?, offset(*first)?, offset(*second)?];
    if widths.iter().any(|&width| width > 8) || widths.iter().sum::<usize>() == 0 {
        return Err(Error::Malformed(
            "invalid cross-reference stream field width",
        ));
    }
    let size = integer_field(&dict, b"Size")?;
    let indexes = match dict.get(b"Index".as_slice()) {
        Some(Value::Array(values)) => {
            let mut indexes = Vec::new();
            let mut pairs = values.chunks_exact(2);
            for pair in &mut pairs {
                let [Value::Integer(start), Value::Integer(count)] = pair else {
                    return Err(Error::Malformed("cross-reference index pair"));
                };
                indexes.push((offset(*start)?, offset(*count)?));
            }
            if !pairs.remainder().is_empty() {
                return Err(Error::Malformed("cross-reference index length"));
            }
            indexes
        }
        None => vec![(0, size)],
        _ => return Err(Error::Malformed("cross-reference index format")),
    };
    parser.expect(b"stream")?;
    let encoded = stream_bytes(&mut parser, integer_field(&dict, b"Length")?)?;
    let raw = decode_stream(encoded, &dict, MAX_OBJECTS * 24)?;
    let mut position = 0;
    let mut entries = BTreeMap::new();
    for (start, count) in indexes {
        if count > MAX_OBJECTS - entries.len() {
            return Err(Error::Limit("cross-reference entries"));
        }
        let end = start
            .checked_add(count)
            .filter(|&end| end <= size)
            .ok_or(Error::Malformed("cross-reference index range"))?;
        for number in start..end {
            let mut fields = [1, 0, 0];
            for (index, width) in widths.into_iter().enumerate() {
                if width == 0 {
                    continue;
                }
                let field = raw
                    .get(position..position + width)
                    .ok_or(Error::Malformed("truncated cross-reference stream"))?;
                fields[index] = field
                    .iter()
                    .fold(0u64, |value, &byte| (value << 8) | u64::from(byte));
                position += width;
            }
            let number =
                u32::try_from(number).map_err(|_| Error::Malformed("object number overflow"))?;
            let entry = match fields {
                [0, _, _] => None,
                [1, location, generation] if number != 0 && location <= xref as u64 => Some((
                    u16::try_from(generation)
                        .map_err(|_| Error::Malformed("generation overflow"))?,
                    Location::Direct(location as usize),
                )),
                [2, container, index] if number != 0 => Some((
                    0,
                    Location::Packed {
                        container: u32::try_from(container)
                            .map_err(|_| Error::Malformed("object stream reference"))?,
                        index: usize::try_from(index)
                            .map_err(|_| Error::Malformed("object stream index"))?,
                    },
                )),
                _ => return Err(Error::Malformed("invalid cross-reference stream entry")),
            };
            if entries.insert(number, entry).is_some() {
                return Err(Error::Malformed("duplicate cross-reference stream entry"));
            }
        }
    }
    if position != raw.len()
        || !matches!(entries.get(&object), Some(Some((id, Location::Direct(at)))) if *id == generation_id && *at == xref)
    {
        return Err(Error::Malformed("invalid cross-reference stream data"));
    }
    Ok((entries, dict))
}

impl<'a> Document<'a> {
    pub fn open(bytes: &'a [u8]) -> Result<Self> {
        if bytes.len() > MAX_BYTES {
            return Err(Error::Limit("input bytes"));
        }
        let Some(version) = bytes.get(5..8).filter(|version| {
            matches!(
                *version,
                b"1.0" | b"1.1" | b"1.2" | b"1.3" | b"1.4" | b"1.5" | b"1.6" | b"1.7" | b"2.0"
            )
        }) else {
            return Err(Error::Malformed("PDF version"));
        };
        if !bytes.starts_with(b"%PDF-") {
            return Err(Error::Malformed("PDF header"));
        }
        let end = bytes
            .iter()
            .rposition(|&byte| !syntax::whitespace(byte))
            .ok_or(Error::Malformed("missing PDF ending"))?
            + 1;
        if !bytes[..end].ends_with(b"%%EOF") {
            return Err(Error::Malformed("missing PDF ending"));
        }
        let footer = &bytes[..end - 5];
        let start = footer
            .windows(9)
            .rposition(|token| token == b"startxref")
            .ok_or(Error::Malformed("missing startxref"))?;
        let mut pointer = Parser::new(footer, start);
        pointer.expect(b"startxref")?;
        let xref = offset(pointer.integer()?)?;
        pointer.skip();
        if pointer.pos != footer.len() || xref >= start {
            return Err(Error::Malformed("invalid cross-reference location"));
        }

        let mut effective = BTreeMap::new();
        let mut trailer = Dictionary::new();
        let mut current = xref;
        let mut upper = start;
        let mut total_entries = 0;
        for depth in 0..64 {
            let mut probe = Parser::new(&bytes[..upper], current);
            let (section, fields) = if probe.word()? == b"xref" {
                classic_xref(bytes, current, upper)?
            } else {
                xref_stream(bytes, current, upper)?
            };
            total_entries += section.len();
            if total_entries > MAX_OBJECTS {
                return Err(Error::Limit("cross-reference entries across revisions"));
            }
            if fields.contains_key(b"Encrypt".as_slice()) {
                return Err(Error::Unsupported("encrypted document"));
            }
            if fields.contains_key(b"XRefStm".as_slice()) {
                return Err(Error::Unsupported("hybrid cross-reference streams"));
            }
            for (number, entry) in section {
                effective.entry(number).or_insert(entry);
            }
            let previous = fields.get(b"Prev".as_slice()).cloned();
            for (key, value) in fields {
                trailer.entry(key).or_insert(value);
            }
            let Some(previous) = previous else {
                break;
            };
            let Value::Integer(previous) = previous else {
                return Err(Error::Malformed("invalid previous cross-reference pointer"));
            };
            let previous = offset(previous)?;
            if previous >= current {
                return Err(Error::Malformed(
                    "previous cross-reference must point backwards",
                ));
            }
            if depth == 63 {
                return Err(Error::Limit("cross-reference revisions"));
            }
            upper = current;
            current = previous;
        }
        let entries: BTreeMap<_, _> = effective
            .into_iter()
            .filter_map(|(number, entry)| {
                entry.map(|(generation, location)| (Reference(number, generation), location))
            })
            .collect();
        let Some(Value::Reference(root)) = trailer.get(b"Root".as_slice()) else {
            return Err(Error::Malformed("missing document catalog reference"));
        };
        if !entries.contains_key(root) {
            return Err(Error::Malformed("missing document catalog object"));
        }
        Ok(Self {
            bytes,
            entries,
            root: *root,
            trailer,
            version,
            decoded_bytes: Cell::new(0),
        })
    }

    fn decode<'b>(
        &self,
        stream: &'b [u8],
        dict: &Dictionary,
    ) -> Result<std::borrow::Cow<'b, [u8]>> {
        const MAX_TOTAL: usize = 64 * 1024 * 1024;
        let remaining = MAX_TOTAL - self.decoded_bytes.get();
        let decoded = decode_stream(stream, dict, remaining.min(4 * 1024 * 1024))?;
        self.decoded_bytes
            .set(self.decoded_bytes.get() + decoded.len());
        Ok(decoded)
    }

    fn location(&self, reference: Reference) -> Result<Location> {
        self.entries
            .get(&reference)
            .copied()
            .ok_or(Error::Malformed("missing object"))
    }

    fn indirect_header(&self, reference: Reference, location: usize) -> Result<Parser<'a>> {
        let mut parser = Parser::new(self.bytes, location);
        if object_number(parser.integer()?)? != reference.0
            || generation(parser.integer()?)? != reference.1
        {
            return Err(Error::Malformed("cross-reference points to wrong object"));
        }
        parser.expect(b"obj")?;
        Ok(parser)
    }

    pub fn object(&self, reference: Reference) -> Result<Object<'a>> {
        let location = match self.location(reference)? {
            Location::Direct(location) => location,
            Location::Packed { container, index } => {
                return self.packed_object(reference, container, index);
            }
        };
        let mut parser = self.indirect_header(reference, location)?;
        let value = parser.value(0)?;
        let stream = match parser.word()? {
            b"endobj" => None,
            b"stream" => {
                let Value::Dictionary(dictionary) = &value else {
                    return Err(Error::Malformed("stream without dictionary"));
                };
                let length = match dictionary.get(b"Length".as_slice()) {
                    Some(Value::Integer(n)) => offset(*n)?,
                    Some(Value::Reference(length)) => {
                        let Location::Direct(at) = self.location(*length)? else {
                            return Err(Error::Unsupported("packed stream length"));
                        };
                        let mut length_parser = self.indirect_header(*length, at)?;
                        let value = offset(length_parser.integer()?)?;
                        length_parser.expect(b"endobj")?;
                        value
                    }
                    _ => return Err(Error::Malformed("invalid stream length")),
                };
                Some(stream_bytes(&mut parser, length)?)
            }
            _ => return Err(Error::Malformed("object missing endobj")),
        };
        Ok(Object {
            value,
            stream,
            raw: Some(&self.bytes[location..parser.pos]),
        })
    }

    fn packed_object(
        &self,
        reference: Reference,
        container: u32,
        index: usize,
    ) -> Result<Object<'a>> {
        let container = Reference(container, 0);
        if !matches!(self.location(container)?, Location::Direct(_)) {
            return Err(Error::Malformed("nested object stream"));
        }
        let source = self.object(container)?;
        let (Value::Dictionary(dict), Some(stream)) = (source.value, source.stream) else {
            return Err(Error::Malformed("object stream structure"));
        };
        if !matches!(dict.get(b"Type".as_slice()), Some(Value::Name(name)) if name == b"ObjStm") {
            return Err(Error::Malformed("object stream type"));
        }
        let count = integer_field(&dict, b"N")?;
        let first = integer_field(&dict, b"First")?;
        if index >= count || count > MAX_OBJECTS {
            return Err(Error::Malformed("invalid object stream index"));
        }
        let bytes = self.decode(stream, &dict)?;
        let header = bytes
            .get(..first)
            .ok_or(Error::Malformed("object stream boundary"))?;
        let mut parser = Parser::new(header, 0);
        let mut start = 0;
        let mut end = bytes.len() - first;
        for entry in 0..count {
            let number = object_number(parser.integer()?)?;
            let relative = offset(parser.integer()?)?;
            if entry == index {
                if number != reference.0 {
                    return Err(Error::Malformed(
                        "object stream index points to wrong object",
                    ));
                }
                start = relative;
            } else if entry == index + 1 {
                end = relative;
            }
        }
        parser.skip();
        if parser.pos != header.len() {
            return Err(Error::Malformed("invalid object stream header"));
        }
        let payload = bytes
            .get(first..)
            .and_then(|body| body.get(start..end))
            .ok_or(Error::Malformed("object stream range"))?;
        let mut parser = Parser::new(payload, 0);
        let value = parser.value(0)?;
        parser.skip();
        if parser.pos != payload.len() {
            return Err(Error::Malformed("extra tokens in packed object"));
        }
        Ok(Object {
            value,
            stream: None,
            raw: None,
        })
    }

    /// Serialize only reachable objects. Replacements are raw, unfiltered stream bytes.
    fn rewrite(&self, replacements: &BTreeMap<Reference, &[u8]>) -> Result<Vec<u8>> {
        let mut pending = vec![self.root];
        if let Some(Value::Reference(info)) = self.trailer.get(b"Info".as_slice()) {
            pending.push(*info);
        }
        let mut seen = BTreeSet::new();
        let mut used = BTreeSet::new();
        let mut positions = BTreeMap::new();
        let mut output = b"%PDF-".to_vec();
        output.extend_from_slice(self.version);
        output.extend_from_slice(b"\n%\xE2\xE3\xCF\xD3\n");
        while let Some(reference) = pending.pop() {
            if !seen.insert(reference) {
                continue;
            }
            let object = self.object(reference)?;
            let mut value = object.value;
            if let Value::Dictionary(dictionary) = &value {
                if matches!(dictionary.get(b"Type".as_slice()), Some(Value::Name(name)) if name == b"Sig")
                    || dictionary.contains_key(b"ByteRange".as_slice())
                {
                    return Err(Error::Unsupported("signed document"));
                }
                if dictionary.contains_key(b"XFA".as_slice()) {
                    return Err(Error::Unsupported("XFA forms"));
                }
            }
            positions.insert(reference, output.len());
            if let Some(stream) = replacements.get(&reference) {
                if object.stream.is_none() {
                    return Err(Error::Malformed("replacement target is not a stream"));
                }
                let Value::Dictionary(dictionary) = &mut value else {
                    return Err(Error::Malformed("replacement target has no dictionary"));
                };
                dictionary.remove(b"Filter".as_slice());
                dictionary.remove(b"DecodeParms".as_slice());
                let length =
                    i64::try_from(stream.len()).map_err(|_| Error::Limit("stream bytes"))?;
                if stream.len() > MAX_BYTES.saturating_sub(output.len()) {
                    return Err(Error::Limit("output bytes"));
                }
                dictionary.insert(b"Length".to_vec(), Value::Integer(length));
                let Reference(number, generation) = reference;
                writeln!(output, "{number} {generation} obj").map_err(write_error)?;
                write_value(&mut output, &value)?;
                output.extend_from_slice(b"\nstream\n");
                output.extend_from_slice(stream);
                output.extend_from_slice(b"\nendstream\nendobj");
                used.insert(reference);
            } else if let Some(raw) = object.raw {
                if raw.len() > MAX_BYTES.saturating_sub(output.len()) {
                    return Err(Error::Limit("output bytes"));
                }
                output.extend_from_slice(raw);
            } else {
                let Reference(number, generation) = reference;
                writeln!(output, "{number} {generation} obj").map_err(write_error)?;
                write_value(&mut output, &value)?;
                output.extend_from_slice(b"\nendobj");
            }
            output.push(b'\n');
            collect_references(&value, &mut pending);
            if pending.len() > MAX_OBJECTS {
                return Err(Error::Limit("pending references"));
            }
        }
        if used.len() != replacements.len() {
            return Err(Error::Malformed("unreachable stream replacement"));
        }

        let xref = output.len();
        output.extend_from_slice(b"xref\n0 1\n0000000000 65535 f \n");
        let mut entries = positions.iter().peekable();
        while let Some((&Reference(first, _), _)) = entries.peek().copied() {
            let mut section = Vec::new();
            while let Some((&Reference(number, generation), &position)) = entries.peek().copied() {
                if u64::from(number) != u64::from(first) + section.len() as u64 {
                    break;
                }
                section.push((position, generation));
                entries.next();
            }
            writeln!(output, "{first} {}", section.len()).map_err(write_error)?;
            for (position, generation) in section {
                writeln!(output, "{position:010} {generation:05} n ").map_err(write_error)?;
            }
        }

        let mut trailer = Dictionary::new();
        for key in [b"Root".as_slice(), b"Info".as_slice(), b"ID".as_slice()] {
            if let Some(value) = self.trailer.get(key) {
                trailer.insert(key.to_vec(), value.clone());
            }
        }
        let last = positions
            .last_key_value()
            .ok_or(Error::Malformed("empty document"))?
            .0
            .0;
        trailer.insert(b"Size".to_vec(), Value::Integer(i64::from(last) + 1));
        output.extend_from_slice(b"trailer\n");
        write_value(&mut output, &Value::Dictionary(trailer))?;
        writeln!(output, "\nstartxref\n{xref}\n%%EOF").map_err(write_error)?;
        if output.len() > MAX_BYTES {
            return Err(Error::Limit("output bytes"));
        }
        Ok(output)
    }
}

fn collect_references(value: &Value, pending: &mut Vec<Reference>) {
    match value {
        Value::Reference(reference) => pending.push(*reference),
        Value::Dictionary(dictionary) => {
            for item in dictionary.values() {
                collect_references(item, pending);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_references(item, pending);
            }
        }
        _ => {}
    }
}

fn write_error(_: std::io::Error) -> Error {
    Error::Limit("output write")
}

fn write_name(output: &mut Vec<u8>, name: &[u8]) -> Result<()> {
    output.push(b'/');
    for &byte in name {
        if !(33..=126).contains(&byte) || b"#()<>[]{}/%".contains(&byte) {
            write!(output, "#{byte:02X}").map_err(write_error)?;
        } else {
            output.push(byte);
        }
    }
    Ok(())
}

fn write_value(output: &mut Vec<u8>, value: &Value) -> Result<()> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(true) => output.extend_from_slice(b"true"),
        Value::Bool(false) => output.extend_from_slice(b"false"),
        Value::Integer(value) => write!(output, "{value}").map_err(write_error)?,
        Value::Real(value) => output.extend_from_slice(value.as_bytes()),
        Value::Reference(Reference(number, generation)) => {
            write!(output, "{number} {generation} R").map_err(write_error)?;
        }
        Value::Name(name) => write_name(output, name)?,
        Value::String(bytes) => {
            output.push(b'<');
            for byte in bytes {
                write!(output, "{byte:02X}").map_err(write_error)?;
            }
            output.push(b'>');
        }
        Value::Array(values) => {
            output.push(b'[');
            for value in values {
                write_value(output, value)?;
                output.push(b' ');
            }
            output.push(b']');
        }
        Value::Dictionary(dictionary) => {
            output.extend_from_slice(b"<<");
            for (key, value) in dictionary {
                write_name(output, key)?;
                output.push(b' ');
                write_value(output, value)?;
                output.push(b' ');
            }
            output.extend_from_slice(b">>");
        }
    }
    Ok(())
}
