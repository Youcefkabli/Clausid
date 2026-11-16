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

## Initial GitHub issues

Use this list to seed the Project. Once the issues exist, use GitHub for their status and evidence.

- **Now outcome — Establish the workspace-to-signature baseline.** Close when a named revision has linked CI and staging evidence covering verified accounts, live edits, provider-only approval, freeze, signing, digest verification, and restoration of both SQLite volumes.
  - **Implementation — Map baseline behavior to automated checks.** Link the relevant Playwright cases, identify missing coverage, and record which commands run in the existing CI jobs. This is the first agent workflow pilot.
  - **Release qualification — Verify the workflow and restore in staging.** Assign a staging owner. Record the revision, CI run, staged workflow results, and restore results. Verify SHA-256 of the restored frozen PDF against the evidence manifest. Flag the issue as blocked if staging access or ownership is pending.
- **Next outcome — Decide where the standalone PDF processor fits.** Evaluate existing-PDF text edits as the proposed use case. Before marking the evaluation Ready, confirm the user workflow, fixture set, and runtime and memory budgets. Record fidelity, unsupported-file behavior, failure handling, and resource measurements. Require accepted output to reopen and render the requested edit while preserving unaffected content. Record a decision to integrate, narrow, or defer. Open a separate issue for any signing-path change.
- **Later discovery — Gather pilot feedback on workspace, editing, and signing.** Capture recurring problems, supporting observations, and a ranked recommendation. Promote a candidate to an outcome once it has a defined result and verification method. Keep identifying information and contract contents out of GitHub.

## Workflow baseline coverage

| Behavior | Automated evidence |
| --- | --- |
| Verified users, live edits, reconnect, exact preview and frozen bytes, signatures, and evidence digest | [Workflow browser test](../tests/workflow.spec.ts) |
| Provider-only sharing and approval | [Workspace authorization browser test](../tests/workflow.spec.ts) |
| Restore of account, draft, and signed artifact | [Persistence browser test](../tests/persistence.spec.ts) |

The [CI verify job](../.github/workflows/ci.yml) runs type and lint checks, unit tests, build, and the Playwright suite with Mailpit. The PDF processor job checks the standalone processor. The persistence test restores local SQLite data and checks that the PDF bytes match. Release qualification also exercises the documented Compose volume restore in staging and compares the restored evidence PDF hash with its manifest.
