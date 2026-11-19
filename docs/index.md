# Clausid documentation

## Read by task

| Task                     | Read                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start contributing       | [Agent instructions](../AGENTS.md), [architecture](architecture.md), [code map](codebase.md), [development](development.md)                                                                 |
| Change a domain behavior | [Contract surface](contracts.md), feature reference, engineering plan, owning source and tests                                                                                              |
| Run checks               | [Enforcement and commands](enforcement.md), [agent/Git hooks](agent-hooks.md), [local development](runbooks/local-development.md)                                                           |
| Resume a task            | [Engineering tracker](clausid-engineering-tracker.md), [implementation plan](clausid-engineering-plan.md), [prompt pack](prompt.md), [implementation review](clausid-engineering-review.md) |
| Deploy or recover        | [Runbooks](runbooks/README.md), [qualification records](qualification/README.md)                                                                                                            |
| Understand a past choice | [Dependency decisions](dependencies.md), [decisions](decisions/README.md), [archive](archive/README.md)                                                                                     |

## Engineering references

The [codebase](codebase.md) explains the application constraint and the complete request/write
paths. The [contract surface](contracts.md) owns public shapes, representation compatibility and
state transitions. Feature references explain the ordering, ownership and failure mechanisms:

- [Identity and access](identity-and-access.md)
- [Workspace lifecycle](workspace-lifecycle.md)
- [Collaboration and review](collaboration-and-review.md)
- [PDF negotiation](pdf-negotiation.md)
- [Signing and evidence](signing-and-evidence.md)
- [Persistence and recovery](persistence-and-recovery.md)

The [coding standards](coding-standards.md) state selected rules and their rationale. The
[enforcement map](enforcement.md) distinguishes machine checks, review and personal client activation.
The [engineering program](clausid-engineering-plan.md) and [prompt.md](prompt.md) replace the
earlier generic document pack as the current implementation route. Historical CSD URLs remain
available; their evidence applies only to the trees and scopes they actually verified.

## Authority and maintenance

- Root/scoped agent instructions govern the working process. Domain contracts and accepted
  feature specifications describe intended behavior. Code and actual checks establish current
  behavior; when they disagree, record and resolve the discrepancy rather than changing a spec
  to conceal a bug.
- GitHub owns priority, human ownership and delivery status. A spec owns acceptance; its plan
  owns design; tasks own implementation evidence; a handoff owns the next action. Link them
  instead of maintaining multiple roadmaps.
- Update a contract with its behavior change. Record status, owner, issue (or `Not created`) and
  verified-against revision in each workstream spec/plan. Mark local uncommitted evidence as such.
- Keep commands in shared tooling and reference them in prose. The [enforcement map](enforcement.md)
  distinguishes executable checks, review and external qualification.
- Archive superseded plans with a status notice and updated links. Keep still-authoritative domain
  contracts current. The [historical roadmap](archive/roadmap-baseline.md) is not a task queue.

The engineering method follows the feature-reference/plan/tracker/prompt pattern inspected in
[Stacki](https://github.com/flowtricks/stacki/tree/20293df9304b924bb994b936628f59e20e27b334/docs),
adapted to Clausid's existing pnpm, Vite+, Zod, Rust and deployment boundaries. The earlier
spec/plan/tasks/handoff folder convention was a Clausid scaffold, not a copy of Stacki's organization.
Spec Kit is not installed. [Hook activation](agent-hooks.md) and required branch protection are
separate from the existence of documentation; the tracker records remaining acceptance evidence.
