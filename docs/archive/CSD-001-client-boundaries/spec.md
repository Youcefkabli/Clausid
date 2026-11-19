# Historical record

Archived from `docs/specs/CSD-001-client-boundaries/spec.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-001 — Client boundary validation

Status: Draft
Owner: Clausid maintainer; implementation owner not assigned
Issue: Not created
Verified against: 027772e source inspection; no pilot implementation

## Outcome and starting evidence

HTTP responses and collaboration messages are parsed before application state or Yjs consumes
them. The current [HTTP client](../../../apps/web/src/api.ts) returns `data as T`; the
[connection](../../../apps/web/src/connection.ts) casts parsed JSON to `ServerMessage`.
This draft records a known gap; the development foundation does not fix it.

| ID | Requirement | Proposed verification |
| --- | --- | --- |
| BOUNDARY-001 | All valid current payloads remain compatible | Real producer/consumer fixtures and optional/null cases |
| BOUNDARY-002 | Malformed messages never mutate Yjs or workflow state | Negative-shape and state-preservation tests |
| BOUNDARY-003 | Failure/recovery is visible and bounded, without false Saved status | Defined reconnect/error-state tests |
| BOUNDARY-004 | Existing edit/reconnect/freeze/signing behavior remains intact | Application gate and existing browser flows |

## Scope and decisions

Use existing Zod shared contracts. First inventory every consumer; define unknown message kinds,
optional fields, user-visible errors and retry behavior before implementing. No auth redesign,
storage migration, PDF-engine change or UI redesign. Follow [collaboration](../../contracts/collaboration-and-review.md)
and [signing](../../contracts/signing-and-evidence.md). Accept a concrete plan and bounded tasks before coding.
