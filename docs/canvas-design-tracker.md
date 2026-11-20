# Canvas design tracker

Status: CANVAS-001–008 and PDF highlight rendering correction locally verified on 2026-11-19
Owner: Clausid maintainer and coding agent
Issue: Not created; implementation authorized in chat
Verified against: `600514c` and the current uncommitted implementation

## Starting point

Branch `codex/engineering-adoption`; 26 pre-existing changed/untracked paths include presence and
UI consistency refinements. Their bytes and hashes are preserved in ignored
`.data/canvas-design/baseline/`. Plan and acceptance are in the [implementation plan](canvas-design-plan.md).

| Assignment                                    | Requirements   | State    | Evidence                                       |
| --------------------------------------------- | -------------- | -------- | ---------------------------------------------- |
| 00 Documentation and baseline                 | CANVAS-001–006 | Complete | Baseline archive/hash manifest and linked pack |
| 01 Native formatting and PDF export           | CANVAS-004     | Complete | Validator units and actual exported PDF checks |
| 02 Canvas shell and responsive panels         | CANVAS-001     | Complete | Rendered 1440/1024/768/390/320px evidence      |
| 03 Selection toolbar and inline composer      | CANVAS-002–003 | Complete | Real selection, retry and mobile drawer test   |
| 04 Review presentation and passage navigation | CANVAS-005     | Complete | Native resolution and PDF approval persisted   |
| 05 Regression and rendered qualification      | CANVAS-006     | Complete | Shared full gate and original Brave PDF passed |

## Implementation evidence

Native link/color attributes now have one shared contract across browser editing, Worker
validation and PDF rendering. The pinned TextStyle dependency is documented. PDF URI annotations
cover wrapped spans and explicit colors survive preview/freeze. Replacement approval preserves
marks shared across the replaced passage, including a link ending at a paragraph boundary.
Select All around a single block is normalized to its inline content before replacement.

Canvas retains the 36px header, participant state and existing document authorization. The paper,
panels, contextual controls, comment composer and compact author/review rows follow the accepted
plan. At 640px and below the left rail also carries review actions. Native model selection is
authoritative when DOM selection briefly lags responsive reparenting or popover focus.

`tests/canvas.spec.ts` exercises link add/edit/remove and unsafe URL rejection, bold and color,
a failed comment request with the same retry ID, resolve/reload, approved replacement mark
inheritance, a second authenticated client, actual PDF colors/URI annotations, identical
preview/frozen bytes, responsive controls and frozen-view editing restrictions. Existing browser
workflows use the explicit PDF selection actions and Edit menu. Unit tests validate old drafts,
combined marks, the entire palette and malformed external mark attributes.

The focused browser regression also creates a PDF comment from an actual page-2 selection,
reloads, then verifies its exact quoted selection and temporary highlight through the history
row. Rendered QA exposed an initial-load race in this navigation. History now waits for the PDF
passage index before matching an anchor, and a digest change clears the previous index.
Test setup scrolls lazy pages into view and honors the existing 60-second auth retry window.

## Commands and rendered evidence

- `pnpm check:changed` passed, including 79 unit tests and the applicable static/format profiles.
  It requires the full `verify:all` integration profile for these dependency/contract changes.
- `pnpm verify:all` passed with Node 24.11.1, pnpm 10.33.0, the installed Chrome executable and
  `/private/tmp/clausid-pdf-tools/bin` on PATH. It includes check/test/build, website checks,
  Astryx doctor, Cloudflare dry-run/auth schema parity, all 8 serial browser scenarios, 10 PDF
  engine tests, the workerd/Wasm PDF round trip, and 2 operations tests/release build.
  Data was isolated in `.data/canvas-design/final-run`; ports were 15173/18787/18788. Mailpit was
  the existing local service. The complete output is `.data/canvas-design/verify-all.log`.
- Focused `tests/canvas.spec.ts` passed with the standard server workflow and in the full gate.
  Initial failed/interrupted runs are retained separately. QA corrected the stale four-panel
  assertion, lazy-page test setup, auth retry waits and the actual PDF navigation race. No gate,
  permission assertion, signature binding or retry requirement was removed.
- Inspected 1440/1024/768/390/320px layouts, light/dark chrome, inline/drawer comments and the
  selected PDF passage after reload. QA corrected clipped compact actions, drawer overflow and
  duplicate drawer headings. Final copies are local and ignored in `.data/canvas-design/final/`.
  The browser test regenerates these images in `test-results/`; `canvas-pdf-comment.png` shows
  the confirmed thread and exact highlighted passage. Source/artifact hashes are recorded in
  `.data/canvas-design/final/manifest.json`.
- Brave on `http://127.0.0.1:5173` opened original document
  `582aa829-9242-4a70-a74a-3aa58e00ac72`. Approved the non-overlapping demo replacement
  `4,800,` → `4,000,`, reloaded, then observed USD 4,000, both approved history entries, zero open
  suggestions and Saved. The previous 15 → 10 business-day approval remained intact. Screenshot
  and accessibility evidence are in `.data/canvas-design/final/brave-original-pdf-reloaded.*`.
  The local Worker was reloaded with its existing bindings and contract volume; auth was retained.

## Initial implementation handoff

All six assignments and required local checks are complete. Results describe the uncommitted
tree based on `600514c9efee449096796ec73ce007aea72b721d`, with source/artifact hashes in the final
manifest. Of the 26 initial dirty paths, 15 are byte-identical and 11 were deliberately extended
for the design, shared contracts, feature references or affected regressions. The baseline archive
retains their original bytes. The original port-5173 app remains available; isolated verification
services are stopped. Existing Mailpit and unrelated development stacks are retained.

No required local checks remain outstanding. Local results do not establish hosted staging,
remote CI or release qualification. Changes are uncommitted; no push or deployment was requested.

## CANVAS-007 — Full selection annotation toolbar

User request: show annotation controls beside selected text so header navigation is unnecessary.
Owner: Clausid maintainer and coding agent. Issue: Not created; authorized in chat.
State: Complete; locally verified. Base remains `600514c`; the 42-path starting tree is archived in ignored
`.data/canvas-toolbar/starting-tree.tar.gz` with hashes in `baseline.json`.

Implement direct PDF Highlight/Underline/Strikethrough controls, selection geometry and retry-safe
existing annotation mutations. Expose native list/quote controls beside selection. Keep provider
decisions and reviewed PDF bindings. Verify actual line geometry, reload, retries, approvals,
small-screen reachability and read-only restrictions. Record current check results and rendered
evidence here; the earlier results above apply to the earlier uncommitted tree.

The focused standard Playwright run passed. It exercises native list/quote controls and direct PDF
Underline/Strikethrough actions, then fails the second line of a two-line Highlight operation and
retries the same two IDs. Exactly two highlights persist. Reload preserves all five review items;
provider approval renders the marks, the immutable source remains identical, and freeze hides the
selection toolbar. All five PDF actions fit at 390/320px. Viewed desktop/approved/mobile screenshots
are copied to `.data/canvas-toolbar/final/`. Initial test setup corrections account for existing
selection dragging, PDF.js word spans and lazy page rendering after approval.

The manual Brave check was stopped by the client's user-changed guard while the browser was in
active use. No manual selection check was completed for this follow-up. The original port-5173
services remain available, with web source updates served by Vite. Current rendered interaction
evidence comes from the real Chrome test with isolated services.

Final qualification: `pnpm verify:all` passed 79 unit tests, all 8 browser scenarios, 10 PDF engine
tests and 2 operations tests, plus static/format/docs/policy checks, website diagnostics, builds,
Astryx doctor, deployment dry-run/auth parity and the workerd/Wasm PDF round trip. The full log is
`.data/canvas-toolbar/verify-all.log`. Data was isolated in `.data/canvas-toolbar/qualification`
on ports 15173/18787/18788 with the existing Mailpit service. Final `pnpm check:changed` results
are in `.data/canvas-toolbar/check-changed.log`; the required full profile has been completed.

This follow-up extends 8 previously dirty paths and changes 3 previously clean tracked web files.
The other 34 starting paths are byte-identical. Source/artifact hashes are recorded in
`.data/canvas-toolbar/final/manifest.json`. Isolated test services are stopped; the original app
and existing unrelated services remain running. Changes are uncommitted, with no push/deployment.
No required automated local checks remain outstanding. The manual Brave limitation above and
hosted/remote qualification remain separate from the passing local gate.

## CANVAS-008 — On-document hover discussions

User request: annotations and comments appear on the document on hover.
Owner: Clausid maintainer and coding agent. Issue: Not created; authorized in chat.
State: Complete; locally verified. Base remains `600514c`; the 45-path starting tree and hashes are preserved in
ignored `.data/canvas-hover/starting-tree.tar.gz` and `baseline.json`.

Implemented Astryx hover previews with author/time, content/replacement, replies and state.
Overlapping discussions share one card. Gutter markers provide keyboard previews and click/tap
access to the review panel. Native Yjs positions and exact quotes resolve without changing selection.
PDF location witnesses, unique multi-line quotes and actual drawing paths determine hit areas.
Stale/ambiguous text and page-only PDF comments use page markers; stale native anchors remain in
history. Withdrawn items and signer-only overlays stay hidden. Hover is suppressed while selecting
or drawing. Decorations never persist or change source, negotiated or frozen bytes.

Five anchor unit cases cover stale locations, ambiguous legacy quotes, multi-line selection,
UTF-16 offsets and drawing-path hit testing. The standard Canvas browser regression covers native
hover without a revision change, author/reply content, copying preview text, keyboard navigation,
live PDF replies, overlapping discussions, withdrawal, reload, approval and imported-PDF freeze.
At 390/320px it checks viewport fit, actual painted hit targets, stable screenshots and marker
navigation into Comments. Initial iterations corrected preview text-selection dismissal, layout
pointer-leave races and a clipped virtual anchor that suppressed painting despite a visible layout
box. Passage decoration is translucent so PDF image glyphs remain readable below the text layer.
The full-suite assertion was scoped to its review panel to avoid matching the closing composer.

`pnpm verify:all` passed 84 unit tests in 17 files, all 8 browser scenarios, 10 PDF engine tests
and 2 operations tests, plus static/format/docs/policy checks, website diagnostics, builds,
Astryx doctor, deployment dry-run/auth parity and the workerd/Wasm PDF round trip. The complete
passing log is `.data/canvas-hover/verify-all.log`. Final data was isolated in
`.data/canvas-hover/qualification-final-3` on ports 15173/18787/18788 using the existing Mailpit
service. Earlier interrupted and port-conflict runs do not qualify the final tree. Viewed native,
PDF, overlapping-discussion and mobile screenshots are in `.data/canvas-hover/final/`.

This follow-up extends 11 of the 45 starting paths; 34 remain byte-identical. It adds three files
and changes the previously clean `navigation.ts`. Source/artifact hashes are recorded in
`.data/canvas-hover/final/manifest.json`. Final `pnpm check:changed` results are recorded in
`.data/canvas-hover/check-changed.log`; its required full profile has been completed.

No required automated local checks remain outstanding. Isolated verification services are stopped;
the original app and unrelated services remain available. Current interaction evidence comes from
real Chrome with isolated services; no new manual Brave verification was performed for this task.
Changes are uncommitted. Hosted staging, remote CI and release qualification remain separate.

## PDF selection highlight rendering correction

User report: highlighting text displays a distorted duplicate over the document.
Owner: Clausid maintainer and coding agent. Issue: Not created; authorized in chat.
State: Complete; locally verified. Base remains `600514c`; the 49-path starting tree and hashes are preserved in
ignored `.data/pdf-highlight-fix/starting-tree.tar.gz` and `baseline.json`.

The isolated Brave reproduction confirmed that browser selection changed the PDF text-layer
foreground from transparent to black (`HighlightText`), repainting fallback glyphs over the page
canvas. The added Canvas regression fails on that foreground while the three custom highlights
remain transparent. The selected-page screenshot and trace are saved under
`.data/pdf-highlight-fix/before/`; the expected failing run is `reproduction.log`.

PDF selection ink now stays transparent with a translucent background. The selected quote/geometry,
annotation actions, approval persistence and reviewed PDF bytes retain their existing behavior.
Viewed before/after Brave screenshots confirm the second set of glyphs is removed. Final selection,
comment, hover and approved-mark screenshots are in `.data/pdf-highlight-fix/final/`.

`pnpm verify:all` passed 84 unit tests in 17 files, all 8 browser scenarios in isolated Brave,
10 PDF engine tests and 2 operations tests, plus static/format/docs/policy checks, website diagnostics,
builds, Astryx doctor, deployment dry-run/auth parity and the workerd/Wasm PDF round trip. The passing
log is `.data/pdf-highlight-fix/verify-all.log`; final `pnpm check:changed` results are recorded in
`.data/pdf-highlight-fix/check-changed.log`. Its required full profile has been completed.
Data was isolated in `.data/pdf-highlight-fix/qualification` on ports 15173/18787/18788 with the
existing Mailpit service. The original port-5173 app remains available with the CSS fix served by Vite.

Only selection CSS, the Canvas regression, this tracker and the PDF reference changed in this
follow-up; the other 45 starting paths remain byte-identical. Source/artifact hashes are recorded
in `.data/pdf-highlight-fix/final/manifest.json`. Isolated verification services are stopped.
No required local checks remain outstanding. Changes are uncommitted; hosted staging, remote CI
and release qualification remain separate from these local results.
