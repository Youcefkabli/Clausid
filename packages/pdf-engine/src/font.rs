//! Font mappings for the editable subset of PDF text.

use std::{collections::BTreeMap, rc::Rc};

use crate::{Dictionary, Error, Result, Value};

#[derive(Clone, Debug)]
pub(crate) struct Glyph {
    pub text: Rc<[char]>,
    pub code: u16,
    pub width: f64,
}

#[derive(Debug)]
pub(crate) struct Font {
    pub code_bytes: usize,
    by_code: BTreeMap<u16, Glyph>,
    by_character: BTreeMap<char, Option<Glyph>>,
}

pub(crate) fn number(value: &Value) -> Result<f64> {
    match value {
        Value::Integer(value) => Ok(*value as f64),
        Value::Real(value) => value
            .parse()
            .map_err(|_| Error::Malformed("invalid numeric value")),
        _ => Err(Error::Malformed("expected numeric value")),
    }
}

fn name<'a>(dictionary: &'a Dictionary, key: &[u8]) -> Option<&'a [u8]> {
    match dictionary.get(key) {
        Some(Value::Name(value)) => Some(value),
        _ => None,
    }
}

fn win_ansi(byte: u8) -> Option<char> {
    const SPECIAL: [Option<char>; 32] = [
        Some('€'),
        None,
        Some('‚'),
        Some('ƒ'),
        Some('„'),
        Some('…'),
        Some('†'),
        Some('‡'),
        Some('ˆ'),
        Some('‰'),
        Some('Š'),
        Some('‹'),
        Some('Œ'),
        None,
        Some('Ž'),
        None,
        None,
        Some('‘'),
        Some('’'),
        Some('“'),
        Some('”'),
        Some('•'),
        Some('–'),
        Some('—'),
        Some('˜'),
        Some('™'),
        Some('š'),
        Some('›'),
        Some('œ'),
        None,
        Some('ž'),
        Some('Ÿ'),
    ];
    match byte {
        0x20..=0x7e | 0xa0..=0xff => Some(char::from(byte)),
        0x80..=0x9f => SPECIAL[(byte - 0x80) as usize],
        _ => None,
    }
}

impl Font {
    pub fn simple(dictionary: &Dictionary) -> Result<Rc<Self>> {
        let courier = name(dictionary, b"Subtype") == Some(b"Type1")
            && name(dictionary, b"BaseFont") == Some(b"Courier")
            && dictionary
                .keys()
                .all(|key| matches!(key.as_slice(), b"Type" | b"Subtype" | b"BaseFont"));
        if courier {
            // StandardEncoding has typographic single quotes at ASCII quote positions.
            let mappings = (0x20u8..=0x7e).map(|code| Glyph {
                text: Rc::from([match code {
                    b'\'' => '’',
                    b'`' => '‘',
                    _ => char::from(code),
                }]),
                code: u16::from(code),
                width: 600.0,
            });
            return Ok(Rc::new(Self::from_glyphs(1, mappings)));
        }
        if !matches!(name(dictionary, b"Subtype"), Some(b"Type1" | b"TrueType"))
            || name(dictionary, b"Encoding") != Some(b"WinAnsiEncoding")
            || dictionary.contains_key(b"ToUnicode".as_slice())
        {
            return Err(Error::Unsupported(
                "font has no supported character mapping",
            ));
        }
        // An embedded subset may omit codes even if its Widths array lists them.
        // Until the embedded program is checked, this profile accepts external fonts only.
        if dictionary.contains_key(b"FontDescriptor".as_slice()) {
            return Err(Error::Unsupported("embedded simple font is not qualified"));
        }
        let Some(Value::Integer(first)) = dictionary.get(b"FirstChar".as_slice()) else {
            return Err(Error::Malformed("font first character"));
        };
        let first = u8::try_from(*first).map_err(|_| Error::Malformed("font character range"))?;
        let Some(Value::Array(widths)) = dictionary.get(b"Widths".as_slice()) else {
            return Err(Error::Unsupported("font widths are unavailable"));
        };
        if widths.len() > 256 - usize::from(first) {
            return Err(Error::Malformed("font character range"));
        }
        let mut glyphs = Vec::new();
        for (index, width) in widths.iter().enumerate() {
            let code = first + index as u8;
            let width = number(width)?;
            if let Some(character) = win_ansi(code)
                && (1.0..=10_000.0).contains(&width)
            {
                glyphs.push(Glyph {
                    text: Rc::from([character]),
                    code: u16::from(code),
                    width,
                });
            }
        }
        Ok(Rc::new(Self::from_glyphs(1, glyphs)))
    }

    fn from_glyphs(code_bytes: usize, glyphs: impl IntoIterator<Item = Glyph>) -> Self {
        let mut font = Self {
            code_bytes,
            by_code: BTreeMap::new(),
            by_character: BTreeMap::new(),
        };
        for glyph in glyphs {
            if let [character] = *glyph.text {
                font.by_character
                    .entry(character)
                    .and_modify(|choice| *choice = None)
                    .or_insert_with(|| Some(glyph.clone()));
            }
            font.by_code.insert(glyph.code, glyph);
        }
        font
    }

    pub fn decode(&self, bytes: &[u8]) -> Result<Vec<Glyph>> {
        if !bytes.len().is_multiple_of(self.code_bytes) {
            return Err(Error::Malformed("incomplete font character code"));
        }
        bytes
            .chunks_exact(self.code_bytes)
            .map(|bytes| {
                let code = if self.code_bytes == 1 {
                    u16::from(bytes[0])
                } else {
                    u16::from_be_bytes([bytes[0], bytes[1]])
                };
                self.by_code
                    .get(&code)
                    .cloned()
                    .ok_or(Error::Unsupported("unmapped source glyph"))
            })
            .collect()
    }

    pub fn encode(&self, text: &str) -> Result<Vec<Glyph>> {
        text.chars()
            .map(|character| {
                self.by_character
                    .get(&character)
                    .and_then(Option::as_ref)
                    .cloned()
                    .ok_or(Error::Unsupported(
                        "replacement glyph unavailable or ambiguous",
                    ))
            })
            .collect()
    }
}

fn dictionary(value: &Value) -> Result<&Dictionary> {
    match value {
        Value::Dictionary(dict) => Ok(dict),
        _ => Err(Error::Malformed("expected font dictionary")),
    }
}

fn unsigned(value: &Value) -> Result<u16> {
    match value {
        Value::Integer(value) => {
            u16::try_from(*value).map_err(|_| Error::Malformed("invalid character code"))
        }
        _ => Err(Error::Malformed("expected character code")),
    }
}

fn code(value: Value) -> Result<u16> {
    let Value::String(bytes) = value else {
        return Err(Error::Malformed("expected CMap hexadecimal code"));
    };
    let [high, low] = bytes.as_slice() else {
        return Err(Error::Unsupported("CMap code width"));
    };
    Ok(u16::from_be_bytes([*high, *low]))
}

fn unicode_text(value: Value) -> Result<Rc<[char]>> {
    let Value::String(bytes) = value else {
        return Err(Error::Malformed("expected CMap Unicode string"));
    };
    if bytes.is_empty() || !bytes.len().is_multiple_of(2) {
        return Err(Error::Malformed("invalid CMap Unicode string length"));
    }
    if bytes.len() > 64 {
        return Err(Error::Limit("CMap Unicode string"));
    }
    char::decode_utf16(
        bytes
            .chunks_exact(2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]])),
    )
    .map(|scalar| scalar.map_err(|_| Error::Malformed("invalid CMap UTF-16")))
    .collect::<Result<_>>()
}

fn unicode_map(bytes: &[u8]) -> Result<BTreeMap<u16, Rc<[char]>>> {
    use crate::syntax::Parser;
    let mut map = BTreeMap::new();
    let mut parser = Parser::new(bytes, 0);
    let mut count = None;
    while parser.pos < bytes.len() {
        parser.skip();
        let Some(&byte) = bytes.get(parser.pos) else {
            break;
        };
        if matches!(byte, b'/' | b'(' | b'<' | b'[') {
            parser.value(0)?;
            count = None;
            continue;
        }
        let word = parser.word()?;
        if matches!(word, b"beginbfchar" | b"beginbfrange") {
            let count = count
                .take()
                .ok_or(Error::Malformed("missing CMap mapping count"))?;
            for _ in 0..count {
                let first = code(parser.value(0)?)?;
                let last = if word == b"beginbfrange" {
                    code(parser.value(0)?)?
                } else {
                    first
                };
                if last < first || usize::from(last - first) + map.len() >= 65_536 {
                    return Err(Error::Limit("CMap ranges"));
                }
                let target = parser.value(0)?;
                if word == b"beginbfchar" {
                    if map.insert(first, unicode_text(target)?).is_some() {
                        return Err(Error::Malformed("duplicate CMap mapping"));
                    }
                } else if let Value::Array(targets) = target {
                    if targets.len() != usize::from(last - first) + 1 {
                        return Err(Error::Malformed("CMap range length"));
                    }
                    for (source, target) in (first..=last).zip(targets) {
                        if map.insert(source, unicode_text(target)?).is_some() {
                            return Err(Error::Malformed("duplicate CMap mapping"));
                        }
                    }
                } else {
                    let first_target = code(target)?;
                    for source in first..=last {
                        let scalar = u32::from(first_target) + u32::from(source - first);
                        let character = char::from_u32(scalar)
                            .filter(|_| scalar <= 0xffff)
                            .ok_or(Error::Unsupported("CMap mapping outside BMP scalars"))?;
                        if map.insert(source, Rc::from([character])).is_some() {
                            return Err(Error::Malformed("duplicate CMap mapping"));
                        }
                    }
                }
            }
            parser.expect(if word == b"beginbfchar" {
                b"endbfchar"
            } else {
                b"endbfrange"
            })?;
        } else {
            if word == b"usecmap" {
                return Err(Error::Unsupported("inherited CMap"));
            }
            count = std::str::from_utf8(word)
                .ok()
                .and_then(|value| value.parse::<u16>().ok());
        }
    }
    if map.is_empty() {
        return Err(Error::Unsupported("no Unicode font mapping"));
    }
    Ok(map)
}

fn cid_widths(descendant: &Dictionary) -> Result<BTreeMap<u16, f64>> {
    let mut widths = BTreeMap::new();
    let Some(values) = descendant.get(b"W".as_slice()) else {
        return Ok(widths);
    };
    let Value::Array(values) = values else {
        return Err(Error::Malformed("CID widths"));
    };
    let mut values = values.iter();
    while let Some(first) = values.next() {
        let first = unsigned(first)?;
        match values.next() {
            Some(Value::Array(values)) => {
                for (index, value) in values.iter().enumerate() {
                    let code = u16::try_from(index)
                        .ok()
                        .and_then(|index| first.checked_add(index))
                        .ok_or(Error::Malformed("CID width range"))?;
                    if widths.insert(code, number(value)?).is_some() {
                        return Err(Error::Malformed("overlapping CID widths"));
                    }
                }
            }
            Some(last) => {
                let last = unsigned(last)?;
                let width = number(values.next().ok_or(Error::Malformed("CID width missing"))?)?;
                if last < first {
                    return Err(Error::Malformed("CID width range"));
                }
                for code in first..=last {
                    if widths.insert(code, width).is_some() {
                        return Err(Error::Malformed("overlapping CID widths"));
                    }
                }
            }
            None => return Err(Error::Malformed("CID width range missing")),
        }
    }
    Ok(widths)
}

fn font_glyph_count(bytes: &[u8]) -> Result<u16> {
    if !matches!(bytes.get(..4), Some(b"\0\x01\0\0" | b"true")) {
        return Err(Error::Unsupported("expected embedded TrueType program"));
    }
    let count = u16::from_be_bytes(
        bytes
            .get(4..6)
            .ok_or(Error::Malformed("font table count"))?
            .try_into()
            .expect("two-byte slice"),
    );
    for index in 0..usize::from(count) {
        let at = 12 + index * 16;
        let table = bytes
            .get(at..at + 16)
            .ok_or(Error::Malformed("truncated font directory"))?;
        if &table[..4] == b"maxp" {
            let at = u32::from_be_bytes(table[8..12].try_into().expect("four-byte slice")) as usize;
            let end = at
                .checked_add(6)
                .ok_or(Error::Malformed("font table length"))?;
            let table = bytes
                .get(at..end)
                .ok_or(Error::Malformed("missing maxp table"))?;
            return Ok(u16::from_be_bytes([table[4], table[5]]));
        }
    }
    Err(Error::Malformed("font program lacks glyph count"))
}

impl crate::Document<'_> {
    fn font_value(&self, value: &Value) -> Result<Value> {
        match value {
            Value::Reference(id) => Ok(self.object(*id)?.value),
            other => Ok(other.clone()),
        }
    }

    fn font_stream(&self, value: Option<&Value>) -> Result<Vec<u8>> {
        let Some(Value::Reference(id)) = value else {
            return Err(Error::Unsupported("required font stream unavailable"));
        };
        let object = self.object(*id)?;
        let stream = object
            .stream
            .ok_or(Error::Malformed("font object is not a stream"))?;
        Ok(self
            .decode(stream, dictionary(&object.value)?)?
            .into_owned())
    }

    pub(crate) fn editable_font(&self, value: &Value) -> Result<Rc<Font>> {
        let value = self.font_value(value)?;
        let font = dictionary(&value)?;
        if name(font, b"Subtype") != Some(b"Type0") {
            return Font::simple(font);
        }
        if name(font, b"Encoding") != Some(b"Identity-H") {
            return Err(Error::Unsupported("composite font is not Identity-H"));
        }
        let Some(Value::Array(descendants)) = font.get(b"DescendantFonts".as_slice()) else {
            return Err(Error::Malformed("missing descendant font"));
        };
        let [descendant] = descendants.as_slice() else {
            return Err(Error::Malformed("unexpected descendant font count"));
        };
        let descendant = self.font_value(descendant)?;
        let descendant = dictionary(&descendant)?;
        if name(descendant, b"Subtype") != Some(b"CIDFontType2") {
            return Err(Error::Unsupported("unsupported CID font program"));
        }
        let descriptor = descendant
            .get(b"FontDescriptor".as_slice())
            .ok_or(Error::Unsupported("missing font descriptor"))?;
        let descriptor = self.font_value(descriptor)?;
        let glyph_count = font_glyph_count(
            &self.font_stream(dictionary(&descriptor)?.get(b"FontFile2".as_slice()))?,
        )?;
        let gid_map = match descendant.get(b"CIDToGIDMap".as_slice()) {
            None => None,
            Some(Value::Name(value)) if value == b"Identity" => None,
            value => Some(self.font_stream(value)?),
        };
        let mapping = unicode_map(&self.font_stream(font.get(b"ToUnicode".as_slice()))?)?;
        let widths = cid_widths(descendant)?;
        let default_width = descendant
            .get(b"DW".as_slice())
            .map(number)
            .transpose()?
            .unwrap_or(1000.0);
        let glyphs = mapping.into_iter().filter_map(|(code, text)| {
            let glyph = if let Some(gid_map) = &gid_map {
                let start = usize::from(code) * 2;
                let bytes = gid_map.get(start..start + 2)?;
                u16::from_be_bytes([bytes[0], bytes[1]])
            } else {
                code
            };
            let width = widths.get(&code).copied().unwrap_or(default_width);
            (glyph > 0 && glyph < glyph_count && (1.0..=10_000.0).contains(&width))
                .then_some(Glyph { code, text, width })
        });
        Ok(Rc::new(Font::from_glyphs(2, glyphs)))
    }
}
