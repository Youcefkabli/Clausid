use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    error::Error,
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    process::ExitCode,
};
use zip::ZipArchive;

type Result<T> = std::result::Result<T, Box<dyn Error>>;
const MANIFEST_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Archive {
    role: String,
    name: String,
    bytes: u64,
    sha256: String,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Backup {
    version: u32,
    archives: [Archive; 2],
}

#[derive(Deserialize)]
struct Evidence {
    sha256: String,
}

fn digest(mut reader: impl Read) -> io::Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        hash.update(&buffer[..count]);
    }
    let sha256 = hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((bytes, sha256))
}

fn describe(role: &str, path: &Path) -> Result<Archive> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Archive filename must be valid UTF-8")?;
    let (bytes, sha256) = digest(File::open(path)?)?;
    Ok(Archive {
        role: role.into(),
        name: name.into(),
        bytes,
        sha256,
    })
}

fn backup(auth: &Path, contracts: &Path) -> Result<Backup> {
    Ok(Backup {
        version: 1,
        archives: [describe("auth", auth)?, describe("contracts", contracts)?],
    })
}

fn read_manifest<T: serde::de::DeserializeOwned>(reader: impl Read) -> Result<T> {
    let mut bytes = Vec::new();
    reader.take(MANIFEST_LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MANIFEST_LIMIT {
        return Err("Manifest exceeds the size limit".into());
    }
    Ok(serde_json::from_slice(&bytes).map_err(|_| "Invalid JSON manifest")?)
}

fn check_entry_count(reader: &mut (impl Read + Seek), offset: u64) -> Result<()> {
    // ZipArchive indexes entries by name. Count the central directory records
    // as well so a repeated name cannot disappear during indexing.
    reader.seek(SeekFrom::Start(offset))?;
    for _ in 0..2 {
        let mut header = [0; 46];
        reader.read_exact(&mut header)?;
        if &header[..4] != b"PK\x01\x02" {
            return Err("Expected exactly two evidence files".into());
        }
        let extra_bytes: i64 = header[28..34]
            .chunks_exact(2)
            .map(|length| i64::from(u16::from_le_bytes([length[0], length[1]])))
            .sum();
        reader.seek(SeekFrom::Current(extra_bytes))?;
    }
    let mut signature = [0; 4];
    reader.read_exact(&mut signature)?;
    if !matches!(&signature, b"PK\x05\x06" | b"PK\x06\x06") {
        return Err("Expected exactly two evidence files".into());
    }
    Ok(())
}

fn verify_bundle(mut reader: impl Read + Seek) -> Result<()> {
    let offset = ZipArchive::new(&mut reader)?.central_directory_start();
    check_entry_count(&mut reader, offset)?;
    let mut archive = ZipArchive::new(reader)?;
    if archive.len() != 2 {
        return Err("Expected exactly two evidence files".into());
    }
    let expected: Evidence = read_manifest(archive.by_name("signing-evidence.json")?)?;
    let pdf = archive.by_name("contract.pdf")?;
    let (_, actual) = digest(pdf)?;
    if actual != expected.sha256 {
        return Err("PDF digest mismatch".into());
    }
    Ok(())
}

fn run(args: &[PathBuf]) -> Result<()> {
    let command = |path: &Path, name: &str| path.as_os_str() == name;
    match args {
        [group, action, auth, contracts] if command(group, "backup") && command(action, "manifest") => {
            serde_json::to_writer_pretty(io::stdout().lock(), &backup(auth, contracts)?)?;
            println!();
        }
        [group, action, manifest, auth, contracts] if command(group, "backup") && command(action, "verify") => {
            let expected: Backup = read_manifest(File::open(manifest)?)?;
            if expected != backup(auth, contracts)? {
                return Err("Backup archives do not match the manifest".into());
            }
            println!("Backup archives match manifest");
        }
        [group, action, bundle] if command(group, "evidence") && command(action, "verify") => {
            verify_bundle(File::open(bundle)?)?;
            println!("PDF digest matches manifest");
        }
        _ => return Err("Usage: clausid-ops backup manifest <auth> <contracts> | backup verify <manifest> <auth> <contracts> | evidence verify <bundle.zip>".into()),
    }
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<_> = std::env::args_os().skip(1).map(PathBuf::from).collect();
    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("clausid-ops: {error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn bundle(pdf: &[u8], manifest: &[u8], pdf_name: &str) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file(pdf_name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(pdf).unwrap();
        writer
            .start_file("signing-evidence.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(manifest).unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn verifies_the_supplied_pdf_digest() {
        let (_, sha256) = digest(&b"original pdf"[..]).unwrap();
        let manifest = serde_json::json!({ "sha256": sha256 }).to_string();
        let valid = bundle(b"original pdf", manifest.as_bytes(), "contract.pdf");
        let modified = bundle(b"modified pdf", manifest.as_bytes(), "contract.pdf");
        let missing = bundle(b"original pdf", manifest.as_bytes(), "different.pdf");
        assert!(verify_bundle(Cursor::new(valid)).is_ok());
        assert!(verify_bundle(Cursor::new(modified)).is_err());
        assert!(verify_bundle(Cursor::new(missing)).is_err());
    }

    #[test]
    fn rejects_bad_manifests_and_repeated_entries() {
        let invalid = bundle(b"pdf", b"{", "contract.pdf");
        assert!(verify_bundle(Cursor::new(invalid)).is_err());
        // Patch a third entry to repeat the manifest name. The ZIP
        // library otherwise collapses the repeated name into one entry.
        let (_, sha256) = digest(&b"pdf"[..]).unwrap();
        let manifest = serde_json::json!({ "sha256": sha256 }).to_string();
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in [
            ("contract.pdf", &b"pdf"[..]),
            ("signing-evidence.json", manifest.as_bytes()),
            ("alternate-evidence.js", manifest.as_bytes()),
        ] {
            writer
                .start_file(name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(data).unwrap();
        }
        let mut duplicate = writer.finish().unwrap().into_inner();
        let original = b"alternate-evidence.js";
        let replacement = b"signing-evidence.json";
        for index in 0..=duplicate.len() - original.len() {
            if &duplicate[index..index + original.len()] == original {
                duplicate[index..index + original.len()].copy_from_slice(replacement);
            }
        }
        assert!(verify_bundle(Cursor::new(duplicate)).is_err());
        assert!(read_manifest::<Backup>(io::repeat(b' ').take(MANIFEST_LIMIT + 1)).is_err());
    }
}
