# Development workflow

## Intake and ownership

Reuse an existing Clausid GitHub Project and release milestone before creating another. Issues
own priority, human ownership and delivery status; use Outcome, Implementation, Discovery and
Release qualification work types from the [issue form](../.github/ISSUE_TEMPLATE/work.yml).
Do not infer current Project/release state from the [historical roadmap](archive/roadmap-baseline.md).

Ready work has an owner, outcome, scope, dependencies, acceptance criteria and verification plan.
Use Backlog → Ready → In Progress → In Review → Done. A blocked item keeps its status and records
the dependency, next action and owner. Never put contract contents or account secrets in GitHub.

## Specification to implementation

Small fixes can use the issue/PR alone. For multi-session, cross-boundary or architectural work,
use a named engineering program following the [current implementation](clausid-engineering-plan.md):

1. A feature reference documents current owners, complete flows, contracts, ordering and failures.
2. `<workstream>-plan.md` records accepted outcome, requirement IDs, compatibility, exclusions and sequence.
3. `<workstream>-tracker.md` records bounded tasks, dependencies, actual checks, revision and next action.
4. `prompt.md` or a named prompt pack supplies executable assignments: reading, owned files, implementation,
   regression cases, gates, stop conditions and delivery. The [current pack](prompt.md) is the concrete example.

The older [CSD scaffold](specs/README.md) remains as historical evidence and forwarding URLs.
Small fixes need no document pack. Reuse [prompt template](templates/prompt.md) only when they add useful detail.

The task's user instruction establishes authorized scope. Review normal implementation through
the linked PR; do not add repeated approval questions for already-authorized work. Resolve
product/compatibility decisions before dependent work. If source contradicts the spec, report it
and correct the implementation or accepted design deliberately.

## Agent sessions and review

1. Read root/scoped instructions, relevant domain contracts and the workstream handoff. Inspect
   base commit and local changes; verify historical claims before relying on them.
2. Take one independently reviewable task on its own branch/worktree when concurrent. Agree on
   shared interfaces first. Allocate storage and ports using [local development](runbooks/local-development.md).
3. Implement the bounded change with meaningful regression evidence. Run `pnpm format` and `pnpm check:local`; dev startup runs the same static/unit gate before opening services. During iteration run targeted
   checks, then `pnpm check:changed`. Run its required integration profiles before integration.
4. Review the diff independently against acceptance, authorization, persistence, retries and failure
   behavior. Link the specification and requirement IDs in the [PR template](../.github/pull_request_template.md).
5. Record commands actually run, results, revision and pending verification in tasks/handoff.
   UI changes need rendered evidence and affected browser coverage, beyond Astryx doctor.
6. Close an implementation issue only after merge and acceptance. Keep outcomes and release
   qualification open until their own evidence passes. Local completion is not merge or deployment.

Parallelize independent ownership areas after contracts stabilize. Do not parallelize dependent
schema/consumer changes or multiple edits to the same signing handler. Browser suites remain
serial until fixed persistence/Mailpit resources are isolated.

## Integration and qualification

[Shared verification](enforcement.md) defines `pnpm verify`, `verify:pdf`, `verify:ops` and
`verify:all`; [CI](../.github/workflows/ci.yml) calls those same profiles. Do not bypass a failing
gate. Missing prerequisites are pending verification/failures, not success. [Completion and Git
hooks](agent-hooks.md) call those shared commands. Confirm installation and client trust; configuration
alone is not activation. Do not bypass a failing hook. Exhausted completion retries require an
explicit unresolved handoff, never a passing claim.

Before a release, record the tested revision, target, configuration identifiers, CI, two-account
workflow, evidence digest and recovery rehearsal using the [qualification template](templates/qualification.md).
The maintainer records the final result. Use the [release runbook](runbooks/release-qualification.md);
automated local success does not establish hosted auth/email or backup recovery.

Review shipped outcomes, blockers and the next decision weekly. Evaluate automation after a few
completed assignments rather than expanding process without evidence.
