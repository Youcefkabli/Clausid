using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "clausid", worker = (
      compatibilityDate = "2026-11-15",
      modules = [
        (name = "worker.mjs", esModule = embed "../apps/worker/dist/worker.mjs"),
        (name = "pdf_engine_bg.wasm", wasm = embed "../packages/pdf-engine/dist/pdf_engine_bg.wasm")
      ],
      bindings = [
        (name = "AUTH", service = "auth"),
        (name = "WEB_DISK", service = "webDisk"),
        (name = "PUBLIC_ORIGIN", fromEnvironment = "PUBLIC_ORIGIN"),
        (name = "INTERNAL_AUTH_KEY", fromEnvironment = "INTERNAL_AUTH_KEY"),
        (name = "CONTRACTS", durableObjectNamespace = (className = "Contract")),
        (name = "DIRECTORY", durableObjectNamespace = (className = "Directory"))
      ],
      durableObjectNamespaces = [
        (className = "Contract", uniqueKey = "clausid-contract-db-v1", enableSql = true),
        (className = "Directory", uniqueKey = "clausid-directory-db-v1", enableSql = true)
      ],
      durableObjectStorage = (localDisk = "contractDisk")
    )),
    (name = "auth", external = (http = ())),
    (name = "contractDisk", disk = (writable = true)),
    (name = "webDisk", disk = (path = "deploy", writable = false))
  ],
  sockets = [(name = "http", address = "127.0.0.1:8787", http = (), service = "clausid")]
);
