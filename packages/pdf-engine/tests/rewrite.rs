use std::io::Write;

use clausid_pdf_engine::{Document, Edit, Error, Reference};

fn document(first: &[u8], second: Option<&[u8]>) -> Vec<u8> {
    with_font(
        first,
        second,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    )
}

fn with_font(first: &[u8], second: Option<&[u8]>, font: &[u8]) -> Vec<u8> {
    let mut bytes = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    let mut append = |body: &[u8]| {
        offsets.push(bytes.len());
        writeln!(bytes, "{} 0 obj", offsets.len()).unwrap();
        bytes.extend_from_slice(body);
        bytes.extend_from_slice(b"\nendobj\n");
    };
    append(b"<< /Type /Catalog /Pages 2 0 R >>");
    append(b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
    append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
    append(font);
    let mut content = first.to_vec();
    if let Some(second) = second {
        content.extend_from_slice(second);
    }
    let mut stream = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
    stream.extend_from_slice(&content);
    stream.extend_from_slice(b"\nendstream");
    append(&stream);
    append(b"(obsolete unreferenced content)");
    let xref = bytes.len();
    write!(bytes, "xref\n0 7\n0000000000 65535 f \n").unwrap();
    for offset in offsets {
        writeln!(bytes, "{offset:010} 00000 n ").unwrap();
    }
    write!(
        bytes,
        "trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
    )
    .unwrap();
    bytes
}

#[test]
fn only_replaces_the_selected_occurrence_and_removes_unreachable_objects() {
    let source = document(
        b"BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\n",
        Some(b"BT /F1 12 Tf 72 600 Td <50617920696E2031352064617973> Tj ET\n"),
    );
    let original = Document::open(&source).unwrap();
    let output = original
        .apply(&[Edit {
            page: 0,
            block: 1,
            offset: 0,
            expected: "Pay in 15 days",
            replacement: "Pay in 30 days",
        }])
        .unwrap();
    let final_document = Document::open(&output).unwrap();
    let blocks = final_document.inspect().unwrap();
    assert_eq!(blocks[0].text, "Pay in 15 days");
    assert_eq!(blocks[1].text, "Pay in 30 days");
    assert_eq!(original.inspect().unwrap()[1].text, "Pay in 15 days");
    assert!(final_document.object(Reference(6, 0)).is_err());
    assert_eq!(
        final_document.object(Reference(3, 0)).unwrap().value,
        original.object(Reference(3, 0)).unwrap().value
    );
}

#[test]
fn rejects_wrong_expected_text_and_longer_replacements() {
    let source = document(b"BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\n", None);
    let original = Document::open(&source).unwrap();
    assert!(matches!(
        original.apply(&[Edit {
            page: 0,
            block: 0,
            offset: 0,
            expected: "Pay in 14 days",
            replacement: "Pay in 30 days"
        }]),
        Err(Error::Malformed(_))
    ));
    assert!(matches!(
        original.apply(&[Edit {
            page: 0,
            block: 0,
            offset: 0,
            expected: "Pay in 15 days",
            replacement: "Pay in 180 days"
        }]),
        Err(Error::Unsupported(_))
    ));
}

#[test]
fn refuses_image_only_and_custom_text_positioning() {
    for content in [b"q /Image1 Do Q".as_slice(), b"BT /F1 12 Tf (Pay) Tj ET"] {
        let source = document(content, None);
        assert!(Document::open(&source).unwrap().inspect().is_err());
    }
}

#[test]
fn refuses_bad_xref_and_truncated_stream() {
    let source = document(b"BT /F1 12 Tf 72 650 Td (Pay) Tj ET\n", None);
    assert!(Document::open(&source[..source.len() - 8]).is_err());
    let mut altered = source;
    let position = altered.windows(8).position(|w| w == b"/Length ").unwrap() + 8;
    altered[position..position + 2].copy_from_slice(b"99");
    assert!(Document::open(&altered).unwrap().inspect().is_err());
}

#[test]
fn applies_non_overlapping_changes_and_rejects_conflicts() {
    let source = document(b"BT /F1 12 Tf 72 650 Td (Pay 10 in 15 days) Tj ET\n", None);
    let document = Document::open(&source).unwrap();
    let amount = Edit {
        page: 0,
        block: 0,
        offset: 4,
        expected: "10",
        replacement: "20",
    };
    let term = Edit {
        page: 0,
        block: 0,
        offset: 10,
        expected: "15",
        replacement: "30",
    };
    document.plan(&amount).unwrap();
    let result = document.apply(&[term, amount.clone()]).unwrap();
    assert_eq!(
        Document::open(&result).unwrap().inspect().unwrap()[0].text,
        "Pay 20 in 30 days"
    );
    assert!(matches!(
        document.apply(&[amount.clone(), amount]),
        Err(Error::Unsupported("overlapping text replacements"))
    ));
}

#[test]
fn resolves_latest_incremental_object_and_drops_older_revision() {
    let mut source = document(b"BT /F1 12 Tf 72 650 Td (Obsolete wording) Tj ET\n", None);
    let footer = std::str::from_utf8(&source)
        .unwrap()
        .split("startxref\n")
        .last()
        .unwrap();
    let previous: usize = footer.lines().next().unwrap().parse().unwrap();
    let location = source.len();
    let content = "BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\n";
    writeln!(
        source,
        "5 0 obj\n<< /Length {} >>\nstream\n{content}endstream\nendobj",
        content.len()
    )
    .unwrap();
    let xref = source.len();
    write!(source, "xref\n5 1\n{location:010} 00000 n \ntrailer\n<< /Size 7 /Prev {previous} >>\nstartxref\n{xref}\n%%EOF\n").unwrap();
    let doc = Document::open(&source).unwrap();
    assert_eq!(doc.inspect().unwrap()[0].text, "Pay in 15 days");
    let clean = doc
        .apply(&[Edit {
            page: 0,
            block: 0,
            offset: 7,
            expected: "15",
            replacement: "30",
        }])
        .unwrap();
    assert_eq!(
        Document::open(&clean).unwrap().inspect().unwrap()[0].text,
        "Pay in 30 days"
    );
    assert!(
        !clean
            .windows(b"Obsolete wording".len())
            .any(|part| part == b"Obsolete wording")
    );
    assert!(!clean.windows(5).any(|part| part == b"/Prev"));
}

#[test]
fn rewrites_a_pdf_with_a_flate_xref_and_packed_objects() {
    use flate2::{Compression, write::ZlibEncoder};

    fn compressed(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }

    let mut source = b"%PDF-1.5\n".to_vec();
    let content_at = source.len();
    let content = "BT /F1 12 Tf 72 650 Td (Pay in 15 days) Tj ET\n";
    writeln!(
        source,
        "5 0 obj\n<< /Length {} >>\nstream\n{content}endstream\nendobj",
        content.len()
    )
    .unwrap();
    let packed_at = source.len();
    let bodies = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
    ];
    let mut header = String::new();
    let mut payload = String::new();
    for (index, body) in bodies.into_iter().enumerate() {
        use std::fmt::Write;
        write!(header, "{} {} ", index + 1, payload.len()).unwrap();
        writeln!(payload, "{body}").unwrap();
    }
    let first = header.len();
    header.push_str(&payload);
    let packed = compressed(header.as_bytes());
    writeln!(
        source,
        "6 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /N 4 /First {first} /Length {} >>\nstream",
        packed.len()
    )
    .unwrap();
    source.extend_from_slice(&packed);
    source.extend_from_slice(b"\nendstream\nendobj\n");
    let xref_at = source.len();
    let mut records = Vec::new();
    for (kind, field, generation) in [
        (0, 0, 65535u16),
        (2, 6, 0),
        (2, 6, 1),
        (2, 6, 2),
        (2, 6, 3),
        (1, content_at as u32, 0),
        (1, packed_at as u32, 0),
        (1, xref_at as u32, 0),
    ] {
        records.push(kind);
        records.extend(field.to_be_bytes());
        records.extend(generation.to_be_bytes());
    }
    let xref = compressed(&records);
    writeln!(source, "7 0 obj\n<< /Type /XRef /Size 8 /W [1 4 2] /Filter /FlateDecode /Root 1 0 R /Length {} >>\nstream", xref.len()).unwrap();
    source.extend_from_slice(&xref);
    writeln!(source, "\nendstream\nendobj\nstartxref\n{xref_at}\n%%EOF").unwrap();
    let doc = Document::open(&source).unwrap();
    let clean = doc
        .apply(&[Edit {
            page: 0,
            block: 0,
            offset: 7,
            expected: "15",
            replacement: "30",
        }])
        .unwrap();
    let rewritten = Document::open(&clean).unwrap();
    assert_eq!(rewritten.inspect().unwrap()[0].text, "Pay in 30 days");
    assert!(rewritten.object(Reference(6, 0)).is_err());
}

#[test]
fn uses_unicode_offsets_and_preserves_split_proportional_text() {
    let mut widths = vec![500; 224];
    for (code, width) in [(b'i', 200), (b'W', 900)] {
        widths[usize::from(code - 32)] = width;
    }
    let widths = widths
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(" ");
    let font = format!(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [{widths}] >>"
    );
    let source = with_font(
        b"q 2 0 0 2 10 20 cm BT /F1 12 Tf 1 0 0 1 20 40 Tm (Caf\\351 W) Tj [-20 (W) ( next)] TJ ET Q",
        None, font.as_bytes(),
    );
    let doc = Document::open(&source).unwrap();
    let blocks = doc.inspect().unwrap();
    assert_eq!(blocks[0].text, "Café WW next");
    assert_eq!(blocks[0].baseline, [50.0, 100.0]);
    let edit = Edit {
        page: 0,
        block: 0,
        offset: 5,
        expected: "WW",
        replacement: "iii",
    };
    doc.plan(&edit).unwrap();
    let output = doc.apply(std::slice::from_ref(&edit)).unwrap();
    let modified = Document::open(&output).unwrap();
    assert_eq!(modified.inspect().unwrap()[0].text, "Café iii next");
    let stream = modified.object(Reference(5, 0)).unwrap().stream.unwrap();
    assert!(
        std::str::from_utf8(stream)
            .unwrap()
            .contains("-1220.00000000")
    );
    assert!(matches!(
        doc.plan(&Edit {
            replacement: "Ω",
            ..edit
        }),
        Err(Error::Unsupported(
            "replacement glyph unavailable or ambiguous"
        ))
    ));
}
