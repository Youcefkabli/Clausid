//! Bounded editing of independent PDF text lines.

use std::{borrow::Cow, collections::BTreeMap, io::Write, ops::Range, rc::Rc};

use crate::{
    Dictionary, Document, Error, Reference, Result, Value,
    font::{Font, Glyph, number},
    syntax::Parser,
};

#[derive(Debug, PartialEq)]
#[cfg_attr(target_arch = "wasm32", derive(serde::Serialize))]
pub struct TextBlock {
    pub page: usize,
    pub block: usize,
    pub text: String,
    pub baseline: [f64; 2],
    pub font_size: f64,
}

/// A proposed substitution with zero-based Unicode scalar offsets into the inspected block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Edit<'a> {
    pub page: usize,
    pub block: usize,
    pub offset: usize,
    pub expected: &'a str,
    pub replacement: &'a str,
}

fn key<'a>(dict: &'a Dictionary, name: &[u8]) -> Result<&'a Value> {
    dict.get(name)
        .ok_or(Error::Unsupported("missing required page data"))
}

fn reference(value: &Value) -> Result<Reference> {
    match value {
        Value::Reference(reference) => Ok(*reference),
        _ => Err(Error::Unsupported("expected indirect page object")),
    }
}

fn dictionary(value: Value) -> Result<Dictionary> {
    match value {
        Value::Dictionary(dictionary) => Ok(dictionary),
        _ => Err(Error::Malformed("expected page dictionary")),
    }
}

fn name(value: &Value, expected: &[u8]) -> bool {
    matches!(value, Value::Name(name) if name == expected)
}

struct Run {
    source: Range<usize>,
    font: Rc<Font>,
    glyphs: Vec<Glyph>,
    // TJ adjustments before each glyph and after the last glyph.
    gaps: Vec<f64>,
    baseline: [f64; 2],
    font_size: f64,
}

impl Run {
    fn block(self, page: usize, block: usize) -> TextBlock {
        TextBlock {
            page,
            block,
            text: self
                .glyphs
                .iter()
                .flat_map(|glyph| glyph.text.iter())
                .collect(),
            baseline: self.baseline,
            font_size: self.font_size,
        }
    }

    fn plan(&self, edit: &Edit<'_>) -> Result<(Range<usize>, Vec<Glyph>, f64)> {
        let len = edit.expected.chars().count();
        if len == 0 {
            return Err(Error::Malformed("empty source text range"));
        }
        let end = edit
            .offset
            .checked_add(len)
            .ok_or(Error::Malformed("invalid text range"))?;
        let mut scalar_offset = 0;
        let mut start_glyph = None;
        let mut end_glyph = None;
        for (index, glyph) in self.glyphs.iter().enumerate() {
            if scalar_offset == edit.offset {
                start_glyph = Some(index);
            }
            scalar_offset += glyph.text.len();
            if scalar_offset == end {
                end_glyph = Some(index + 1);
                break;
            }
        }
        let range = match (start_glyph, end_glyph) {
            (Some(start), Some(end)) => start..end,
            _ => {
                return Err(Error::Unsupported(
                    "text range must align with glyph boundaries",
                ));
            }
        };
        let source = &self.glyphs[range.clone()];
        if !source
            .iter()
            .flat_map(|glyph| glyph.text.iter().copied())
            .eq(edit.expected.chars())
        {
            return Err(Error::Malformed("target text does not match"));
        }
        let replacement = self.font.encode(edit.replacement)?;
        if replacement.is_empty() && range.len() == self.glyphs.len() {
            return Err(Error::Unsupported("cannot remove the entire text block"));
        }
        // Use the smallest right edge permitted by the old run. Positive TJ
        // values move the cursor back, so they consume part of this span.
        let old_width = source.iter().map(|glyph| glyph.width).sum::<f64>()
            - self.gaps[range.start + 1..range.end].iter().sum::<f64>();
        let new_width = replacement.iter().map(|glyph| glyph.width).sum::<f64>();
        if old_width <= 0.0 || new_width > old_width {
            return Err(Error::Unsupported(
                "replacement exceeds the original text span",
            ));
        }
        Ok((range, replacement, new_width - old_width))
    }

    fn replace(&mut self, range: Range<usize>, replacement: Vec<Glyph>, advance: f64) {
        let len = replacement.len();
        let mut gaps = vec![0.0; len + 1];
        gaps[0] = self.gaps[range.start];
        gaps[len] += self.gaps[range.end] + advance;
        self.gaps.splice(range.start..=range.end, gaps);
        self.glyphs.splice(range, replacement);
    }

    fn write(&self, output: &mut Vec<u8>) -> Result<()> {
        output.push(b'[');
        let mut codes = Vec::new();
        for (index, gap) in self.gaps.iter().enumerate() {
            if *gap != 0.0 {
                if !codes.is_empty() {
                    crate::write_value(output, &Value::String(std::mem::take(&mut codes)))?;
                }
                write!(output, " {gap:.8} ").map_err(crate::write_error)?;
            }
            if let Some(glyph) = self.glyphs.get(index) {
                codes.extend_from_slice(&glyph.code.to_be_bytes()[2 - self.font.code_bytes..]);
            }
        }
        if !codes.is_empty() {
            crate::write_value(output, &Value::String(codes))?;
        }
        output.extend_from_slice(b"] TJ ");
        Ok(())
    }
}

fn content_ids(page: &Dictionary) -> Result<Vec<Reference>> {
    match key(page, b"Contents")? {
        Value::Reference(id) => Ok(vec![*id]),
        Value::Array(items) if items.len() <= 128 => items.iter().map(reference).collect(),
        Value::Array(_) => Err(Error::Limit("page content streams")),
        _ => Err(Error::Malformed("invalid Contents entry")),
    }
}

fn operand_number(parser: &mut Parser<'_>) -> Result<f64> {
    let value = number(&parser.value(0)?)?;
    if !value.is_finite() || value.abs() > 1_000_000.0 {
        return Err(Error::Unsupported("text coordinate bounds"));
    }
    Ok(value)
}

fn append_glyphs(
    font: &Font,
    bytes: &[u8],
    glyphs: &mut Vec<Glyph>,
    gaps: &mut Vec<f64>,
) -> Result<()> {
    if bytes.len() / font.code_bytes > 16_384 - glyphs.len() {
        return Err(Error::Limit("glyphs per text block"));
    }
    let decoded = font.decode(bytes)?;
    gaps.resize(gaps.len() + decoded.len(), 0.0);
    glyphs.extend(decoded);
    Ok(())
}

#[derive(Clone, Copy)]
struct Transform {
    scale: [f64; 2],
    offset: [f64; 2],
}

impl Transform {
    const IDENTITY: Self = Self {
        scale: [1.0, 1.0],
        offset: [0.0, 0.0],
    };

    fn point(self, point: [f64; 2]) -> [f64; 2] {
        [
            point[0] * self.scale[0] + self.offset[0],
            point[1] * self.scale[1] + self.offset[1],
        ]
    }
}

fn pdf_operand(byte: u8) -> bool {
    matches!(
        byte,
        b'/' | b'(' | b'<' | b'[' | b'+' | b'-' | b'.' | b'0'..=b'9'
    )
}

struct Graphics<'a> {
    transform: Transform,
    saved: Vec<Transform>,
    tags: usize,
    states: &'a Dictionary,
}

impl Graphics<'_> {
    fn operator(&mut self, operator: &[u8], operands: &[Value]) -> Result<()> {
        let stray = || Error::Malformed("graphics operator operands");
        match (operator, operands) {
            (b"q", []) if self.saved.len() < 64 => self.saved.push(self.transform),
            (b"Q", []) => {
                self.transform = self
                    .saved
                    .pop()
                    .ok_or(Error::Malformed("graphics state stack"))?
            }
            (b"cm", [a, b, c, d, x, y]) => {
                let [a, b, c, d, x, y] = [
                    number(a)?,
                    number(b)?,
                    number(c)?,
                    number(d)?,
                    number(x)?,
                    number(y)?,
                ];
                if b != 0.0 || c != 0.0 || a <= 0.0 || d == 0.0 {
                    return Err(Error::Unsupported("non-axis-aligned graphics matrix"));
                }
                self.transform = Transform {
                    scale: [self.transform.scale[0] * a, self.transform.scale[1] * d],
                    offset: self.transform.point([x, y]),
                };
                if self
                    .transform
                    .scale
                    .iter()
                    .chain(&self.transform.offset)
                    .any(|value| !value.is_finite() || value.abs() > 1_000_000.0)
                {
                    return Err(Error::Unsupported("graphics matrix bounds"));
                }
            }
            (b"gs", [Value::Name(state_name)]) => {
                let state = self
                    .states
                    .get(state_name)
                    .ok_or(Error::Malformed("missing graphics state"))?;
                let Value::Dictionary(state) = state else {
                    return Err(stray());
                };
                // An external state can change the effective font or make text invisible.
                if state.contains_key(b"Font".as_slice())
                    || state
                        .get(b"ca".as_slice())
                        .map(number)
                        .transpose()?
                        .is_some_and(|alpha| alpha <= 0.0)
                    || state
                        .get(b"CA".as_slice())
                        .map(number)
                        .transpose()?
                        .is_some_and(|alpha| alpha <= 0.0)
                    || state
                        .get(b"SMask".as_slice())
                        .is_some_and(|mask| !name(mask, b"None"))
                {
                    return Err(Error::Unsupported(
                        "graphics state affects text visibility or font",
                    ));
                }
            }
            (b"BDC", [Value::Name(_), Value::Dictionary(properties)])
                if !properties.contains_key(b"ActualText".as_slice()) =>
            {
                self.tags += 1;
            }
            (b"BMC", [Value::Name(_)]) => self.tags += 1,
            (b"EMC", []) => {
                self.tags = self
                    .tags
                    .checked_sub(1)
                    .ok_or(Error::Malformed("marked content stack"))?
            }
            (b"rg" | b"RG", [_, _, _])
            | (b"k" | b"K" | b"re", [_, _, _, _])
            | (b"g" | b"G" | b"w" | b"J" | b"j" | b"M", [_])
            | (b"m" | b"l", [_, _])
            | (b"c", [_, _, _, _, _, _]) => {
                for value in operands {
                    number(value)?;
                }
            }
            (b"n" | b"f" | b"f*" | b"S" | b"s" | b"h" | b"W" | b"W*" | b"B" | b"B*", []) => {}
            _ => {
                return Err(Error::Unsupported(
                    "graphics operator outside editable profile",
                ));
            }
        }
        Ok(())
    }
}

impl Document<'_> {
    fn pages(&self) -> Result<Vec<Dictionary>> {
        let catalog = dictionary(self.object(self.root)?.value)?;
        if !name(key(&catalog, b"Type")?, b"Catalog") {
            return Err(Error::Malformed("missing catalog type"));
        }
        if catalog.contains_key(b"AcroForm".as_slice()) {
            return Err(Error::Unsupported("interactive forms"));
        }
        let mut pending = vec![(reference(key(&catalog, b"Pages")?)?, None::<Value>)];
        let mut visited = std::collections::BTreeSet::new();
        let mut pages = Vec::new();
        while let Some((id, inherited_resources)) = pending.pop() {
            if visited.len() >= 1024 {
                return Err(Error::Limit("page tree nodes"));
            }
            if !visited.insert(id) {
                return Err(Error::Malformed("repeated page tree node"));
            }
            let mut item = dictionary(self.object(id)?.value)?;
            if let Some(inherited) = inherited_resources {
                item.entry(b"Resources".to_vec()).or_insert(inherited);
            }
            if name(key(&item, b"Type")?, b"Page") {
                pages.push(item);
            } else if name(key(&item, b"Type")?, b"Pages") {
                let Value::Array(children) = key(&item, b"Kids")? else {
                    return Err(Error::Malformed("page tree children"));
                };
                if children.len() > 1024 - pending.len() {
                    return Err(Error::Limit("pending page tree nodes"));
                }
                for child in children.iter().rev() {
                    pending.push((
                        reference(child)?,
                        item.get(b"Resources".as_slice()).cloned(),
                    ));
                }
            } else {
                return Err(Error::Malformed("unknown page tree item"));
            }
        }
        if pages.is_empty() {
            return Err(Error::Malformed("empty page tree"));
        }
        Ok(pages)
    }

    fn resources(&self, page: &Dictionary) -> Result<(Dictionary, Dictionary)> {
        let mut resources = key(page, b"Resources")?.clone();
        if let Value::Reference(id) = resources {
            resources = self.object(id)?.value;
        }
        let resources = dictionary(resources)?;
        let mut fonts = key(&resources, b"Font")?.clone();
        if let Value::Reference(id) = fonts {
            fonts = self.object(id)?.value;
        }
        let mut states = Dictionary::new();
        if let Some(external) = resources.get(b"ExtGState".as_slice()) {
            let external = match external {
                Value::Reference(id) => self.object(*id)?.value,
                other => other.clone(),
            };
            for (name, state) in dictionary(external)? {
                let state = if let Value::Reference(id) = state {
                    self.object(id)?.value
                } else {
                    state
                };
                states.insert(name, state);
            }
        }
        Ok((dictionary(fonts)?, states))
    }

    fn runs(
        &self,
        resources: &(Dictionary, Dictionary),
        id: Reference,
    ) -> Result<(Cow<'_, [u8]>, Vec<Run>)> {
        let (fonts, states) = resources;
        let object = self.object(id)?;
        let stream = object
            .stream
            .ok_or(Error::Malformed("invalid page content"))?;
        let stream = self.decode(stream, &dictionary(object.value)?)?;
        let mut parser = Parser::new(&stream, 0);
        let mut blocks = Vec::new();
        let mut font_cache = BTreeMap::new();
        let mut graphics = Graphics {
            transform: Transform::IDENTITY,
            saved: Vec::new(),
            tags: 0,
            states,
        };
        let mut operands = Vec::new();
        loop {
            parser.skip();
            if parser.pos == stream.len() {
                break;
            }
            if blocks.len() == 4096 {
                return Err(Error::Limit("page text blocks"));
            }
            if pdf_operand(stream[parser.pos]) {
                if operands.len() == 16 {
                    return Err(Error::Limit("graphics operands"));
                }
                operands.push(parser.value(0)?);
                continue;
            }
            let operator = parser.word()?;
            if operator != b"BT" {
                graphics.operator(operator, &operands)?;
                operands.clear();
                continue;
            }
            if !operands.is_empty() {
                return Err(Error::Malformed("unexpected operands before BT"));
            }
            parser.skip();
            // pdf-lib writes the fill color inside BT, before selecting the font.
            if parser
                .bytes
                .get(parser.pos)
                .is_some_and(|&byte| byte != b'/')
            {
                for _ in 0..3 {
                    operand_number(&mut parser)?;
                }
                parser.expect(b"rg")?;
            }
            parser.skip();
            let font_name = parser.name()?;
            let font_value = key(fonts, &font_name)?;
            let cache_key = match font_value {
                Value::Reference(id) => Ok(*id),
                _ => Err(font_name),
            };
            let font = match font_cache.get(&cache_key) {
                Some(font) => Rc::clone(font),
                None => {
                    let font = self.editable_font(font_value)?;
                    font_cache.insert(cache_key, Rc::clone(&font));
                    font
                }
            };
            let size = operand_number(&mut parser)?;
            if !(1.0..=256.0).contains(&size) {
                return Err(Error::Unsupported("font size"));
            }
            parser.expect(b"Tf")?;
            let mut first = operand_number(&mut parser)?;
            let after_first = parser.pos;
            if parser.expect(b"TL").is_ok() {
                first = operand_number(&mut parser)?;
            } else {
                parser.pos = after_first;
            }
            let second = operand_number(&mut parser)?;
            let after_pair = parser.pos;
            let (mut baseline, direction) = if parser.expect(b"Td").is_ok() {
                ([first, second], 1.0)
            } else {
                parser.pos = after_pair;
                let third = operand_number(&mut parser)?;
                let fourth = operand_number(&mut parser)?;
                let baseline = [operand_number(&mut parser)?, operand_number(&mut parser)?];
                parser.expect(b"Tm")?;
                if first != 1.0 || second != 0.0 || third != 0.0 || !matches!(fourth, 1.0 | -1.0) {
                    return Err(Error::Unsupported("transformed text block"));
                }
                (baseline, fourth)
            };
            if direction * graphics.transform.scale[1] <= 0.0 {
                return Err(Error::Unsupported("upside-down text"));
            }
            loop {
                parser.skip();
                let start = parser.pos;
                let mut glyphs = Vec::new();
                let mut gaps = vec![0.0];
                let (end, move_by) = loop {
                    parser.skip();
                    let cursor = parser.pos;
                    if parser.expect(b"ET").is_ok() {
                        break (cursor, None);
                    }
                    parser.pos = cursor;
                    // A trailing line advance has no effect on any displayed glyph.
                    if parser.expect(b"T*").is_ok() {
                        parser.expect(b"ET")?;
                        break (cursor, None);
                    }
                    parser.pos = cursor;
                    let operand = parser.value(0)?;
                    // An explicit Td starts a separately positioned editable line.
                    if matches!(operand, Value::Integer(_) | Value::Real(_)) {
                        let x = number(&operand)?;
                        let y = operand_number(&mut parser)?;
                        parser.expect(b"Td")?;
                        if !x.is_finite() || x.abs() > 1_000_000.0 {
                            return Err(Error::Unsupported("text coordinate bounds"));
                        }
                        break (cursor, Some([x, y]));
                    }
                    match (operand, parser.word()?) {
                        (Value::String(bytes), b"Tj") => {
                            append_glyphs(&font, &bytes, &mut glyphs, &mut gaps)?
                        }
                        (Value::Array(segments), b"TJ") => {
                            for segment in segments {
                                match segment {
                                    Value::String(bytes) => {
                                        append_glyphs(&font, &bytes, &mut glyphs, &mut gaps)?
                                    }
                                    value => {
                                        let gap = &mut gaps[glyphs.len()];
                                        *gap += number(&value)?;
                                        if !gap.is_finite() || gap.abs() > 1_000_000.0 {
                                            return Err(Error::Unsupported(
                                                "text positioning adjustment",
                                            ));
                                        }
                                    }
                                }
                            }
                        }
                        _ => {
                            return Err(Error::Unsupported(
                                "text operator outside editable line profile",
                            ));
                        }
                    }
                };
                if !glyphs.is_empty() {
                    if blocks.len() == 4096 {
                        return Err(Error::Limit("page text blocks"));
                    }
                    blocks.push(Run {
                        source: start..end,
                        font: Rc::clone(&font),
                        glyphs,
                        gaps,
                        baseline: graphics.transform.point(baseline),
                        font_size: size * graphics.transform.scale[1].abs(),
                    });
                }
                let Some([x, y]) = move_by else { break };
                baseline[0] += x;
                baseline[1] += direction * y;
            }
        }
        if !operands.is_empty() || !graphics.saved.is_empty() || graphics.tags != 0 {
            return Err(Error::Unsupported(
                "page stream depends on adjacent graphics state",
            ));
        }
        Ok((stream, blocks))
    }

    /// Inspect the supported single-line editing profile. Page and block indices are zero-based.
    pub fn inspect(&self) -> Result<Vec<TextBlock>> {
        let mut result = Vec::new();
        for (page, dictionary) in self.pages()?.iter().enumerate() {
            let fonts = self.resources(dictionary)?;
            let mut block = 0;
            for id in content_ids(dictionary)? {
                let (_, runs) = self.runs(&fonts, id)?;
                for run in runs {
                    result.push(run.block(page, block));
                    block += 1;
                    if result.len() > 16_384 {
                        return Err(Error::Limit("document text blocks"));
                    }
                }
            }
            if block == 0 {
                return Err(Error::Unsupported("page has no editable text"));
            }
        }
        Ok(result)
    }

    /// Validate a proposed edit against a specific source page and block.
    pub fn plan(&self, edit: &Edit<'_>) -> Result<()> {
        let pages = self.pages()?;
        let page = pages
            .get(edit.page)
            .ok_or(Error::Malformed("invalid target page"))?;
        let fonts = self.resources(page)?;
        let mut remaining = edit.block;
        for id in content_ids(page)? {
            let (_, runs) = self.runs(&fonts, id)?;
            if let Some(run) = runs.get(remaining) {
                run.plan(edit)?;
                let mut owners = 0;
                for page in &pages {
                    owners += content_ids(page)?
                        .iter()
                        .filter(|&&other| other == id)
                        .count();
                }
                if owners != 1 {
                    return Err(Error::Unsupported("page content is shared"));
                }
                return Ok(());
            }
            remaining -= runs.len();
        }
        Err(Error::Malformed("invalid target block"))
    }

    /// Apply a group of non-overlapping edits against the original block offsets.
    pub fn apply(&self, edits: &[Edit<'_>]) -> Result<Vec<u8>> {
        if edits.len() > 256 {
            return Err(Error::Limit("document edits"));
        }
        let mut edits_by_block: BTreeMap<(usize, usize), Vec<&Edit<'_>>> = BTreeMap::new();
        for edit in edits {
            edits_by_block
                .entry((edit.page, edit.block))
                .or_default()
                .push(edit);
        }
        let pages = self.pages()?;
        let mut owners = BTreeMap::new();
        for page in &pages {
            for id in content_ids(page)? {
                *owners.entry(id).or_insert(0usize) += 1;
            }
        }
        let mut replacements = BTreeMap::new();
        let mut predicted = Vec::new();
        for (page, dictionary) in pages.iter().enumerate() {
            let fonts = self.resources(dictionary)?;
            let mut block = 0;
            for id in content_ids(dictionary)? {
                let (stream, runs) = self.runs(&fonts, id)?;
                let mut changed = Vec::new();
                let mut last = 0;
                for mut run in runs {
                    if let Some(mut edits) = edits_by_block.remove(&(page, block)) {
                        if owners.get(&id) != Some(&1) {
                            return Err(Error::Unsupported("page content is shared"));
                        }
                        edits.sort_unstable_by_key(|edit| edit.offset);
                        let mut end = 0;
                        let mut resolved = Vec::with_capacity(edits.len());
                        for edit in edits {
                            let planned = run.plan(edit)?;
                            if planned.0.start < end {
                                return Err(Error::Unsupported("overlapping text replacements"));
                            }
                            end = planned.0.end;
                            resolved.push(planned);
                        }
                        for (range, replacement, advance) in resolved.into_iter().rev() {
                            run.replace(range, replacement, advance);
                        }
                        if run.glyphs.is_empty() {
                            return Err(Error::Unsupported("cannot remove the entire text block"));
                        }
                        changed.extend_from_slice(&stream[last..run.source.start]);
                        run.write(&mut changed)?;
                        last = run.source.end;
                    }
                    predicted.push(run.block(page, block));
                    block += 1;
                    if predicted.len() > 16_384 {
                        return Err(Error::Limit("document text blocks"));
                    }
                }
                if last != 0 {
                    changed.extend_from_slice(&stream[last..]);
                    replacements.insert(id, changed);
                }
            }
            if block == 0 {
                return Err(Error::Unsupported("page has no editable text"));
            }
        }
        if !edits_by_block.is_empty() {
            return Err(Error::Malformed("invalid target page or block"));
        }
        let replacements = replacements
            .iter()
            .map(|(id, bytes)| (*id, bytes.as_slice()))
            .collect();
        let output = self.rewrite(&replacements)?;
        if Document::open(&output)?.inspect()? != predicted {
            return Err(Error::Malformed("rewritten page text did not verify"));
        }
        Ok(output)
    }
}
