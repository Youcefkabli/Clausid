# Clausid engineering adoption — coding-agent prompt pack

Status: Active reusable prompt pack; adoption implementation is recorded in the tracker
Owner: Clausid maintainer
Issue: Not created; complete program authorized in chat
Verified against: 027772e plus local foundation; current evidence is in the tracker

These are executable assignments for the [engineering plan](clausid-engineering-plan.md).
Copy one complete numbered prompt into a coding-agent session. Read the
[tracker](clausid-engineering-tracker.md) first; do not repeat a completed step against stale facts.
The maintainer's current implementation request authorizes the complete program. For later
sessions, one prompt is one bounded assignment. The shared rules below apply to every prompt.

## Standing execution rules

TASK: Execute only the selected assignment. Do not silently expand it into another product feature.

READ FIRST: Root/scoped AGENTS, architecture, codebase, canonical contracts, selected prompt,
engineering plan and latest tracker. Reinspect the actual owning code; a document is not proof.

STARTING FACTS: Record branch, HEAD, pre-existing dirty files, dependency evidence, tool versions,
known failures and owned data/ports. Preserve unrelated work. Do not reset/stash the user's tree.
Use a separate worktree for authorized concurrent implementation and one writer per file.

IMPLEMENTATION: Parse external data before use. Keep server authorization authoritative. Retain
persisted-before-ack updates, account-scoped retries, reviewed PDF bytes and consent/digest bindings.
Do not add packages without purpose, platform alternative, cost and a manifest/lockfile change.

REGRESSION CASES: Cover the original symptom and rejected input/state, not merely an implementation
helper returning its own constants. Use current producer fixtures and real Git/services where needed.

GATES: Run the named targeted checks, `pnpm check:changed` and the required full profiles. Missing
tools/services are failures or pending work. Do not weaken tests, alter thresholds after measuring,
use verification bypass flags, or set a policy-edit approval switch from the agent's own command.

STOP CONDITIONS: Stop dependent work for an unresolved compatibility decision, failing prerequisite,
or contradiction that would require expanding scope. Record the evidence and exact next action.
Do not turn a failed gate or exhausted hook retry into success. Personal trust belongs to the client.

DELIVERY: Update the tracker with requirement IDs, files, tree/revision, actual commands, results,
failures and next action. Keep local, CI, trusted-client and hosted evidence separate. No automatic
commit, push, deployment or claim of merge. Report changes and rationale, not just a test count.

## PROMPT-00 — Reproduce the baseline

TASK: Establish a reproducible starting point without implementing application changes.

READ FIRST: Engineering plan; current tracker; existing CSD-000/CSD-002 evidence; package manifests;
shared check catalogue, runner, snapshot and installer; local-development runbook.

OWNED AREAS: Tracker baseline/evidence and reference audit only.

IMPLEMENTATION:

1. Verify HEAD and dirty files against the handoff. Inventory existing source/config changes before editing.
2. Confirm Node 24.11.1+, pnpm 10.33.0, Rust 1.93.1, its Wasm target, wasm-bindgen 0.2.130 and browser/Mailpit availability.
3. Run the current changed-file gate. Record the last full-gate tree separately from the new implementation.
4. Recount assertion/compiler findings and classify the Stacki rules as adopted/adapted/inapplicable.
5. Inspect supported client events; retain the Codex trust discrepancy rather than assuming review activated it.

GATES: Baseline command has an actual result; source facts and resource ownership are recorded.

DELIVERY: Mark baseline locally verified only after the gate passes. Name the next document assignment.

## PROMPT-01 — Explain the application from source

TASK: Replace the component inventory with an engineering architecture reference.

READ FIRST: Public Worker `route`, `Directory`, `workspaceSharing`, `Contract.#serial/#save/#view`,
auth `createAuth`, web `connectContract/openStore`, PDF adapter and both deployment configurations.

OWNED AREAS: Architecture/codebase documentation and their navigation links; no runtime changes.

IMPLEMENTATION:

1. Trace signup/session forwarding, workspace reservation/setup, membership redemption and contract access.
2. Trace browser edit → WebSocket → serialized actor → SQL transaction → acknowledgement → projection.
3. Trace source PDF → proposal → approval → negotiated artifact → preview → freeze → signature → evidence.
4. Explain VPS workerd/private auth/volumes versus Cloudflare Durable Objects/D1/email, including trust boundaries.
5. Identify state owners and invalidation, retries, failure channels and generated versus maintained artifacts.
6. Link current source symbols and tests. Separate current behavior, historical decisions and proposed improvements.

REGRESSION CASES: A new reader can locate each write boundary and explain why a directory listing
does not authorize contract access, why LiveStore is not durable storage, and why freeze cannot render again.

GATES: Documentation checks and changed-file checks pass; all flow arrows have owning source references.

## PROMPT-02 — Specify contracts and draft standards

TASK: Write the canonical contract surface, feature references, dependency records and standards matrix.

READ FIRST: Shared Zod inputs and emitted response types; Worker routing and actors; auth policy;
PDF engine limits/planner; operations verifier; actual npm/Cargo manifests and existing test suites.

OWNED AREAS: Contract/feature/dependency/standards references and navigation; no schema behavior changes.

IMPLEMENTATION:

1. Inventory each consumed HTTP response and every server-message variant, including ignored mutation replies.
2. Record field types, optional/null conventions, units, page bases, ID formats, offsets and producer bounds.
3. Document authorization, transactions, duplicate requests, expiry, rollback and failure responses per operation.
4. Distinguish workspace display status from Draft/Awaiting signatures/Signed/Voided contract transitions.
5. For each direct dependency, record purpose, why the platform is insufficient, cost and consumers.
6. Draft coding rules with rationale, Clausid examples and exact proposed check/review mechanisms.
7. Keep new strictness marked proposed until callers migrate and the enforcement gate is active.

REGRESSION CASES: Cover missing/invalid/stale/unauthorized/repeated requests and old optional fields.
Every claimed invariant names source and evidence; unsupported input and unqualified deployment cases stay explicit.

GATES: Contract inventory covers all current client calls; links resolve; no anonymous rule exceptions.

## PROMPT-03 — Add response contracts and producer fixtures

TASK: Replace hand-maintained response-only types with types derived from runtime schemas.

READ FIRST: Shared contracts, Worker `Contract.#view/#send`, workspace listing/parties routes,
preview and PDF text-block producers; compatibility section of the canonical contract reference.

OWNED AREAS: Shared public response schemas and boundary fixture tests.

IMPLEMENTATION:

1. Add schemas for summaries, contract views, workspaces, parties, previews, text blocks, access and acknowledgements.
2. Define all five server-message variants and error/empty response handling. Preserve actual account IDs and nulls.
3. Accept additive object fields; reject malformed consumed fields without coercing or normalizing output.
4. Derive public types from schemas and preserve exports used by both producers and consumers.
5. Build fixtures from actual producer shapes, including older nullable/optional workspace and contract data.

REGRESSION CASES: Every response shape accepts its valid producer fixture and rejects corrupted required fields.
Test all message variants, malformed base64, unknown message kinds, null version and additive fields.

GATES: Targeted contract tests, root check/test and application verification pass.

## PROMPT-04 — Parse HTTP and projection data

TASK: Remove the unchecked `request<T>` return and projection JSON casts.

READ FIRST: Web API helpers, `main`, `ContractPage`, workspace parties, PDF annotations, table/form
templates, store projection readers and all request-helper call sites.

OWNED AREAS: Web request/projection helpers, their consumers and boundary regression tests.

IMPLEMENTATION:

1. Require a response schema in every API helper and infer its result. Do not retain an optional parser escape hatch.
2. Preserve body/method selection, abort signals, HTTP statuses and safe fallback error messages.
3. Parse ignored mutations and explicit empty responses too. Distinguish a bad successful payload from an HTTP failure.
4. Replace projection string casts with missing/ready/invalid typed readers and visible error feedback.
5. Preserve valid existing data and cancellation; do not publish malformed data or log document bodies.

REGRESSION CASES: Malformed JSON, wrong shapes, 204, non-JSON errors, cancellation and invalid projection
data leave application projections and last valid document data unchanged.

GATES: No unchecked helper usage remains; targeted tests and application verification pass.

## PROMPT-05 — Make WebSocket recovery safe

TASK: Validate messages before live document/presence changes and implement explicit protocol recovery.

READ FIRST: `connectContract`, `ContractPage` connection feedback, shared message schemas and
the actor's state/edit/ack/presence/error producers and persisted-before-ack transaction.

OWNED AREAS: Web connection/recovery code, focused protocol tests and affected browser tests.

IMPLEMENTATION:

1. Parse every envelope and decode/try Yjs updates on a disposable copy before applying to the live document.
2. Reject unknown/bad variants without changing the live document, awareness, projections or pending edits.
3. Stop automatic retries for protocol failure, show unsaved/error state and retain the pending queue.
4. Add an explicit retry preserving the same document and pending IDs; leave ordinary session/network reconnect intact.
5. Validate state plus draft together before publishing either; only valid acknowledgements can clear pending IDs.

REGRESSION CASES: Invalid initial state, malformed edit, bad ack/presence, invalid binary update,
valid replay, frozen/access-ended state, ordinary reconnect and explicit retry after a protocol error.

GATES: State-preservation tests, existing collaboration browser workflows and application verification pass.
Capture the rendered error/retry state using existing Astryx components without redesigning the template.

## PROMPT-06A — Migrate web strictness

TASK: Fix web diagnostics and unchecked assumptions before enabling final shared strict flags.

READ FIRST: Compiler probe, shared response types, scoped Astryx instructions and current web call sites.

OWNED AREAS: Web TypeScript and its targeted tests. Preserve existing UI behavior and component frames.

IMPLEMENTATION: Replace assertions with parsers/narrowing, handle indexed access explicitly, omit absent
optional properties deliberately and handle async failures. Keep platform mutation within its owner.
Run the strict compiler probe after each group; do not add assertions or broaden types to silence it.

GATES: Web passes the adopted flags; targeted tests and application verification pass.

## PROMPT-06B — Migrate backend strictness

TASK: Remove unsafe backend boundary assumptions without changing valid storage or wire formats.

READ FIRST: HTTP/session forwarding, private actor records, workspace sharing, socket attachments,
operations snapshots and Wasm results; persistence and signing contracts.

OWNED AREAS: Worker/auth private parsers and strictness fixes, compatible stored-record fixtures and tests.

IMPLEMENTATION: Parse unknown JSON into private schemas/guards beside the owner. Preserve old optional/null
forms, distinguish malformed storage from missing data, and never erase/rewrite stored bytes on parse failure.
Replace non-null assertions with explicit invariant checks and preserve transaction/digest behavior.

GATES: Backend strict probes, old-record compatibility tests and application verification pass.

## PROMPT-06C — Migrate tools/tests and activate compiler flags

TASK: Finish strictness across maintained tooling/tests and activate shared compiler options.

READ FIRST: Runner, snapshot, installers, hook adapters, all verification tests and compiler references.

OWNED AREAS: Maintained TypeScript tools/tests, final compiler settings and deliberate formatting changes.

IMPLEMENTATION: Fix remaining assertions/index/optional assumptions, preserve test meaning, and enable
the adopted strict flags once all consumers pass. Format maintained files with existing formatters;
keep historical/generated/vendor material and import execution order intact. No legacy-count baseline.

GATES: All compiler targets pass; policy inventory has no unexplained findings; full verification passes.

## PROMPT-07 — Add policy gates

TASK: Make selected standards, dependency records, source layers and document structure executable.

READ FIRST: Standards/enforcement matrix, Vite+ configuration, shared check catalogue/routing,
documentation checker, manifests and all three CI jobs.

OWNED AREAS: Shared policy/format/docs checks, their tests, command wiring, startup and CI prerequisites.

IMPLEMENTATION: Use the existing Vite+ and TypeScript API. Add negative fixtures for each custom rule,
reject stale/broad exceptions, check dependency records and protected-file routing, and reuse the shared
catalogue from local/agent/Git/CI. Preserve JS-free standalone operations verification. Startup runs
static checks before services; browser readiness budgets reflect that work rather than bypassing it.

GATES: Deliberate bad fixtures fail; valid counterparts pass; existing runner/snapshot tests and full gate pass.

## PROMPT-08 — Add lifecycle guardrails

TASK: Extend shared agent controls to supported pre/post-tool events while preserving completion and Git checks.

READ FIRST: Installed harness protocols, current adapters, private session state, policy file list,
snapshot tests and the documented Codex trust discrepancy.

OWNED AREAS: Shared pure policy verdicts, harness adapters/configuration, fixtures and installed-client smoke.

IMPLEMENTATION: Reject recognized bypass commands and protected edits without operator authorization.
Do not let an agent set its own approval override. Format only explicit successful-edit paths inside
the worktree; shell results receive checks without speculative formatting. Bound inputs, logs and time.
Emit harness-valid JSON and do not rely on unsupported Codex pre-tool `ask`. Install guards after
authorized migration work. Keep Stop's three-identical/six-chain retry limits and explicit failed handoff.

GATES: Quoted/nested paths, bypass spellings, malformed payloads, protected edits, post-edit scope,
partial staging and immutable pushed snapshots pass regression tests. Record actual client support/trust.

## PROMPT-09 — Reconcile references and review

TASK: Review final code against documentation, requirements and adopted Stacki practices.

READ FIRST: Final source, every program requirement and tracker entry, contract surface, feature refs,
standards/enforcement/dependencies and the pinned Stacki reference.

OWNED AREAS: Documentation reconciliation and an independent review record; runtime fixes return to their owner.

IMPLEMENTATION: Verify source references, examples and failure descriptions; update mechanisms from
proposed to enforced only with evidence. Archive old plans with forwarding notices and preserve IDs.
Check every rule's disposition and every adopted rule's check/review evidence. Remove stale pilot-gap claims
only after the pilot tests pass. Do not substitute document length for complete engineering coverage.

GATES: No placeholder references, unexplained exceptions or inconsistent task status; docs and changed checks pass.

## PROMPT-10 — Qualify the final tree

TASK: Verify the final implementation and leave a precise handoff.

READ FIRST: Tracker, qualification runbook, resource ownership, hook activation guide and full shared plan.

OWNED AREAS: Qualification evidence and any clearly assigned regression fixes; no publication/deployment.

IMPLEMENTATION: Run clean-install verification and the real staged/pushed snapshot paths. Run all
integration profiles with the pinned tools, isolated data and owned services. Capture UI feedback evidence.
Inspect Git installation and client hook trust; distinguish loaded definitions, personal review and
actual lifecycle execution. Stop owned services, inspect ports, and record remaining CI/client/hosted items.

GATES: Final full verification passes on the recorded tree, selected policy violations are zero, all
requirements have evidence, and no pending external item is represented as passed.

DELIVERY: Summarize changed behavior, rationale, exact verification and material limits. Keep remote CI,
trusted Codex lifecycle and hosted release/recovery pending until their own evidence exists.
