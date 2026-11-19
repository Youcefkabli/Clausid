# Historical record

Archived from `docs/specs/CSD-002-agent-and-git-hooks/spec.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-002 — Automatic completion and Git hooks

Status: Implemented locally; Codex activation unconfirmed after reported trust; CI/review pending
Owner: Clausid maintainer; implementation in the current coding-agent session
Issue: Not created; explicitly authorized in the current chat
Verified against: Base 027772e plus local CSD-000/CSD-002 implementation; see tasks.md

## Outcome

Supported coding agents automatically check their work before completion. Commits and pushes
check the content they actually publish, using the same commands as local verification and CI.

| ID | Requirement | Evidence |
| --- | --- | --- |
| HOOK-001 | Supported completion clients call shared changed checks, including session commits and clean-tree compiler checks | Payload, command configuration, baseline and runner tests |
| HOOK-002 | Check failures continue the agent within a bounded retry budget; exhaustion reports failure | Retry/reset tests and actual Claude lifecycle smoke |
| HOOK-003 | Git installation is local, idempotent and preserves custom hook configuration | Installer/fixture tests and actual checkout status |
| HOOK-004 | Pre-commit checks staged content without changing the index or dirty files | Real partial-staging and workspace dependency tests |
| HOOK-005 | Pre-push checks unique pushed commits; unknown bases/tags widen verification | Real local bare-remote tests and selection tests |
| HOOK-006 | Commit messages retain existing style with a concise subject and separated body | Message tests; no conventional-commit prefix required |
| HOOK-007 | Activation evidence distinguishes configuration, trust and actual runner execution | Codex hooks/list result and Claude local-response smoke |

## Scope

Codex/Claude lifecycle adapters, staged/pushed snapshots, three Git hooks, local installation,
shared runner changes and regression evidence. Pi, per-tool policy interception, branch protection,
publishing, Spec Kit installation and the client-boundary pilot are excluded. Personal Codex trust
must be reviewed through the client; do not forge trust records or bypass that protection.
