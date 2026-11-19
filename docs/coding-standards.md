# Clausid coding standards

Status: Implemented locally; current verification and activation evidence is recorded in the tracker
Owner: Clausid maintainer
Verified against: accepted engineering plan and current source audit

## Goals and authority

Safety, predictable failure and maintainable ownership govern these rules. Explain the reason for
a non-obvious boundary, dependency or exception. The Worker owns permission and persistence; an
attractive browser state cannot replace those checks. Preserve reviewed artifact identity before
optimizing rendering or changing representations.

The normative TypeScript scope is maintained application/shared-contract/tooling/test source.
The independent Astro/Lumos website follows its own compiler and component rules; Rust follows
rustfmt/Clippy and its checked parser/operation contracts. Generated declarations, dependencies,
binary fixtures and historical archives are not authored application code.

## Parse at a boundary

Raw network JSON, files, persisted JSON, environment configuration and Wasm messages are unknown
until an owning parser succeeds. `JSON.parse` and `Response.json` do not establish a domain type.
Public Zod schemas belong in shared contracts; private database/attachment schemas stay beside the
backend owner. Preserve legitimate stored optional/null forms rather than silently migrating them.

```ts
const view = await api(contractViewSchema, '/' + id)
const result = contractViewSchema.safeParse(raw)
if (!result.success) throw new ProtocolError()
publishView(result.data)
```

Do not expose an unchecked `api<T>` escape hatch. A request whose result is ignored still has a
response contract. A successful HTTP status with an invalid payload is not a successful mutation.
Parse and stage binary updates before publishing either the envelope or document bytes.

## Honest state and exhaustive handling

Model mutually exclusive states with discriminated unions, not independent booleans and optional
payloads. The projection reader has missing/ready/invalid outcomes. A frozen version can explicitly
be null; this is not the same as a malformed response omitting its required version field.

```ts
switch (projection.kind) {
  case 'missing':
    return loading()
  case 'ready':
    return render(projection.data)
  case 'invalid':
    return showError(projection.message)
}
```

Adding a union variant must make incomplete handling fail compilation/lint or an explicit
exhaustiveness check. Do not use a TypeScript enum where literal unions describe protocol values.
Do not widen a domain value to string or add a fallback branch merely to silence a new case.

## Compiler and unsafe constructs

The final application/tool compiler uses strict, noUncheckedIndexedAccess,
exactOptionalPropertyTypes, noImplicitReturns, noFallthroughCasesInSwitch, noImplicitOverride,
noPropertyAccessFromIndexSignature and verbatimModuleSyntax. All application and TypeScript-tool targets use these options. TypeScript 5.9 is the compiler authority;
the bundled TS7 engine provides type-aware lint, not a second compiler gate. The website's independent strict Astro configuration remains separate.

- No explicit `any` or unsafe any assignment, argument, call, member access or return. Narrow unknown values or use a schema.
- No unchecked type assertion or non-null assertion. `as const` and `satisfies` are allowed.
- A required value is checked at runtime before use. Missing programmer state fails as an invariant;
  missing operating data returns its documented failure, not an assertion hiding a permission error.
- No `Partial<T>` function inputs. Define supported optional fields explicitly, with their validation.
- A platform adapter assertion requires a named symbol, a precise rule, rationale and regression test.
  Broad directory exemptions and permanent legacy-count baselines are not accepted.

No raw-data typed `response.json<T>()` calls: they supply a compile-time promise, not runtime proof.
Do not make a nullable field required in every legacy record to improve a compiler diagnostic.

## Failure channels and asynchronous work

At the HTTP boundary Clausid deliberately uses `HttpError`/`ApiError` with preserved status.
Validation failures become the documented safe client response. Invalid successful wire data uses
a protocol error. Programmer invariants are errors at their owner. Pure helpers can return typed
outcomes where failure is normal. This adapts Stacki's Result convention to the existing service
boundaries rather than mixing success-shaped fallbacks into failed requests.

Await promises or explicitly launch them with a handled failure path. React event adapters may
use `void` only where rejection is handled by the invoked function or a catch. Cancelling a request
must not produce a protocol failure or update unmounted state. Dispose sockets, timers, Y.Docs and
awareness listeners; preserve late-event guards when replacing a connection.

## Mutation and persistence

Use readonly inputs and collections when the function does not own mutation. React local state,
Yjs documents, SQL transactions, private buffers and protocol encoders legitimately mutate through
their owning API. Do not mutate an authorized projection to bypass a server operation.

Construct and validate candidate changes before publishing them. Preserve transaction boundaries,
account-scoped request receipts, exact expected text and digest/version witnesses. A server ack
means durable persistence. A UI Saved label must not appear while unconfirmed changes remain.
Freeze copies the reviewed artifact; it cannot invoke rendering again.

## Bounds, numbers and representation

Document the unit and source of a bound: bytes, base64 characters, Unicode scalars, milliseconds,
page indices and point coordinates are different quantities. The PDF library's 16 MiB bound does
not override the application's 1 MiB upload limit. Use source constraints at a boundary and test
both permitted and rejected values. Do not invent a new cut-off that rejects valid old responses.

The contract reference records existing collection/input limits and remaining operational limits.
Retries have stated delay/time/attempt controls. Protocol failure must not trigger an unbounded
automatic retry loop. Broad pagination, actor admission quotas and durable browser offline storage
are separate product changes, not claims made by this engineering adoption.

## Ownership and dependencies

Shared public contracts cannot import browser, auth, Worker or deployment implementations.
Web UI can consume public contracts but cannot import a backend actor as its permission system.
The Worker can use private auth policy/operations only through the existing Cloudflare adapter;
the Node auth server must not become browser code. Tests/tools may inspect their assigned source.

Every direct npm dependency, including workspace edges and development tools, has a written
purpose, platform alternative, cost and consumers in [dependencies](dependencies.md). Rust crate
records explain parsing/ABI/security costs and stay aligned with their manifests. No additional
formatter/linter/framework is added when the existing stack supplies the capability.

## Code organization, comments and tests

Keep parsing, pure decisions, persistence and presentation distinct. Name a module for its owned
behavior. Comments explain why, failure ordering, compatibility or examples; avoid narrating each
assignment. Give tests an opening goal/method comment and test the observable boundary failure.
No file/function line-count quota or assertion-density quota substitutes for a useful invariant.

Use the existing template frames and tokens. PDF Canvas overlays have coordinate/DOM requirements;
do not redesign an existing page while migrating its TypeScript or whitespace. The website is Lumos,
not Astryx. Rendered evidence is required for changed error/retry UI.

## Formatting and changing a rule

Vite+ formats maintained application/tools/docs with two-space indentation, single quotes, no
semicolons and a 160-column target, preserving import execution order. The website retains its
Astro/Prettier configuration and Rust retains rustfmt. Do not reformat generated/vendor/archive data.

Changing a compiler/linter/policy/hook rule requires its positive/negative regression, an updated
enforcement entry and a reviewed reason. Protected-file controls are guardrails, not a sandbox.
Do not bypass Git hooks, falsify trust state, enlarge exemptions or change a threshold after a
failed measurement to obtain a green result. A missing prerequisite is pending/failing verification.

## Stacki applicability

| Stacki practice                               | Clausid decision                        | Evidence mechanism                                              |
| --------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- |
| Parse, no unsafe casts/any, exhaustive unions | Adopt                                   | Schemas, compiler, type-aware lint and policy tests             |
| Strict compiler and small dependencies        | Adopt                                   | Compiler configuration, dependency records and shared gates     |
| Result values for expected failures           | Adapt                                   | Retain typed HTTP exceptions; pure decisions use typed outcomes |
| Immutability and bounded inputs               | Adapt to ownership/producer limits      | Readonly/lint review, parser limits and failure fixtures        |
| No null everywhere                            | Inapplicable to existing wire/storage   | Explicit nullable schemas and legacy compatibility fixtures     |
| Electron/preload/preview module layers        | Adapt to web/Worker/auth/contracts      | Clausid import boundaries                                       |
| Naming dictionary / assertion-density quota   | Review instead of mechanical quota      | Source ownership and meaningful invariant/test review           |
| Agent/Git/CI call the same checks             | Adopt                                   | Shared catalogue and real snapshot/client tests                 |
| Per-tool formatting/policy feedback           | Adopt for supported explicit edit paths | Harness fixtures; shell checks avoid speculative writes         |
| Desktop packaging/release caches              | Inapplicable to this web adoption       | Existing deployment qualification and no remote publication     |
| Pi extension event                            | Not installed on unsupported client     | Installed API lacks the blocking event; documented, not faked   |

## Narrow adapter evidence

`policy-exceptions.json` permits exactly two typed adapters: Worker `storedRecord` validates and
checks known-value equality before preserving the original private record; web `definedProps`
checks a plain record and removes only undefined own enumerable properties. Their negative tests
exercise invalid and non-normalizing inputs. No legacy violation count is exempted.

`createAuth` has one rule-specific lint comment for the bundled TS7 engine losing Better Auth’s
database union. TypeScript 5.9 checks the actual database type; real account and paired SQLite
recovery suites exercise the adapter. This does not suppress compiler errors or JSON parsing.
Type-aware rules apply to maintained TypeScript in compiler projects; JavaScript launch/deployment
scripts receive syntax lint and formatting. The independent website keeps its own Astro/Lumos checks.
