# PDF engine instructions

Read [PDF negotiation](../../docs/contracts/pdf-negotiation.md) and
[signing and evidence](../../docs/contracts/signing-and-evidence.md).

- Preserve source-digest and exact expected-text checks, Unicode scalar offsets, fit validation,
  supported-input limits and explicit rejection of unsupported PDFs. Never guess a replacement site.
- Add fixtures for changed supported and unsupported cases, including source fidelity and failure
  behavior. Do not substitute synthetic success for a real Wasm/workerd round trip.
- Use the pinned Rust toolchain and wasm-bindgen version. Never hand-edit generated `dist` files.
- Run root `pnpm verify:pdf` and `pnpm verify` when integrated application behavior is affected.
  The application profile rebuilds Wasm before building the Worker to avoid stale generated code.
