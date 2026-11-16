# AGENTS

Before working on the web app or answering questions about its Astryx setup, read and follow [apps/web/AGENTS.md](apps/web/AGENTS.md).

- Read [Architecture](docs/architecture.md) before changing shared interfaces, access, persistence, signing, or PDF processing.
- Use the [README](README.md#develop-locally) for the pinned toolchain, local startup, and verification. Set a separate `CLAUSID_DATA_DIR` for each concurrent worktree. Coordinate Vite and other local service ports before running browser tests concurrently.
- Use [Development workflow](docs/development.md) for issue intake, agent handoffs, review evidence, and release qualification.
- Run `pnpm check`, `pnpm test`, and `pnpm build` for application changes. Use `pnpm test:e2e` for affected workflows and the [CI PDF processor job](.github/workflows/ci.yml) for Rust/Wasm processor changes.
