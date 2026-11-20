# Dependency decisions

Status: Living reference
Owner: Clausid maintainer
Verified against: all maintained npm workspace manifests and direct Cargo declarations

Every direct dependency has a record: what it does, why the platform does not replace it, and
what it costs. The manifests and lockfiles own exact versions; this file owns the engineering
reason. A workspace edge is a dependency too. Generated/vendor manifests are excluded.
The engineering policy gate checks npm record/manifest agreement; Rust declarations are recorded
below and qualified by Cargo metadata/build gates. A package removal must remove its unused record.

Do not add a second framework/linter/formatter to solve a problem already handled by the pinned
stack. Vite+ provides application lint/format/test; the independent website retains Astro/Prettier.
Third-party runtime code, generated Wasm and native binaries have distinct ownership and update costs.

## npm workspace dependencies

### `npm:@astrojs/check`

**Does:** Checks the independent Astro website and generated template types.
**Why not the platform:** Root TypeScript checks do not understand Astro templates.
**Cost:** Website compiler/checking install; keep separate from Astryx rules.
**Consumers:** [apps/website/package.json](../apps/website/package.json).

### `npm:@astryxdesign/cli`

**Does:** Inspects components/templates and checks built application setup.
**Why not the platform:** The browser/compiler cannot infer Astryx setup requirements.
**Cost:** Development tooling and upstream warnings; doctor is not visual/accessibility qualification.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@astryxdesign/core`

**Does:** Supplies the contract app components, tokens and template frames.
**Why not the platform:** Native HTML alone does not implement the adopted product component system.
**Cost:** Framework styling/build requirements and accessibility/visual review beyond doctor checks.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@astryxdesign/theme-neutral`

**Does:** Supplies the existing application theme and fonts.
**Why not the platform:** The platform does not provide the agreed design tokens/theme.
**Cost:** Theme bundle and asset integration; keep it aligned with the component version.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@clausid/contracts`

**Does:** Shares public Zod request/response schemas and derived types between producers/consumers.
**Why not the platform:** Duplicated per-app interfaces drift and cannot prove runtime input shape.
**Cost:** Workspace coupling and compatibility tests; backend-private records must not leak into it.
**Consumers:** [apps/web/package.json](../apps/web/package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:@cloudflare/workers-types`

**Does:** Types Worker bindings and Durable Object interfaces.
**Why not the platform:** Node/browser standard libraries do not contain these runtime APIs.
**Cost:** Development types must match the deployed compatibility/runtime surface.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:@emnapi/runtime`

**Does:** Supports the website starter native/Wasm compiler runtime dependency.
**Why not the platform:** The browser/Node platform does not supply the package's N-API/Wasm bridge.
**Cost:** Upstream runtime/platform compatibility; preserve the starter requirement until a measured removal.
**Consumers:** [apps/website/package.json](../apps/website/package.json).

### `npm:@fontsource/noto-sans`

**Does:** Provides embedded font assets for native PDF output.
**Why not the platform:** System fonts are not stable across workerd/Cloudflare deployments.
**Cost:** Bundled font bytes and limited supported character coverage.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:@heroicons/react`

**Does:** Provides template-compatible React icons.
**Why not the platform:** The browser has no matching icon set.
**Cost:** Asset/library duplication with other adopted templates; avoid new icon systems without a reason.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@livestore/adapter-web`

**Does:** Provides the in-memory browser adapter used for workflow projections.
**Why not the platform:** React state alone does not implement the selected query/materialization interface.
**Cost:** Wasm/browser initialization and lifecycle; it is not durable contract storage.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@livestore/livestore`

**Does:** Materializes authorized summaries/views into queryable browser projections.
**Why not the platform:** The platform does not supply reactive SQLite projections.
**Cost:** Runtime/Wasm payload and schema lifecycle; server access remains authoritative.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@pdf-lib/fontkit`

**Does:** Embeds and measures fonts for generated native draft PDFs.
**Why not the platform:** The PDF generator needs font metrics/encoding beyond platform canvas APIs.
**Cost:** Font processing and compatibility with unsupported characters.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:@playwright/test`

**Does:** Runs real browser workflows against workerd, Better Auth, SQLite and Mailpit.
**Why not the platform:** Node unit tests cannot exercise browser editing/session behavior.
**Cost:** Browser downloads and service orchestration; suites share fixed endpoints and run serially.
**Consumers:** [package.json](../package.json).

### `npm:@stylexjs/stylex`

**Does:** Expresses compiled template styles and component tokens.
**Why not the platform:** The existing Astryx integration expects StyleX compilation semantics.
**Cost:** Build/runtime configuration and style compatibility; preserve template frames.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@stylexjs/unplugin`

**Does:** Compiles StyleX declarations through Vite.
**Why not the platform:** The browser cannot execute the selected compile-time styling pipeline.
**Cost:** Build integration and plugin compatibility with Astryx/StyleX.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@tiptap/core`

**Does:** Builds and validates the adopted ProseMirror schema.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:@tiptap/extension-collaboration`

**Does:** Connects native editor content to the shared Y.Doc.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@tiptap/extension-collaboration-caret`

**Does:** Displays collaborative cursors from awareness.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@tiptap/extension-text-style`

**Does:** Supplies the TextStyle and Color marks used by the native browser editor and Worker schema.
**Why not the platform:** contenteditable does not provide schema-compatible collaborative formatting.
**Cost:** One pinned Tiptap extension package, using the existing 3.34.0 core and ProseMirror peers.
**Consumers:** Web native selection controls, Worker draft validation and native PDF export.

### `npm:@tiptap/react`

**Does:** Integrates the editor lifecycle with React.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@tiptap/starter-kit`

**Does:** Supplies the supported native document nodes/marks.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:@tiptap/y-tiptap`

**Does:** Maps Yjs fragments and relative review anchors to ProseMirror positions.
**Why not the platform:** The existing collaborative rich-text model requires these editor/protocol integrations.
**Cost:** Schema/version coupling and editor lifecycle; use compatibility and reconnect/review tests.
**Consumers:** [apps/web/package.json](../apps/web/package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:@types/better-sqlite3`

**Does:** Provides compile-time declarations for better-sqlite3.
**Why not the platform:** The selected JavaScript package/platform does not expose these declarations through the current compiler setup.
**Cost:** Development-only version alignment; types do not validate runtime data.
**Consumers:** [apps/auth/package.json](../apps/auth/package.json).

### `npm:@types/node`

**Does:** Provides compile-time declarations for node.
**Why not the platform:** The selected JavaScript package/platform does not expose these declarations through the current compiler setup.
**Cost:** Development-only version alignment; types do not validate runtime data.
**Consumers:** [package.json](../package.json).

### `npm:@types/nodemailer`

**Does:** Provides compile-time declarations for nodemailer.
**Why not the platform:** The selected JavaScript package/platform does not expose these declarations through the current compiler setup.
**Cost:** Development-only version alignment; types do not validate runtime data.
**Consumers:** [apps/auth/package.json](../apps/auth/package.json).

### `npm:@types/react`

**Does:** Provides compile-time declarations for react.
**Why not the platform:** The selected JavaScript package/platform does not expose these declarations through the current compiler setup.
**Cost:** Development-only version alignment; types do not validate runtime data.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@types/react-dom`

**Does:** Provides compile-time declarations for react-dom.
**Why not the platform:** The selected JavaScript package/platform does not expose these declarations through the current compiler setup.
**Cost:** Development-only version alignment; types do not validate runtime data.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:@vitejs/plugin-react`

**Does:** Transforms React/JSX and supports the development refresh lifecycle.
**Why not the platform:** The browser cannot consume authored JSX directly.
**Cost:** Build-time plugin/version alignment.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:astro`

**Does:** Builds and serves the independent Lumos website.
**Why not the platform:** Static source templates/components need Astro compilation.
**Cost:** Separate compiler/assets and deployment lifecycle; not an application storage service.
**Consumers:** [apps/website/package.json](../apps/website/package.json).

### `npm:better-auth`

**Does:** Owns verified identities, passwords, session/reset and account flows on SQLite/D1.
**Why not the platform:** The platform does not provide this application identity policy.
**Cost:** Security updates, schema migrations and hosting adapter compatibility; preserve persistent secrets.
**Consumers:** [apps/auth/package.json](../apps/auth/package.json), [apps/web/package.json](../apps/web/package.json).

### `npm:better-sqlite3`

**Does:** Provides the private Node auth database.
**Why not the platform:** The selected auth adapter uses this synchronous SQLite driver.
**Cost:** Native build, WAL/recovery discipline and platform ABI handling.
**Consumers:** [apps/auth/package.json](../apps/auth/package.json).

### `npm:esbuild`

**Does:** Bundles the standalone Worker and smoke/deployment artifacts.
**Why not the platform:** Node does not bundle Worker imports/assets by itself.
**Cost:** Native development binary and generated-output compatibility.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:fflate`

**Does:** Creates and reads signing-evidence ZIPs and archive fixtures.
**Why not the platform:** The Worker/browser platform has no equivalent ZIP directory API.
**Cost:** Bundle size and archive parsing limits; preserve exact PDF bytes.
**Consumers:** [package.json](../package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:lib0`

**Does:** Encodes awareness protocol updates consumed by y-protocols.
**Why not the platform:** The browser does not ship the Yjs binary protocol.
**Cost:** Wire-format coupling; use the pinned version and test presence behavior.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:lucide-react`

**Does:** Provides icons used by application templates and annotation controls.
**Why not the platform:** The browser has no product icon set.
**Cost:** Bundled assets and overlapping icon packages inherited from templates.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:nodemailer`

**Does:** Delivers verification/reset/invitation mail from the private auth service over SMTP.
**Why not the platform:** Node has no complete SMTP/MIME client for these flows.
**Cost:** Network/TLS configuration and delivery failure/retry handling; never log mail tokens.
**Consumers:** [apps/auth/package.json](../apps/auth/package.json).

### `npm:pdf-lib`

**Does:** Renders native contract PDFs and applies approved drawing markup.
**Why not the platform:** The Worker/browser has no equivalent PDF creation/modification API.
**Cost:** PDF memory/font support and byte-fidelity tests; do not regenerate reviewed bytes on freeze.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:pdfjs-dist`

**Does:** Displays PDF pages/text layers and selections in the browser Canvas.
**Why not the platform:** Built-in browser PDF viewers do not expose the required selection/render control.
**Cost:** Worker/Wasm/assets and PDF compatibility; PDF.js rendering does not authorize rewrite targets.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:prettier`

**Does:** Formats the independent Astro website with its existing configuration.
**Why not the platform:** The selected Astro formatting pipeline needs this formatter.
**Cost:** Development install and formatting churn; preserve the package-specific CSS width setting.
**Consumers:** [apps/website/package.json](../apps/website/package.json).

### `npm:prettier-plugin-astro`

**Does:** Parses Astro component syntax for the website formatter.
**Why not the platform:** A plain JavaScript formatter cannot preserve Astro template syntax.
**Cost:** Version alignment with Astro/Prettier; formatting is not a visual regression test.
**Consumers:** [apps/website/package.json](../apps/website/package.json).

### `npm:react`

**Does:** Composes the interactive application and its state/lifecycle.
**Why not the platform:** The selected Astryx/Tiptap UI requires React.
**Cost:** Framework runtime and hook lifecycle; effects must dispose sockets, documents and awareness.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:react-dom`

**Does:** Mounts the React application into browser DOM.
**Why not the platform:** React rendering requires its DOM adapter.
**Cost:** Framework version alignment and browser lifecycle behavior.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:typescript`

**Does:** Compiles maintained application/tools and provides syntax APIs for policy checks; the website uses its own compiler version.
**Why not the platform:** JavaScript runtimes do not check TypeScript contracts or inspect its syntax trees.
**Cost:** Development/compiler weight and compiler-version compatibility; do not replace runtime parsing with type checking.
**Consumers:** [package.json](../package.json), [apps/website/package.json](../apps/website/package.json).

### `npm:vite`

**Does:** Aliases the pinned Vite+ core for application bundling.
**Why not the platform:** The authored modules/assets need the existing bundler integration.
**Cost:** Alias/toolchain compatibility; do not install a second independent Vite version for the app.
**Consumers:** [apps/web/package.json](../apps/web/package.json).

### `npm:vite-plus`

**Does:** Owns the pinned development/build/lint/format/unit-test toolchain.
**Why not the platform:** Node does not provide a web bundler, typed linter or browser transform pipeline.
**Cost:** Toolchain/platform binaries and configuration compatibility; shared commands must remain reproducible.
**Consumers:** [package.json](../package.json).

### `npm:workerd`

**Does:** Runs the real Worker/Durable Object runtime locally and on VPS.
**Why not the platform:** Node does not implement Cloudflare Durable Object SQLite/WebSocket semantics.
**Cost:** Native runtime, compatibility date, namespace identity and storage-version qualification.
**Consumers:** [apps/worker/package.json](../apps/worker/package.json).

### `npm:wrangler`

**Does:** Bundles and dry-runs the native Cloudflare deployment, bindings and D1 schema path.
**Why not the platform:** Local Node/workerd cannot validate the hosted deployment configuration alone.
**Cost:** Development install weight and Cloudflare integration coupling; dry-run is not hosted qualification.
**Consumers:** [package.json](../package.json).

### `npm:y-protocols`

**Does:** Tracks transient collaborative awareness and cursor states.
**Why not the platform:** The platform does not implement Yjs awareness clocks/encoding.
**Cost:** Protocol coupling and cleanup; presence is not durable or signed.
**Consumers:** [package.json](../package.json), [apps/web/package.json](../apps/web/package.json).

### `npm:yjs`

**Does:** Represents collaborative native drafts and relative review anchors.
**Why not the platform:** A text string has no concurrent-update reconciliation or relative-position semantics.
**Cost:** CRDT schema/update compatibility, bounded retained state and deterministic persisted-before-ack handling.
**Consumers:** [package.json](../package.json), [apps/web/package.json](../apps/web/package.json), [apps/worker/package.json](../apps/worker/package.json).

### `npm:zod`

**Does:** Parses external requests/responses and derives shared public types.
**Why not the platform:** TypeScript types disappear at runtime; a cast does not validate data.
**Cost:** Schema/runtime bundle and compatibility maintenance; validation does not establish authorization.
**Consumers:** [package.json](../package.json), [apps/auth/package.json](../apps/auth/package.json), [apps/worker/package.json](../apps/worker/package.json), [packages/contracts/package.json](../packages/contracts/package.json).

## Rust dependencies

### `cargo:flate2`

**Does:** Decodes bounded Flate streams in the PDF engine.
**Why not the platform:** Rust std does not implement PDF Flate decompression.
**Cost:** Compression CPU/memory; keep rust_backend and decoded-byte limits.

### `cargo:serde`

**Does:** Derives Rust wire/manifest serialization for Wasm and operations.
**Why not the platform:** Rust std has no derive-driven structured serialization.
**Cost:** Compile-time macros and schema compatibility with TypeScript/JSON.

### `cargo:serde_json`

**Does:** Parses/serializes Wasm commands and operations manifests.
**Why not the platform:** Rust std has no JSON parser.
**Cost:** Input limits and representation compatibility; malformed data must fail explicitly.

### `cargo:sha2`

**Does:** Verifies backup/evidence SHA-256 digests offline.
**Why not the platform:** Rust std has no cryptographic digest implementation.
**Cost:** Cryptographic dependency/version maintenance; digest equality is not independent authenticity.

### `cargo:wasm-bindgen`

**Does:** Generates Worker-compatible JS/Wasm bindings.
**Why not the platform:** The raw Wasm ABI cannot directly expose these Rust values/lifetimes.
**Cost:** Pinned CLI/crate agreement and generated assets; rebuild rather than hand-edit dist.

### `cargo:zip`

**Does:** Reads backup/evidence archives with duplicate/ambiguity checks.
**Why not the platform:** Rust std has no ZIP reader.
**Cost:** Archive parsing/resource limits and compression support; deflate only is enabled.
