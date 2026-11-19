# Clausid engineering adoption — implementation plan

Status: Implemented locally; client activation and external qualification are separate
Owner: Clausid maintainer; coding agent implementing the accepted chat plan
Issue: Not created; implementation explicitly authorized in the current chat
Verified against: 027772e plus the preserved uncommitted foundation; see the tracker

## Decision

Adopt Stacki's engineering method: explain the actual code, specify boundaries and failure
behavior, assign bounded changes, and enforce deterministic rules through the same code for
agents, Git and CI. Reference revision: `20293df9304b924bb994b936628f59e20e27b334`.
This is a Clausid implementation, without Spec Kit or Electron-specific conventions.

The maintainer selected a Stacki-style document organization, implementation of the HTTP/WebSocket
validation pilot, and no unexplained legacy violations of the adopted rules at completion.
The earlier CSD documents record the foundation; their short summaries are not documentation parity.

## Architecture and compatibility

The Worker remains the authorization and persistence authority. React owns interaction, Yjs owns
native draft collaboration, and LiveStore is an in-memory projection. Better Auth owns identity.
Rust/Wasm applies supported PDF replacements; freeze stores reviewed bytes, not a new rendering.
No endpoint, storage format, consent text, PDF artifact format or namespace key is migrated here.

Shared response schemas derive the client-facing types. Every HTTP consumer supplies a parser.
Output parsing preserves legitimate optional/null fields and account ID formats, ignores additive
fields, and does not normalize server values. HTTP status errors remain `ApiError`; invalid
successful payloads are protocol errors. Empty successful responses are validated explicitly.

WebSocket envelopes are parsed before use. Binary Yjs changes are tried against a disposable
copy before changing the live document. A protocol failure retains pending changes, stops automatic
retry, and offers an explicit retry. Ordinary network/session reconnect behavior remains intact.
Private storage schemas stay beside the backend that owns them rather than entering browser bundles.

## Program requirements

| ID           | Requirement                                                   | Acceptance                                                                                     |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| DOC-001      | Source-grounded architecture and feature references           | Complete flows, source symbols, ownership, ordering, failures and compatibility                |
| DOC-002      | Canonical contract surface                                    | Producers/consumers, valid/invalid examples, state transitions, units, limits and tests        |
| DOC-003      | Executable assignments and living evidence                    | Every prompt names scope, regression cases, gates and delivery; tracker records actual results |
| BOUNDARY-001 | Every consumed response is parsed                             | Producer-compatible fixtures, no unchecked request-helper generic                              |
| BOUNDARY-002 | Invalid messages cannot publish document data                 | Negative HTTP, projection and Yjs/awareness/pending-state tests                                |
| BOUNDARY-003 | Protocol recovery is explicit and bounded                     | Error feedback, retained unsaved work and user-initiated retry                                 |
| POLICY-001   | Adopted deterministic rules have no unexplained violations    | Strict compiler/linter and repository-policy gates, narrow documented adapters only            |
| POLICY-002   | Dependencies, source layers and documentation remain coherent | Deliberate failure fixtures and a rule-to-check map                                            |
| AGENT-001    | Harnesses, Git and CI call shared controls                    | Protocol tests, real staged/pushed snapshots and client evidence                               |
| AGENT-002    | Gate changes and bypass commands are guarded                  | Quoted-path and protected-edit tests; no agent-created approval override                       |

## Sequence

Execute [prompt.md](prompt.md) and update the [tracker](clausid-engineering-tracker.md).
Prompts 00–02 establish the baseline and references; 03–05 implement the boundary pilot;
06 migrates strictness; 07 adds shared policy gates; 08 adds lifecycle controls; 09 reconciles
documentation; 10 qualifies the final tree. Predecessor evidence must pass before dependent work.
The implementation request authorizes the whole program; individual future sessions can take one prompt.

## Verification and rollout

Keep the pinned Node/pnpm/Vite+/Zod/Rust stack. Use Vite+ formatting/type-aware lint and the
existing TypeScript API for repository-specific checks. Do not add a parallel ESLint toolchain.
Compiler migration fixes callers before enabling the final shared flags. No permanent violation
baseline or blanket folder exemptions are accepted. Platform exceptions name a rule, owning
symbol, reason and test; suppressions without those facts fail review/checks.

Run `pnpm check:changed` during each assignment, `pnpm verify` for application changes, and
`pnpm verify:all` for shared-tooling changes and final qualification. Keep standalone operations
verification usable without JS dependencies. Browser suites are serial, with owned data/ports.
Test the real immutable index/commit snapshots, not only fake commands in small fixtures.

Installation of new protected-file guards follows the authorized migration to avoid bootstrap
deadlocks. Future policy editing requires an operator-provided launch switch. Codex trust is
personal client state; configuration, loader recognition, user review and a successful live hook
are separate evidence. A missing activation result stays pending, never becomes an assumed pass.

## Exclusions and delivery

No deployment, publication, automatic commit/push, database migration or legal qualification.
Preserve the existing dirty-tree work. Keep the Astryx generated guidance and independent Lumos
website rules. Review UI error/retry feedback visually without redesigning existing templates.
Archive superseded planning prose with forwarding notices; do not erase historical evidence.
