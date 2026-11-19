# Clausid engineering adoption — tracker and handoff

Status: Implemented locally; Codex activation pending
Owner: Clausid maintainer; current coding-agent implementation
Issue: Not created; authorized in chat
Verified against: 027772e plus local changes; no implementation commit

Read the [plan](clausid-engineering-plan.md), [prompt pack](prompt.md), root/scoped instructions
and the latest verification record before resuming. A task is implemented locally only after its
required gate passes. Local, CI, trusted-client and hosted results are independent.

## Handoff state

- Base: `027772e`; existing uncommitted foundation and hook implementation retained.
- Before implementation, 79 changed/untracked files were hashed and backed up outside the repo.
- Existing full-gate evidence: 29 unit, five browser, ten PDF and two operations tests; that run
  qualified the foundation/hook tree, not this new program.
- Planning probes: 33 type assertions and 65 non-null assertions in 68 maintained TypeScript
  files outside the independent website; the stricter web-only compiler probe had 126 diagnostics.
  These are migration observations, not permitted final baselines.
- Codex: maintainer reported trusting hooks; last loader probe still reported untrusted. Preserve
  that conflict until a current client result proves activation. No trust bypass is authorized.
- Resources: browser qualification used isolated data and reserved serial ports. Service cleanup is recorded below. See the [resource runbook](runbooks/local-development.md).

## Assignments

| Prompt | Owned outcome                           | Dependencies | State               | Evidence                                                                                                                              |
| ------ | --------------------------------------- | ------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 00     | Baseline and adoption audit             | None         | Implemented locally | Preserved 79 existing files; baseline changed gate passed                                                                             |
| 01     | Architecture reference                  | 00           | Implemented locally | Source-traced architecture/codebase and six feature references; docs checker passed                                                   |
| 02     | Contracts, dependencies and standards   | 01           | Implemented locally | Canonical contracts, per-package dependency decisions and enforced standards; docs/policy/full gate passed                            |
| 03     | Response schemas and producer fixtures  | 02           | Implemented locally | Runtime schemas compile; producer-shaped positive/negative fixtures pass; full application gate passed                                |
| 04     | HTTP/projection consumers               | 03           | Implemented locally | Every helper supplies a parser; HTTP/projection tests pass; application integration passed                                            |
| 05     | WebSocket safety and recovery           | 03, 04       | Implemented locally | 64 unit tests and six browser workflows include staged Yjs, retained edits and explicit recovery                                      |
| 06A    | Web strictness migration                | 05           | Implemented locally | Final web flags and schema consumers pass static, unit, build and browser gates                                                       |
| 06B    | Backend strictness migration            | 03           | Implemented locally | Private record/header/service parsers and compatibility fixtures pass full application verification                                   |
| 06C    | Tooling/tests strictness and formatting | 06A, 06B     | Implemented locally | All TypeScript targets pass strict flags/type-aware lint; maintained formatting and generated-block preservation checked              |
| 07     | Policy and shared gates                 | 06C          | Implemented locally | Shared local/startup/Git/CI commands and negative policy/compiler/routing fixtures pass                                               |
| 08     | Agent lifecycle controls                | 07           | Implemented locally | Real Claude Stop/pre/post smoke, protocol fixtures and active Git hooks; Codex loader recognizes four untrusted definitions           |
| 09     | Documentation reconciliation and review | 08           | Implemented locally | Source/evidence self-review, archived CSD forwarding URLs and reconciled references; documentation checks pass                        |
| 10     | Final qualification                     | 09           | Implemented locally | Updated frozen clean install, actual staged rejection/corrected commit and immutable all-profile verification pass with 68 unit tests |

## Verification record

- 2026-11-18 / base `027772e` / program bootstrap: preserved the pre-existing changed tree;
  no real branch staging, commit, push or deployment performed. Program files describe accepted
  scope; their existence does not establish implementation acceptance.

## Next action

Implementation and clean qualification passed. Review the concrete [implementation review](clausid-engineering-review.md).
Reload/review the four current Codex definitions and verify personal activation; the loader still
reports untrusted and this implementation cannot grant trust. Remote CI/branch protection and
hosted recovery/release acceptance remain external. No real branch commit, push or deployment was made.

- Program iteration: `pnpm check` and 44 unit tests passed (seven files). Added the already-pinned
  y-protocols 1.0.7 as a direct root development dependency for real Awareness tests; offline install
  preserved active Git hooks. Consumer-schema migration and malformed-state tests compile.

- Pilot application gate passed: 44 unit tests, six Playwright workflows, fresh Wasm, workspace
  builds, Astryx doctor, Cloudflare dry-run and auth parity. Browser diagnostics then exposed an
  invalid client close code (1002); changed to application code 4002 and added a page-error assertion.
  Focused browser recovery rerun passed with no page errors; viewed error/recovered screenshots
  retain the same text through retry and reload. Evidence is in ignored `.data/engineering-evidence/`.

- Strict migration: application/auth/worker/tool compiler targets pass the final shared flags.
  Type-aware lint and source policy pass without a legacy baseline. Two precise schema/props
  adapters and one Better Auth TS7 lint limitation have named tests/rationale. No new linter stack.
- Shared local gate: `pnpm check:local` passed, including docs/policy/format/static and 61 unit tests.
  New negative fixtures cover source layers, dependency decisions, stale/broad exceptions,
  document anchors/references, protected-file routing, bypass variants, symlinks and post-tool scope.
- Live clients: `pnpm hooks:smoke:claude` passed both actual Stop and pre/post-tool phases using
  only a local fake provider. Fresh Codex `hooks/list` reported four enabled, untrusted hooks,
  with empty errors/warnings. Personal trust was not edited or bypassed.

## Final local evidence

- Clean disposable commit `6b9539c697bf48fde03d005d576845597f1d12b2` contained the implementation
  before this final documentation reconciliation. `pnpm install --frozen-lockfile` succeeded,
  including native bindings and postinstall Git hooks. The offline attempt first failed for a
  missing pinned Playwright tarball; the normal frozen install fetched it successfully.
- Actual installed pre-commit rejected a staged TypeScript error despite an unstaged repair;
  corrected staged content and commit-message checks passed. Immutable pre-push invoked
  `pnpm verify:all`: 64 unit, six browser, ten PDF and two operations tests; all static/format,
  website/build, Astryx, deployment dry-run/auth parity, Rust and fresh Wasm/workerd checks passed.
  Original branch, working tree and index were checked unchanged by the qualification driver.
- Standalone `pnpm verify:ops` passed in a disposable copy after removing all workspace
  JavaScript dependencies. This preserves the operations-only installation contract.
- Failures found and corrected during qualification: invalid browser close code; Node PIDs
  destabilizing completion digests under color warnings; imported helpers inside serialized
  browser callbacks; and party-only background cleanup requiring a dedicated identity parser.
  The color-warning environment passed a repeated local gate; all final integration cases passed.
- Viewed protocol-error/recovered screenshots retain the same text through retry/reload and show
  the correct unsaved/Saved states. They are saved under ignored `.data/engineering-evidence/`.
- Logs are temporary local evidence under `/private/tmp/clausid-adoption-*`; no credentials,
  document bodies or full logs were added to Git. Remote CI and personal Codex trust remain unverified.

- Final argument-safety audit found three remaining TypeScript trust points in private invitation
  JSON and PDF.js outline values. Added a private Zod relay parser, pure bookmark/reference
  narrowing, four producer-shaped regressions and the type-aware no-unsafe-argument rule. Auth
  directly declares the existing pinned Zod 4.6.7; dependency rationale/consumers are updated.
  The first add attempt found the existing local-store mismatch; using this checkout's actual
  store succeeded with normal postinstall and active Git hooks. Final clean requalification follows.

## Final handoff — 2026-11-19

- The final invitation/PDF bookmark refinements passed `pnpm check:local` and a new frozen clean
  installation with zero package downloads. Actual installed pre-commit again rejected a staged
  type error hidden by an unstaged fix, then accepted corrected staged content and the message.
- Immutable disposable commit `4425e973b132fd435f9dec2c0231d75b73b8591b` passed `pnpm verify:all`: **68 unit tests in 14 files,
  six browser workflows, ten PDF rewrite tests and two operations tests**, plus every configured
  documentation/policy/format/static, website/build, Astryx, deployment/auth parity, Rust and Wasm
  round-trip step. Disposable commits are evidence identifiers, not commits on the user's branch.
- A source manifest for 318 present tracked/untracked nonignored files has SHA-256
  `beeb1d9590da6a3935ad28362324b0ce4b105a5d49eb83b70fee1bc0486dab87`. It explicitly excludes this tracker and the
  review evidence record so final result recording does not change its scope. The manifest and
  viewed final-snapshot recovery screenshots are in ignored `.data/engineering-evidence/`.
- The final `pnpm check:changed` result is recorded below after this evidence-only update.
  No real branch commit/push/deployment occurred. Current Codex personal trust and remote CI
  remain separate from implementation and local qualification.

- Delivery checks: final `pnpm check:changed` passed docs, source/dependency policy, formatting,
  strict types/type-aware lint, 68 unit tests, website diagnostics and PDF/operations fmt/Clippy.
  The source manifest remained unchanged after verification; only tracker/review evidence was updated.
- Fresh final Codex loader: four enabled, untrusted definitions; no errors or warnings. Personal
  activation remains unconfirmed. Git hooks remain active; original HEAD is `027772e` and the
  real index is unstaged. All task-owned browser/persistence ports are free. The task-owned Mailpit
  process was stopped after qualification. Restart Mailpit before a future browser/full gate.
