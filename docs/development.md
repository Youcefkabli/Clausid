# Development workflow

## GitHub setup

Reuse the Clausid Project if one exists. Otherwise, create one private Project for the repository. Check existing releases and milestones before adding a release target.

| View | Configuration |
| --- | --- |
| Roadmap | Table of outcome and discovery issues grouped by Horizon (Now, Next, Later). Use labels `outcome` and `discovery` to filter the view. Sub-issues follow the parent outcome. |
| Delivery | Board of actionable issues grouped by Status (Backlog, Ready, In Progress, In Review, Done). Use Priority (High, Normal, Low) to order work and Area to filter ownership. Use the area names from [Architecture](architecture.md). |
| Release | Table filtered by the selected release milestone. Include a dedicated qualification issue in each milestone. Add dates when the maintainer commits to them. |

Assign active issues to a human owner. Apply the `blocked` label when work cannot advance. Leave the current status in place and record the dependency, next action, and owner in the issue.

## Agent handoff

1. Move an issue to Ready when it has an owner, outcome, scope, dependencies, acceptance criteria, and verification plan. Agree on shared interfaces before parallel implementation.
2. Give each agent session one issue and its own branch or worktree. Isolate dev data and coordinate local ports. Start with one task at a time, then parallelize independently mergeable work.
3. Open a PR linked to the issue. Record actual checks and pending verification. Use the existing CI jobs. Include rendered evidence and the Astryx built-output check for web changes, Playwright coverage for affected workflows, and Rust/Wasm and workerd checks for processor changes.
4. Close an implementation issue when its PR merges and its criteria pass. Close outcome issues when their acceptance evidence is attached. Close the release qualification issue after staging checks pass and the maintainer records the tested revision and result.

Review the board weekly. Record shipped work, qualified outcomes, blockers, and the next decision. After several completed issues, review elapsed time from In Progress to Done and time blocked to decide what to automate.

## Progress mapped to the roadmap

This snapshot uses `a248d85` as the implementation baseline. Its [GitHub Actions run](https://github.com/Youcefkabli/Clausid/actions/runs/43786747201) passed the application verification and standalone PDF processor jobs.

| Plan item | Completed work | Remaining work |
| --- | --- | --- |
| Development setup | Astryx CLI and scoped agent guidance (`8a8c8c0`). Architecture, workflow, issue form, and PR template (`a248d85`). | Verify and configure the Project, seed active issues, and run the first tracked issue through PR review. GitHub listed zero issues, milestones, and releases when checked. Project inventory requires the `read:project` scope. |
| **Now** — Establish the workspace-to-signature baseline | Core self-hosted collaboration, signing, evidence, and recovery foundation (`2ab3b70`). Astryx login, settings, workspace wizard, and canvas (`a7703c0`, `d029102`). Provider-only workspace sharing and approval (`93f3b38`), followed by the canvas header update (`f2bbc5c`). Baseline coverage is mapped below and CI passed on the referenced revision. | Assign a staging owner and qualify a named revision. Exercise two verified accounts, live edits, provider-only approval, freeze, signing, evidence download, and Compose volume restore. Record the SHA-256 comparison of the restored PDF against its evidence manifest. Keep the outcome open until staging evidence is attached. |
| **Next** — Decide where the standalone PDF processor fits | Standalone Rust/Wasm editing processor, optional workerd service, fixtures, and CI smoke check (`c38fe59`). | Confirm the existing-PDF editing use case, fixture set, and resource budgets. Record fidelity, unsupported inputs, failure behavior, and runtime and memory measurements. Decide whether to integrate, narrow, or defer. Track any signing-path change separately. |
| **Later** — Gather pilot feedback on workspace, editing, and signing | Pilot findings are unrecorded in the repository. | Capture recurring problems and a ranked recommendation. Promote a candidate to an outcome when it has a defined result and verification method. Keep identifying information and contract contents out of GitHub. |

Seed the Project with the open Now and Next outcomes and the Later discovery issue. Link the existing commits and CI run as evidence. Add staging qualification as a separate issue under Now and in the selected release milestone. Use that issue to track access, ownership, and the staging run.

## Workflow baseline coverage

| Behavior | Automated evidence |
| --- | --- |
| Verified users, live edits, reconnect, exact preview and frozen bytes, signatures, and evidence digest | [Workflow browser test](../tests/workflow.spec.ts) |
| Provider-only sharing and approval | [Workspace authorization browser test](../tests/workflow.spec.ts) |
| Restore of account, draft, and signed artifact | [Persistence browser test](../tests/persistence.spec.ts) |

The [CI verify job](../.github/workflows/ci.yml) runs type and lint checks, unit tests, build, and the Playwright suite with Mailpit. The PDF processor job checks the standalone processor. The persistence test restores local SQLite data and checks that the PDF bytes match. Release qualification also exercises the documented Compose volume restore in staging and compares the restored evidence PDF hash with its manifest.
