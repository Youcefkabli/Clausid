# Historical record

Archived from `docs/specs/CSD-000-development-foundation/tasks.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-000 — Task and verification record

| Task | Dependency | Scope | State | Evidence |
| --- | --- | --- | --- | --- |
| T00: baseline | None | Source, docs, Git and current CI | Implemented locally | Clean base 027772e; prior analysis ran check + 8 unit tests; original CI success linked below |
| T01: docs and guidance | T00 | Documentation tree, scoped AGENTS, templates | Implemented locally | Documentation file links and workstream metadata passed |
| T02: shared checks | T01 | scripts/checks, routing and runner tests | Implemented locally | 16 unit tests passed, including Git states, content routing, timeout/failure and interruption |
| T03: integration and evidence | T02 | CI, README, review templates, full verification | Implemented locally | Final verify:all passed; CI submission/review remains pending |

## Baseline evidence

Base [027772e CI](https://github.com/Youcefkabli/Clausid/actions/runs/44329375976) passed the original
verify, PDF and operations jobs. This does not verify the new local CI/workflow changes.

## Verification entries

- 2026-11-18: initial new runner/routing suite plus existing tests passed (15 tests / 4 files).
  `pnpm check` passed. These runs preceded final docs/profile integration; final results follow.
- 2026-11-18: `pnpm check:changed` passed: docs, types/lint, 16 unit tests / 4 files, website
  diagnostics (50 files, zero errors/warnings/hints), PDF and operations fmt/Clippy. It correctly
  required `verify:all` for gate/tooling edits. `--plan` also included all new/untracked files.
- First full attempt stopped at Astro's local font-server bind with sandbox `EPERM`. No build or
  browser success was claimed for that attempt. Reran with approved local-service access.
- First `pnpm verify:all` passed. Review then tightened interrupted-command failure handling,
  Markdown-as-site-content routing and the explicit CI wasm-bindgen compiler pin.
- Final `pnpm verify:all` passed against base `027772e` plus the final uncommitted foundation
  implementation: docs, root types/lint, 16 unit tests / 4 files, website check (50 files; zero
  diagnostics), fresh Wasm, workspace build, Astryx built-output doctor, Cloudflare bundle dry-run,
  auth schema parity, all 5 browser tests (3.9 minutes), PDF fmt/Clippy + 10 rewrite tests, real
  workerd PDF round trip, operations fmt/Clippy + 2 tests + release build.
- Resources: `CLAUSID_DATA_DIR=.data/foundation-verification-final`, Vite `15173`, workerd `18787`,
  auth `18788`; suite-owned persistence ports `17887/17888`; temporary Mailpit on `1025/8025`.
  `CLAUSID_TEST_BROWSER` selected installed Google Chrome. Pinned wasm-bindgen was supplied on
  PATH. Test services and the PDF smoke server were cleaned up; local synthetic data remains ignored.
- Local logs are transient, outside Git: `/private/tmp/clausid-foundation-verify-final.log` and
  `/private/tmp/clausid-foundation-changed.log`. Existing Astryx/bundler warnings were reported;
  no screenshot, hosted email, Compose restore or Cloudflare recovery qualification was performed.
- New CI configuration, PR/merge, deployment and target-specific qualification remain pending.
  At this foundation snapshot no agent/Git hooks were installed; the subsequent
  [CSD-002 workstream](../../specs/CSD-002-agent-and-git-hooks/tasks.md) owns that follow-up.
  CSD-001 was a draft and its implementation had not begun.

No implementation commit, PR, merge, new CI result or deployment is claimed by this local record.
