# Worker instructions

Read the [architecture](../../docs/architecture.md), [code map](../../docs/codebase.md), and
[domain contracts](../../docs/contracts.md) before changing authorization or persistence.

- The public Worker authenticates requests; Durable Objects enforce current object access.
  Directory listings do not grant contract access. Keep internal identity forwarding private.
- Preserve per-contract serialization, transaction boundaries, account-scoped retries and
  persisted-before-ack behavior. Test retry/conflict and unauthorized cases when these change.
- Preserve original, negotiated, preview and frozen PDF artifacts as distinct states. Freeze
  must store the exact reviewed bytes; do not render a new document during freeze.
- Treat VPS and Cloudflare adapters as implementations of the same domain behavior. Keep
  configuration and migration compatibility explicit. Generated Wasm belongs in build output.
- Run root `pnpm verify`; PDF engine changes also require `pnpm verify:pdf`. Hosted runtime
  behavior and recovery require separate qualification evidence.
