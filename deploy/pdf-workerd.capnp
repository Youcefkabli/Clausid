using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "pdf", worker = (
    compatibilityDate = "2026-11-15",
    modules = [
      (name = "processor.mjs", esModule = embed "../packages/pdf-engine/worker/processor.mjs"),
      (name = "pdf_engine.js", esModule = embed "../packages/pdf-engine/dist/pdf_engine.js"),
      (name = "pdf_engine_bg.wasm", wasm = embed "../packages/pdf-engine/dist/pdf_engine_bg.wasm")
    ]
  ))],
  sockets = [(name = "http", address = "127.0.0.1:8789", http = (), service = "pdf")]
);
