use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::{Document, Edit, Error};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestEdit {
    id: String,
    page: usize,
    block: usize,
    offset: usize,
    expected: String,
    replacement: String,
}

impl RequestEdit {
    fn edit(&self) -> Edit<'_> {
        Edit {
            page: self.page,
            block: self.block,
            offset: self.offset,
            expected: &self.expected,
            replacement: &self.replacement,
        }
    }
}

#[derive(Serialize)]
struct Failure {
    code: &'static str,
    message: String,
}

fn failure(error: Error) -> JsValue {
    let code = match error {
        Error::Malformed(_) => "malformed_pdf",
        Error::Unsupported(_) => "unsupported_pdf",
        Error::Limit(_) => "limit_exceeded",
    };
    JsValue::from_str(
        &serde_json::to_string(&Failure {
            code,
            message: error.to_string(),
        })
        .expect("serializing fixed error data cannot fail"),
    )
}

fn metadata_error(_: serde_json::Error) -> JsValue {
    JsValue::from_str(r#"{"code":"invalid_metadata","message":"Invalid PDF operation metadata."}"#)
}

#[wasm_bindgen]
pub fn inspect(bytes: &[u8]) -> Result<String, JsValue> {
    let blocks = Document::open(bytes)
        .and_then(|document| document.inspect())
        .map_err(failure)?;
    serde_json::to_string(&blocks).map_err(metadata_error)
}

#[wasm_bindgen]
pub fn plan(bytes: &[u8], metadata: &str) -> Result<(), JsValue> {
    let edit: RequestEdit = serde_json::from_str(metadata).map_err(metadata_error)?;
    Document::open(bytes)
        .and_then(|document| document.plan(&edit.edit()))
        .map_err(failure)
}

#[wasm_bindgen]
pub struct Applied {
    pdf: Vec<u8>,
    report: String,
}

#[wasm_bindgen]
impl Applied {
    pub fn report(&self) -> String {
        self.report.clone()
    }

    pub fn take_pdf(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.pdf)
    }
}

#[wasm_bindgen]
pub fn apply(bytes: &[u8], metadata: &str) -> Result<Applied, JsValue> {
    let request: Vec<RequestEdit> = serde_json::from_str(metadata).map_err(metadata_error)?;
    let edits: Vec<_> = request.iter().map(RequestEdit::edit).collect();
    let pdf = Document::open(bytes)
        .and_then(|document| document.apply(&edits))
        .map_err(failure)?;
    let report = serde_json::to_string(&request.iter().map(|edit| &edit.id).collect::<Vec<_>>())
        .map_err(metadata_error)?;
    Ok(Applied { pdf, report })
}
