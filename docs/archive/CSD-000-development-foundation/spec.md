# Historical record

Archived from `docs/specs/CSD-000-development-foundation/spec.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-000 — Agent development foundation

Status: Implementing
Owner: Clausid maintainer; implementation in the current coding-agent session
Issue: Not created; authorized by the user's implementation request
Verified against: Base 027772e plus uncommitted foundation changes; see tasks.md

## Outcome

An agent can find authoritative contracts, take a bounded task, run the same verification as CI,
and leave an evidence-based handoff. This work establishes that process without changing product
authorization, signing, storage or UI behavior.

| ID | Requirement | Acceptance |
| --- | --- | --- |
| DEV-001 | Separate instructions, architecture, domain contracts, plans, task evidence and handoffs | Linked docs and real foundation workstream; no stale roadmap presented as current |
| DEV-002 | Keep area-specific instructions scoped | Astryx app, Lumos site, Worker, auth, contracts and Rust guidance |
| DEV-003 | Local/CI use one verification catalogue | Application, PDF and operations CI jobs call the same profiles |
| DEV-004 | Change routing includes staged/unstaged/deleted/renamed/untracked and optional merge-base changes | Scratch-Git tests; unknown/gate changes widen checks |
| DEV-005 | Failing/missing/timed-out commands fail verification; spawned smoke services are cleaned up | Runner failure tests and real PDF smoke |
| DEV-006 | Report evidence limits honestly | No hooks, merge, new CI or hosted qualification claimed from local implementation |

## Exclusions

Client-boundary pilot implementation, automatic agent/Git hooks, browser concurrency isolation,
GitHub Project configuration, publication, deployment and release qualification are follow-ups.
The [draft pilot](../../specs/CSD-001-client-boundaries/spec.md) records the next candidate, not completed work.

Implementation sequence and verification are in [plan](plan.md), [tasks](tasks.md) and [handoff](handoff.md).
