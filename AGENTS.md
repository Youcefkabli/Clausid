# Clausid agent instructions

## Reading order

1. Read the [documentation index](docs/index.md), [architecture](docs/architecture.md), and [code map](docs/codebase.md).
2. Read the scoped `AGENTS.md` for every area you change. Before working on the web app or answering Astryx questions, read [apps/web/AGENTS.md](apps/web/AGENTS.md). Website work instead follows [apps/website/AGENTS.md](apps/website/AGENTS.md).
3. For access, collaboration, persistence, signing or PDF changes, read the relevant [contract surface](docs/contracts.md) and its feature references.
4. Read [coding standards](docs/coding-standards.md), [dependencies](docs/dependencies.md), the current [engineering tracker](docs/clausid-engineering-tracker.md) and the selected [prompt](docs/prompt.md).
5. Follow [development](docs/development.md) and the current workstream's specification, plan, task evidence and handoff. Recheck the base commit and working tree before trusting historical claims.

## Work in bounded assignments

- Keep one independently reviewable task per session. Small fixes can use an issue/PR; multi-session or cross-boundary work uses [workstream artifacts](docs/specs/README.md).
- Preserve unrelated local changes. Use a separate branch/worktree for concurrent implementation and agree on shared interfaces before dependent tasks run.
- Give every worktree its own `CLAUSID_DATA_DIR`. Coordinate Vite, workerd, auth and Mailpit ports. Browser suites remain serial until the fixed persistence/Mailpit endpoints are isolated; see [local development](docs/runbooks/local-development.md).
- Keep server authorization authoritative. Preserve persisted-before-ack edits, retry semantics, reviewed PDF bytes and signature/evidence bindings.
- Parse external values at boundaries using existing Zod contracts; do not treat a TypeScript assertion as validation. Report existing gaps rather than silently claiming they are enforced.
- Record why a dependency or architectural boundary changes. Do not expand a task into a whole-repository refactor.
- Do not bypass failed checks or weaken gates to make a task pass. Changes to workflow policy and verification need explicit scope and review like other changes.

## Boundary and code policy

- HTTP helpers require a response schema, including ignored mutation results. Keep status errors separate from malformed successful responses. Parse projection JSON and server messages before publishing them.
- Stage remote Yjs bytes on a disposable document before changing the live one. Protocol failure preserves pending IDs and local text; recovery requires explicit retry.
- Derive public output types from schemas. Private persisted schemas stay in the Worker. Preserve unknown stored extensions and legitimate legacy null/optional fields.
- Use literal unions, explicit optional fields and checked invariants; no `any`, unchecked assertions, non-null assertions, enums or `Partial` escape hatches. See the named adapter exceptions and their tests.
- Record each direct dependency’s purpose, platform alternative and cost. Respect source import layers; contracts cannot import applications.
- Run `pnpm format` for deliberate maintained-file formatting and `pnpm check:local` for shared static/unit checks. `pnpm dev` runs that gate before starting services.
- Gate/instruction edits require explicit task scope. For future guarded sessions the operator launches with `CLAUSID_ALLOW_POLICY_EDITS=1`; an agent must never set that switch itself. Hooks are bounded guardrails, not a security boundary.

## Verification and delivery

- Use the [README toolchain](README.md#develop-locally). Run `pnpm check:changed` before finishing; it reports additional integration profiles, and is not the full gate.
- Application changes require `pnpm check`, `pnpm test`, and `pnpm build`. `pnpm verify` includes these plus website checks, Astryx doctor, deployment dry-run/schema parity, and the browser suite. Rust/Wasm changes also require `pnpm verify:pdf`; operations changes require `pnpm verify:ops`. Shared tooling changes require `pnpm verify:all`.
- Use `--plan` to inspect a verification command without running it. Missing tools/services are failures or pending work, never a passing result.
- Update affected contracts and the workstream task/handoff with commands actually run, results, revision, and outstanding checks. Include rendered evidence for UI changes. Do not claim staging, recovery, merge or release qualification from local checks.
- [Agent completion hooks](docs/agent-hooks.md) run the shared changed checks in supported/trusted clients. Codex requires one-time hook review; do not assume configuration alone means active enforcement. Git hooks install through `pnpm install` or `pnpm hooks:install`; inspect `pnpm hooks:status`.
- Pre-commit validates the staged snapshot; pre-push validates pushed commits with their full profiles. Do not use Git bypass options. At the completion retry limit, report the hook's **STILL FAILING** state and unresolved checks; never present it as success. [Enforcement](docs/enforcement.md) distinguishes these checks from review and qualification.
