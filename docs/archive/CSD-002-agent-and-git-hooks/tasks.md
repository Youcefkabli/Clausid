# Historical record

Archived from `docs/specs/CSD-002-agent-and-git-hooks/tasks.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-002 — Task and verification record

| Task | Dependency | State | Evidence |
| --- | --- | --- | --- |
| T00: client/reference inspection | None | Implemented locally | Codex 0.169.0-alpha.11.1; Claude 2.1.81; Pi 0.66.1 lacks required blocking event |
| T01: adapters, snapshots and installer | T00 | Implemented locally | Shared commands; repository-local Git hooks active |
| T02: regression and runner evidence | T01 | Implemented locally | 29 unit tests across five files; real staged/pushed monorepo checks and installed Claude lifecycle passed |
| T03: docs and full gate | T02 | Implemented locally | Full `verify:all` passed through the real pre-push handler in a disposable commit snapshot; Codex activation remains unconfirmed after reported trust |

## Verification entries

- Initial types/lint and 26 unit tests passed. A later smoke-script environment typing error was
  caught by `pnpm check` and corrected before final verification.
- `pnpm hooks:install` initially failed to write `.git/config` under the filesystem sandbox.
  Approved repository-local installation then passed. `pnpm hooks:status` reported all three Git
  hooks active. Existing custom paths/legacy hooks are preserved by installer tests.
- `pnpm hooks:smoke:claude` passed with installed Claude Code 2.1.81: four local response requests,
  three real Stop continuations, then an explicit unresolved-failure handoff. Dummy credentials,
  a loopback provider fixture, no paid model and no external message were used. Fixture/server cleaned up.
- Installed Codex app-server `hooks/list` initialized successfully and reported the project
  SessionStart/Stop definitions enabled, no errors/warnings, both **untrusted**. This is loader
  recognition, not a completed live Codex turn. Personal trust must be reviewed through `/hooks`
  or Settings → Hooks. UI tooling cannot control the Codex app, so that review was not performed.
- On 2026-11-18 the maintainer confirmed personally reviewing and trusting both definitions.
  A subsequent fresh `hooks/list` call still returned **untrusted** for both project definitions,
  with `enabled=true` and no errors/warnings. The probe resolved the same installed
  `0.169.0-alpha.11.1` Codex binary and the exact Clausid project path; the hook configuration
  was not changed. Record the maintainer review as completed, but activation remains unconfirmed
  because the client report conflicts with it. No personal trust state was rewritten or bypassed.
- Pi's installed API does not provide `agent_before_settle`; no unsupported extension was added.
- Real Clausid staged smoke rejected an intentionally broken staged contracts type with `TS2322`
  despite a fixed working copy, then accepted the corrected index. Original index, worktree and
  untracked files were preserved. The smoke caught and fixed a package-local `.bin` remapping
  error; a regression now covers that case and canonical workspace links.
- Fresh full pre-push verification initially blocked on a missing Wasm target for Rust 1.93.1.
  The target was installed explicitly for that pinned toolchain. A subsequent browser run exposed
  Vite refusing LiveStore Wasm from the reused dependency store. The dev allowlist now includes
  the snapshot workspace and real pnpm store, without adding the original checkout's source.
  The interrupted run's surviving services were identified and stopped before retrying.
- Final `pnpm verify:all` passed through `prePush` against a disposable committed copy of the
  implementation: 29 unit tests, five Playwright workflows, ten PDF rewrite tests, two operations
  tests, types/lint, website diagnostics, fresh Wasm, workspace builds, Astryx doctor, Cloudflare
  dry-run/auth parity, Rust fmt/Clippy, real workerd PDF smoke and operations release build.
  The synthetic verification commit was `48eaab468c448fec4bc9b3d205c0fa852c04277d`, not a commit on
  the user's branch; both temporary clones were removed. Original index/status were checked unchanged.
- Final verification used local Mailpit, Chrome, wasm-bindgen 0.2.130 on PATH, pinned Rust 1.93.1,
  ports `15173/18787/18788`, fixed persistence-suite ports, and snapshot-owned `.data/e2e`.
  `pnpm check` also passed after the Vite configuration change. The final Claude smoke passed again;
  its earlier sandbox-only loopback bind failure was rerun with the required local service permission.
- Documentation and evidence-only edits after the full gate are checked with `pnpm check:changed`
  and `git diff --check`. No new CI result, implementation commit, PR or deployment is claimed.
