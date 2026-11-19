# Historical record

Archived from `docs/specs/CSD-002-agent-and-git-hooks/plan.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-002 — Hook implementation plan

Status: Implemented locally; Codex activation unconfirmed after reported trust; CI/review pending
Owner: Clausid maintainer; current coding-agent session
Issue: Not created; authorized in the current chat
Verified against: Base 027772e plus the local foundation; evidence in tasks.md

## Architecture

Keep the existing shared catalogue/runner. Completion adapters capture `check:changed --agent`
output and emit a single valid JSON result. SessionStart records the starting commit; Stop includes
committed session changes. Bound diagnostics, check time and retries; exhausted retries explicitly
remain failures. Keep state private and ignored per worktree/session.

Pre-commit materializes the actual Git index into a disposable local clone, clears foreign Git
variables and remaps workspace dependencies to staged source. Pre-push checks each unique tip in
an isolated clone, selects profiles from old/new refs, and widens unknown/tag pushes to all.
Never stash, switch, stage or restore the user's checkout. Disable hooks only in the disposable
clone to prevent recursion. Reuse installed non-workspace dependencies; rebuild generated Wasm in
full verification. Existing custom hooks are conflicts, not installation overwrite targets.

## Assignments

1. T00: verify client protocols, local versions and existing hook state.
2. T01: shared runner capture/agent mode, snapshot support, adapters and installer.
3. T02: real Git fixture tests, actual Claude lifecycle smoke, Codex loader inspection.
4. T03: local installation, documentation, full shared gate and final handoff.

These assignments are sequential in the existing checkout. Preserve all earlier foundation changes.
Use synthetic local remotes and dummy-provider fixtures; do not commit/push the user's real branch
or change personal credentials/trust. Actual Codex trust review is a client-controlled final step.

## Verification

Use `pnpm check`, `pnpm test`, `pnpm hooks:status`, `pnpm hooks:smoke:claude`, documentation checks,
and `pnpm verify:all`. Exercise alternate Git indexes, partial staging, staged dependency resolution,
new/tag/delete refs, quoted paths, message rejection and bounded completion retries. Inspect actual
Codex hooks/list rather than equating a file with activation. Hosted CI and deployment remain pending.
