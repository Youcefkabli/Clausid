# Verification and enforcement

The [shared catalogue](../scripts/checks/plan.mts) owns commands used by local development,
agent completion, immutable Git snapshots and [CI](../.github/workflows/ci.yml). Missing tools or
services fail. A command does not publish or deploy remotely. Use the pinned [toolchain](../README.md#develop-locally).

| Command                             | Executed checks                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check:docs`                   | Local inline/reference links, Markdown anchors, named-program/spec metadata, tracker completion consistency                                      |
| `pnpm check:policy`                 | TypeScript AST rules, source import layers, exact adapter exceptions, direct npm/Cargo dependency decisions                                      |
| `pnpm format:check` / `pnpm format` | Check/write maintained application, tool, configuration and documentation files through Vite+                                                    |
| `pnpm check`                        | TypeScript 5.9 project build checks and bundled Vite+ type-aware lint                                                                            |
| `pnpm check:local`                  | Docs, policy, format, static and unit steps from the catalogue; also runs before dev services start                                              |
| `pnpm check:changed`                | Conservative affected checks; reports required full profiles, without claiming integration passed                                                |
| `pnpm verify`                       | Local checks, website Astro diagnostics, fresh Wasm, workspace builds, Astryx doctor, Cloudflare dry-run/auth parity, real-service browser suite |
| `pnpm verify:pdf`                   | Docs, Rustfmt/Clippy/tests, fresh Wasm and a real workerd PDF round trip                                                                         |
| `pnpm verify:ops`                   | Docs, operations Rustfmt/Clippy/tests/release; deliberately needs no installed JavaScript packages                                               |
| `pnpm verify:all`                   | Deduplicated sequential union of the app, PDF and operations profiles                                                                            |

Use `--plan` on local/changed/full profiles to inspect JSON without running them. Changed checks
include staged, unstaged, deleted, renamed and untracked paths. `--base REF` also includes committed
changes from its merge base. Completion supplies the session's starting HEAD when available and
always runs local static/unit checks, even in a clean tree. Full integration is still required.

## Routing, startup and prerequisites

Protected instruction, policy, manifest, lockfile and configuration changes widen to all checks
**before** the documentation-only shortcut. The [shared path policy](../scripts/checks/protected.mts)
is used by routing and agent guards. Ordinary feature-reference Markdown runs docs checks;
application/contracts/tests select policy, format, static and unit; website selects its checker;
PDF and operations select their native static checks. Unknown/tool/deployment paths widen to all.

The [dev launcher](../scripts/dev.mjs) runs the shared local gate before building/migrating and
opening services. Browser startup allows 120 seconds for that work. App/PDF gates need Rust 1.93.1,
its Wasm target and wasm-bindgen 0.2.130. Native profiles need Rustfmt/Clippy; the app CI job installs
those components explicitly. App gates need Mailpit and Chromium. Provision prerequisites before
running; the runner starts neither Mailpit nor an installer. Browser gates remain serial; allocate
[data and ports](runbooks/local-development.md). Child steps have a 20-minute limit and termination
forwarding; tool/completion adapters use shorter limits. These are process bounds, not memory quotas.

## Rule-to-check map

| Rule / requirement                                                                                | Deterministic mechanism                                                                                   | Review or external limitation                                                                      |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Strict indexed/optional/return/override/module handling                                           | Shared TypeScript options across application and tool projects                                            | Compiler does not prove domain semantics                                                           |
| No unsafe any (including arguments), unhandled promises, incomplete switches, non-null assertions | Vite+ type-aware rules on maintained TypeScript                                                           | TS5.9 remains compiler authority; one named Better Auth/TS7 lint adapter is explained in standards |
| No enums, unchecked casts, `Partial`, typed `json<T>()`, unexplained suppressions                 | TypeScript AST policy, tested with invalid/valid fixtures                                                 | Two precise validated adapters are allowed; stale/broad/duplicate exceptions fail                  |
| Layer ownership                                                                                   | Static import, re-export and literal dynamic-import checks, including workspace aliases                   | Computed imports and runtime dependency injection need review                                      |
| Direct dependency decisions                                                                       | Manifest/Cargo metadata compared to exact documented records and required rationale fields                | Rationale quality and transitive costs need review                                                 |
| Formatting                                                                                        | Explicit maintained file list; generated/vendor/archive/website and Rust keep their owners                | Formatting is not a design review                                                                  |
| Docs coherence                                                                                    | Targets, references, Markdown headings/explicit anchors, metadata and completion rows                     | Remote links, source truth and evidence freshness need review                                      |
| Parsed wire and persisted data                                                                    | Producer-shaped fixtures, HTTP/projection tests, private-record preservation tests, staged real Yjs tests | Schema shape does not prove authorization or persistence                                           |
| Explicit protocol recovery                                                                        | Real-browser corrupted acknowledgement, retained text, retry/replay/reload and no page errors             | Tab-local unsent text is not durable across tab loss                                               |
| Agent pre/post-tool feedback                                                                      | Recognized bypass/protected-edit guards, explicit-success edit formatting and shared policy/static checks | Requires client support/trust; opaque scripts are not parsed as a shell language                   |
| Completion and Git discipline                                                                     | Bounded Stop loop and actual staged/pushed snapshots                                                      | Retry exhaustion reports STILL FAILING; Git bypasses and client opt-outs exist                     |
| Submitted revision                                                                                | CI invokes the same full profiles                                                                         | Remote CI is unverified until pushed/run; required branch protection is external                   |
| Hosted recovery/release                                                                           | Named qualification and paired-store rehearsal                                                            | Local success is not staging/production or release acceptance                                      |

The policy suite has no accepted legacy violation count. Exceptions name the rule, exact file,
owner symbol, rationale and regression. Test files begin with their observable goal/method.
JavaScript launch/deployment files receive syntax lint and formatting; Astro/Lumos and Rust retain
their own framework checks. No parallel ESLint/formatter toolchain is installed.

## Hook and snapshot controls

[Agent hooks](agent-hooks.md) document protocols and personal activation evidence. Pre-tool checks
recognize known bypasses and protected edits. Only an operator-provided client launch environment
can authorize guarded policy editing; agents cannot set that switch themselves. Post-tool checks
never stage files. Automatic formatting requires an explicit successful file edit inside the
worktree; opaque/shell calls receive read-only verification. Hooks are guardrails, not a sandbox.

Pre-commit tests the actual index despite unstaged fixes. Pre-push tests each immutable target
commit with complete profiles, including new refs/tags widening to all. Snapshot dependencies
resolve workspace source inside that snapshot; tracked-file changes during verification fail.
No cached-success marker replaces a check. Current results, failures and activation limits are in
the [engineering tracker](clausid-engineering-tracker.md), separate from historical CSD evidence.
