#!/bin/sh
set -eu
cd "$(dirname "$0")"
export CARGO_TARGET_DIR="$PWD/target"
cargo build --locked --lib --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir dist --out-name pdf_engine \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/clausid_pdf_engine.wasm"
