use std::collections::BTreeMap;

use crate::{Error, Result};

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct Reference(pub u32, pub u16);

pub type Dictionary = BTreeMap<Vec<u8>, Value>;

#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Integer(i64),
    Real(String),
    Name(Vec<u8>),
    String(Vec<u8>),
    Array(Vec<Value>),
    Dictionary(Dictionary),
    Reference(Reference),
}

pub(crate) fn whitespace(byte: u8) -> bool {
    matches!(byte, 0 | b'\t' | b'\n' | 12 | b'\r' | b' ')
}

fn delimiter(byte: u8) -> bool {
    whitespace(byte) || b"()<>[]{}/%".contains(&byte)
}

fn hex(byte: u8) -> Result<u8> {
    (byte as char)
        .to_digit(16)
        .map(|digit| digit as u8)
        .ok_or(Error::Malformed("invalid hexadecimal digit"))
}

pub(crate) struct Parser<'a> {
    pub bytes: &'a [u8],
    pub pos: usize,
    nodes: usize,
}

impl<'a> Parser<'a> {
    pub fn new(bytes: &'a [u8], pos: usize) -> Self {
        Self {
            bytes,
            pos,
            nodes: 0,
        }
    }

    pub fn skip(&mut self) {
        while let Some(&byte) = self.bytes.get(self.pos) {
            if whitespace(byte) {
                self.pos += 1;
            } else if byte == b'%' {
                while self
                    .bytes
                    .get(self.pos)
                    .is_some_and(|b| !matches!(b, b'\n' | b'\r'))
                {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    pub fn word(&mut self) -> Result<&'a [u8]> {
        self.skip();
        let start = self.pos;
        while self
            .bytes
            .get(self.pos)
            .is_some_and(|&byte| !delimiter(byte))
        {
            self.pos += 1;
        }
        if start == self.pos {
            return Err(Error::Malformed("expected PDF token"));
        }
        Ok(&self.bytes[start..self.pos])
    }

    pub fn integer(&mut self) -> Result<i64> {
        std::str::from_utf8(self.word()?)
            .ok()
            .and_then(|word| word.parse().ok())
            .ok_or(Error::Malformed("expected PDF integer"))
    }

    pub fn expect(&mut self, expected: &[u8]) -> Result<()> {
        if self.word()? != expected {
            return Err(Error::Malformed("unexpected PDF token"));
        }
        Ok(())
    }

    pub fn name(&mut self) -> Result<Vec<u8>> {
        if self.bytes.get(self.pos) != Some(&b'/') {
            return Err(Error::Malformed("expected PDF name"));
        }
        self.pos += 1;
        let mut name = Vec::new();
        while let Some(&byte) = self.bytes.get(self.pos).filter(|&&byte| !delimiter(byte)) {
            self.pos += 1;
            if byte == b'#' {
                let pair = self
                    .bytes
                    .get(self.pos..self.pos + 2)
                    .ok_or(Error::Malformed("incomplete name escape"))?;
                name.push(hex(pair[0])? * 16 + hex(pair[1])?);
                self.pos += 2;
            } else {
                name.push(byte);
            }
        }
        Ok(name)
    }

    fn literal(&mut self) -> Result<Vec<u8>> {
        self.pos += 1;
        let mut nesting = 1;
        let mut output = Vec::new();
        while let Some(&byte) = self.bytes.get(self.pos) {
            self.pos += 1;
            match byte {
                b'(' => {
                    nesting += 1;
                    output.push(byte);
                }
                b')' => {
                    nesting -= 1;
                    if nesting == 0 {
                        return Ok(output);
                    }
                    output.push(byte);
                }
                b'\r' => {
                    self.pos += usize::from(self.bytes.get(self.pos) == Some(&b'\n'));
                    output.push(b'\n');
                }
                b'\\' => {
                    let escaped = *self
                        .bytes
                        .get(self.pos)
                        .ok_or(Error::Malformed("incomplete string escape"))?;
                    self.pos += 1;
                    match escaped {
                        b'n' => output.push(b'\n'),
                        b'r' => output.push(b'\r'),
                        b't' => output.push(b'\t'),
                        b'b' => output.push(8),
                        b'f' => output.push(12),
                        b'\n' => {}
                        b'\r' => self.pos += usize::from(self.bytes.get(self.pos) == Some(&b'\n')),
                        b'0'..=b'7' => {
                            let mut value = escaped - b'0';
                            for _ in 0..2 {
                                let Some(&digit @ b'0'..=b'7') = self.bytes.get(self.pos) else {
                                    break;
                                };
                                value = value.wrapping_mul(8).wrapping_add(digit - b'0');
                                self.pos += 1;
                            }
                            output.push(value);
                        }
                        _ => output.push(escaped),
                    }
                }
                _ => output.push(byte),
            }
        }
        Err(Error::Malformed("unterminated PDF string"))
    }

    fn hexadecimal(&mut self) -> Result<Vec<u8>> {
        self.pos += 1;
        let mut output = Vec::new();
        let mut high = None;
        while let Some(&byte) = self.bytes.get(self.pos) {
            self.pos += 1;
            if byte == b'>' {
                output.extend(high.map(|digit| digit * 16));
                return Ok(output);
            }
            if whitespace(byte) {
                continue;
            }
            let digit = hex(byte)?;
            if let Some(previous) = high.take() {
                output.push(previous * 16 + digit);
            } else {
                high = Some(digit);
            }
        }
        Err(Error::Malformed("unterminated hexadecimal string"))
    }

    pub fn value(&mut self, depth: usize) -> Result<Value> {
        self.nodes += 1;
        if depth > 48 || self.nodes > 100_000 {
            return Err(Error::Limit("PDF object complexity"));
        }
        self.skip();
        match self.bytes.get(self.pos) {
            Some(b'(') => self.literal().map(Value::String),
            Some(b'/') => self.name().map(Value::Name),
            Some(b'<') if self.bytes.get(self.pos + 1) != Some(&b'<') => {
                self.hexadecimal().map(Value::String)
            }
            Some(b'<') => {
                self.pos += 2;
                let mut dictionary = Dictionary::new();
                loop {
                    self.skip();
                    if self.bytes.get(self.pos..self.pos + 2) == Some(b">>") {
                        self.pos += 2;
                        return Ok(Value::Dictionary(dictionary));
                    }
                    let key = self.name()?;
                    let value = self.value(depth + 1)?;
                    if dictionary.insert(key, value).is_some() {
                        return Err(Error::Malformed("duplicate dictionary key"));
                    }
                }
            }
            Some(b'[') => {
                self.pos += 1;
                let mut values = Vec::new();
                loop {
                    self.skip();
                    if self.bytes.get(self.pos) == Some(&b']') {
                        self.pos += 1;
                        return Ok(Value::Array(values));
                    }
                    values.push(self.value(depth + 1)?);
                }
            }
            _ => {
                let word = self.word()?;
                match word {
                    b"null" => return Ok(Value::Null),
                    b"true" => return Ok(Value::Bool(true)),
                    b"false" => return Ok(Value::Bool(false)),
                    _ => {}
                }
                let text =
                    std::str::from_utf8(word).map_err(|_| Error::Malformed("invalid PDF token"))?;
                if let Ok(value) = text.parse::<i64>() {
                    let end = self.pos;
                    if let Ok(object) = u32::try_from(value)
                        && let Ok(generation) = self.integer().and_then(|n| {
                            u16::try_from(n).map_err(|_| Error::Malformed("invalid generation"))
                        })
                        && self.expect(b"R").is_ok()
                    {
                        return Ok(Value::Reference(Reference(object, generation)));
                    }
                    self.pos = end;
                    return Ok(Value::Integer(value));
                }
                if text.contains('.')
                    && text.bytes().all(|byte| b"+-.0123456789".contains(&byte))
                    && text.parse::<f64>().is_ok_and(f64::is_finite)
                {
                    return Ok(Value::Real(text.to_owned()));
                }
                Err(Error::Malformed("invalid PDF value"))
            }
        }
    }
}
