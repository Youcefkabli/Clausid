# PDF negotiation

- **PDF-001:** Retain the original PDF and annotation history. Approved replacements generate a
  distinct negotiated artifact; proposals and rejected changes do not overwrite the source.
- **PDF-002:** An edit names the source page/block, exact expected text and Unicode scalar offset.
  Reject ambiguous, overlapping, stale or unsupported edits rather than guessing a target.
- **PDF-003:** Replacements must fit the supported source line/font constraints. Unsupported input
  is an explicit failure, not a successful no-op or a silently regenerated page.
- **PDF-004:** A failed approval preserves the previous negotiated artifact and decision state.
  Unresolved applicable review items block preparation for signing.
- **PDF-005:** Freeze consumes the reviewed negotiated/original preview bytes; see [signing](signing-and-evidence.md).

Status: Living reference
Owner: Clausid maintainer
Verified against: 027772e plus the engineering implementation; see tracker

## Artifact identities

`source` is the immutable uploaded PDF. `negotiated` is generated from source plus approved
replacements/drawings. `preview` is the exact artifact reviewed for a signer set. `frozen` is a copy
of reviewed preview bytes. Annotation history is retained separately; rejecting a proposal does
not mutate source. PDF.js is a browser viewer, not the authoritative rewrite engine.

Workspace uploads are capped at 1 MiB and require a `.pdf` filename. The Rust core can accept up
to 16 MiB, bounds cross-reference objects at 100,000 and cumulative decoded streams at 64 MiB.
Those library limits do not increase the application's smaller upload/storage limits. Negotiated
output is capped at 1,900,000 bytes by the actor. See the [Rust parser](../packages/pdf-engine/src/lib.rs).

## Targeting a source passage

The [Canvas selection toolbar](canvas-design-plan.md) offers Comment, Highlight, Underline,
Strikethrough and Suggest replacement after text selection. Each selected visual line is measured
from the actual PDF.js range and normalized against its page, so marks follow text at any zoom.
Multi-line marking creates one ordinary, reviewable drawing annotation per line. The client snapshots
these rectangles, line quotes/locations and stable request IDs before posting. Partial failure retains
the selection and retry IDs; retry replays acknowledged line requests without adding duplicates.
Existing annotation capacity, digest rejection, provider approval and freeze rules still apply.
The selection captures quote, page, location and displayed digest before
focus moves. Inline comments reuse the existing annotation endpoint and retry receipt. Suggestions
retain the manual source-line fallback for ambiguous mapping. Link/text-color authoring belongs to
native drafts; imported PDF edits continue through the bounded rewrite and annotation protocols.

The page canvas owns visible PDF glyphs. The selectable DOM text layer stays transparent during
browser selection and passage/review/hover highlights. Selection adds a translucent background
without repainting fallback-font glyphs over the rendered page; copying and selection geometry
continue to use the text layer.

Hover previews use quote/location witnesses for text and actual normalized stroke paths for
drawings. Quote-only legacy comments require a unique match on their page, including multi-line
selection. Ambiguous/stale text and page-only comments use page gutter controls rather than a
guessed passage. Withdrawn items are excluded. These overlays never alter source/negotiated bytes;
the existing provider decision and frozen-artifact rules remain authoritative.

Inspected text blocks have zero-based `page` and `block`, source text and a baseline coordinate.
The public text-block query takes a one-based page and filters `block.page === page - 1`.
PDF annotations use one-based pages; persisted rewrite edits use zero-based pages.

A proposal sends exact expected text and a replacement against a source block. The actor requires
one occurrence in that line and computes the offset with `Array.from(prefix).length`: Unicode
scalar count, not UTF-16 code units or UTF-8 bytes. Drawing points are normalized to [0,1]; a PDF
location's x/y and UTF-16 text-layer offset are not interchangeable with those normalized drawing
points or the rewrite engine's Unicode-scalar offsets.

The browser sends the displayed negotiated/source digest when available. If it differs from the
current artifact, the actor returns 409 before accepting the proposal. Source-page/block identity
and exact text remain authoritative even if layout moves in the viewer.

## Planner and fit protocol

[Run::plan](../packages/pdf-engine/src/edit.rs) resolves scalar boundaries to complete glyph
boundaries, checks exact expected text, encodes the replacement with the original font, and rejects
unsupported text. Replacement width must not exceed the old source span. An edit cannot remove an
entire text block or split an encoded glyph. This is constrained source editing, not paragraph reflow.

The actor calls the Wasm planner before accepting a replacement. Overlap with an approved source
range is 409. Ambiguous/unsupported targeting is 422. Encrypted documents, existing signatures,
unsupported fonts/structures and scanned text without editable source runs are not silently regenerated.
The engine writes an incremental PDF revision and preserves unaffected source data.

## Approval ordering and failure atomicity

Only the owner decides annotations. It computes the next decision history in memory, collects all
approved non-withdrawn changes, rewrites from the original, then applies approved markup. Only after
all steps and the output size/hash checks pass does `#save` commit the decision, negotiated bytes,
revision, receipt and preview invalidation. Any exception leaves the previous artifact and decision.

There are 60 PDF annotations and 120 total annotation replies. An author can withdraw an open
drawing; withdrawal is not deletion of its history. Unresolved non-withdrawn annotations block preview.
Native review limits are separate. A preview consumes negotiated bytes when present and original
bytes otherwise, including approved marks. Freeze follows the [signing protocol](signing-and-evidence.md).

## Evidence and compatibility

Owners: [actor annotation branch](../apps/worker/src/contract.ts),
[Wasm adapter](../apps/worker/src/pdf-rewrite.ts), [edit planner](../packages/pdf-engine/src/edit.rs),
[font decoder](../packages/pdf-engine/src/font.rs), [selection mapping](../apps/web/src/pdf-selection.ts).
Evidence: [Rust corpus](../packages/pdf-engine/tests/rewrite.rs),
[worker smoke](../packages/pdf-engine/worker/smoke.mjs), [workflow](../tests/workflow.spec.ts).
Run application and PDF profiles for integrated changes. Preserve source hashes, scalar offsets,
fit rejection and explicit unsupported cases. Real customer-document fidelity needs named fixtures;
a passing synthetic round trip does not establish arbitrary PDF compatibility.

## PDF.js outline values

The browser treats PDF.js outline children and destinations as unknown. Navigation narrows a
bookmark title and array children, then accepts only a nonnegative integer page index or a
validated `{num, gen}` reference before calling the typed page-index API. Named destinations are
resolved first. Malformed entries are skipped while page/text anchors remain available. The
producer-shaped positive/negative cases are in `tests/pdf-bookmarks.test.ts`.
