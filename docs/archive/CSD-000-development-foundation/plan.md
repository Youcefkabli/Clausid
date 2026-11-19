# Historical record

Archived from `docs/specs/CSD-000-development-foundation/plan.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-000 — Foundation implementation plan

Status: Implementing
Owner: Clausid maintainer; current coding-agent session
Issue: Not created; authorized in the current chat
Verified against: Base 027772e plus local changes; evidence in tasks.md

## Design

Preserve pnpm/Vite+/Zod/Rust and existing deployment URLs. Add an indexed docs tree with domain
invariants extracted from owning source and tests. Archive the old `a248d85` roadmap with its
historical status. Add scoped instructions without changing the generated Astryx block.

Use native Node TypeScript scripts with no new dependency. `plan.mts` owns commands/routing;
`run.mts` runs a selected profile or prints `--plan`. Change discovery uses Git arguments and NUL
separators, including deleted/renamed/untracked paths and optional merge-base diff. Unknown paths
widen checks. Documentation checks inspect links/metadata, not semantic truth.

App verification preserves the existing CI checks and adds explicit website/Astryx verification
and a fresh Wasm build before the Worker build. PDF smoke uses its own port and bounded cleanup.
CI provisions prerequisites and calls the same catalogue; no duplicated command chain or remote
deployment is added. Operations requires no JS install because its profile uses only Node/Rust.

## Sequence

1. T00: inspect baseline and existing evidence.
2. T01: docs, instructions and workstream templates.
3. T02: shared catalogue, routing, runner and meaningful regression tests.
4. T03: connect CI, README and review templates; run full profiles and record results.

These tasks run sequentially in the existing clean checkout. No separate agents/worktrees are
needed. Browser checks use an isolated data directory and coordinated ports; Mailpit remains a
prerequisite and fixed persistence ports mean browser gates stay serial.

## Verification

Run docs, `pnpm check:changed`, unit tests, types/lint and `pnpm verify:all` with pinned tools,
Mailpit and Chromium. Record missing prerequisites/failures without skips. Review the final diff
and task evidence. CI is pending until submission; hosted qualification is explicitly excluded.
