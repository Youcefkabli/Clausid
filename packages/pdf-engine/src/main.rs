use std::{
    env, fs,
    io::{self, Read, Write},
    process::ExitCode,
};

use clausid_pdf_engine::{Document, Edit, MAX_BYTES};

fn number(value: &str) -> Result<usize, Box<dyn std::error::Error>> {
    Ok(value.parse()?)
}

fn read_pdf(path: &str) -> io::Result<Vec<u8>> {
    let file = fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > MAX_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "PDF exceeds input size limit",
        ));
    }
    Ok(bytes)
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<_> = env::args().skip(1).collect();
    match arguments.as_slice() {
        [command, path] if command == "inspect" => {
            let bytes = read_pdf(path)?;
            for block in Document::open(&bytes)?.inspect()? {
                println!("{}\t{}\t{}", block.page, block.block, block.text);
            }
        }
        [command, input, output, page, block, expected, replacement] if command == "replace" => {
            let bytes = read_pdf(input)?;
            let result = Document::open(&bytes)?.apply(&[Edit {
                page: number(page)?,
                block: number(block)?,
                offset: 0,
                expected,
                replacement,
            }])?;
            fs::OpenOptions::new().write(true).create_new(true).open(output)?.write_all(&result)?;
        }
        _ => return Err("usage: clausid-pdf-engine inspect INPUT | replace INPUT OUTPUT PAGE BLOCK EXPECTED REPLACEMENT (zero-based indices)".into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
