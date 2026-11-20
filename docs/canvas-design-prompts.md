# Canvas design coding-agent assignments

Status: Assignments executed; local implementation evidence is in the tracker
Owner: Clausid maintainer and coding agent
Issue: Not created; implementation authorized in chat
Verified against: `600514c` plus the preserved local baseline

## Standing protocol

Read root/scoped AGENTS, the [plan](canvas-design-plan.md), [tracker](canvas-design-tracker.md),
[contracts](contracts.md), [collaboration](collaboration-and-review.md) and [PDF reference](pdf-negotiation.md).
Inspect HEAD and the dirty tree. Preserve existing presence/UI work. Record requirement IDs,
owned changes, commands/results, screenshots and unresolved checks after each assignment.
Use existing Astryx APIs and tokens; preserve authorization, persisted-before-ack updates,
retry receipts, source digests and reviewed/frozen PDF identities. Do not weaken failed gates.

## 00 Documentation and baseline

Own workstream plan/tracker/prompts and index links. Capture initial changed-file hashes and a
backup before code changes. Acceptance is a decision-complete linked assignment pack.
Run documentation checks. Deliver the baseline revision and next assignment.

## 01 Native formatting and export

Own shared palette/URL contracts, browser/Worker Tiptap configuration, private PDF-node parsing,
native renderer and focused regressions. Add pinned TextStyle/Color and document their cost.
Implement explicit links and fixed colors in both schemas. Validate raw mark attributes before
accepting updates. Render colors and PDF URI rectangles through wrapped text; preserve combined
marks, old drafts and review replacement inheritance. Test malformed attrs, unsupported URLs,
invalid colors, valid old/new drafts and real rendered/exported PDF output.
Stop on schema disagreement or an unvalidated mark. Run targeted tests and `pnpm check:local`.

## 02 Canvas shell and panels

Own Canvas presentation and its header composition. Retain the 36px header, avatars, Saved/error
feedback and existing dialogs. Move text formatting to context/menu controls; group drawing tools.
Implement the plan's panel breakpoints, paper margins, title and real update metadata. Do not
change PDF coordinates or application-wide templates. Verify header geometry, panel budgets and
action reachability at 1440/1024/768/390/320px. Deliver screenshots and affected browser coverage.

## 03 Selection toolbar and inline composer

Own selection UI, PDF selection callbacks and comment composition. Use Astryx Toolbar/useLayer.
Capture native anchors/PDF quote-location-digest before moving focus. Position from actual ranges,
flip/clamp and update on scroll/resize/zoom. Make native format/link/color actions keyboard usable.
Replace automatic PDF review opening with explicit Comment/Suggest actions. Implement composer
typing, Cmd/Ctrl+Enter, cancel/focus restore, dirty-draft preservation and retry-stable requests.
Reuse existing mutation callbacks. Test stale/multi-line/ambiguous selection, double submit,
network failure, keyboard interaction and mobile drawer placement. Stop on passage retargeting.

## 04 Review rail and highlights

Own native/PDF review presentation. Use compact rows with available names/initials, real timestamps,
quotes, replies and decisions. Derive counts and filters from existing states. Preserve native
resolve/reopen and PDF approval/rejection semantics. Selecting a thread navigates/highlights its
passage without storing presentation marks. Preserve provider permissions, empty states and
failure feedback. Test reply/decision/reload, stale anchors and participant view behavior.

## 05 Integrated qualification

Run targeted regressions, `pnpm check:changed` and the required `pnpm verify` profile with isolated
data/ports and serial browser suites. Inspect light/dark and responsive screenshots. In Brave on
port 5173 reopen the original uploaded PDF, submit and approve a replacement, reload, and verify
rendered wording, approval history and Saved. Verify native marks in a second authenticated client,
reload, preview/freeze and PDF output. Capture actual artifacts in ignored `.data/canvas-design/`.
Update tracker and affected references with results, revision, findings and pending evidence.
Deliver only after required gates and rendered checks pass, or state the exact concrete blocker.

## 06 Full selection annotation toolbar

Own CANVAS-007 in the plan/tracker, selection controls, PDF range geometry and affected browser
regressions. Read the current Canvas files and PDF annotation contract. Expose Comment, Highlight,
Underline, Strikethrough and Suggest replacement beside PDF selection. Expose native list/quote
controls directly at desktop widths and keep compact menus beside the selection.

Measure actual PDF.js range fragments, combine spans per visual line and normalize against the
page at the current zoom. Reuse existing drawing annotations, displayed digests, request receipts,
author undo/redo and provider approval. Keep one independent stroke per line; never draw diagonal
connectors between selected lines. Retain a partially saved batch's original IDs for retry and
keep failures visible. Do not change backend authorization, artifact identity or the annotation cap.

Exercise real selections, all direct actions, multi-line retry without duplicates, reload,
approved rendering, source preservation, mobile reachability and frozen-view restrictions.
Inspect actual rendered marks and record current checks/evidence in the tracker. Run the changed
gate and its required full profiles; a toolbar screenshot alone is not persistence evidence.

## 07 On-document hover discussions

Own CANVAS-008, document anchor resolution/geometry, hover previews/markers and affected tests.
Read the native/PDF review references and actual thread/annotation producers. Resolve native
relative positions with the quote witness without changing selection. Match PDF quotes/locations
uniquely; use actual paths for drawings. Do not guess a stale or ambiguous passage.

Show author/time, content/replacement, replies and state on hover. Group overlapping discussions,
provide focus previews and marker activation into the existing review panel, and keep hover from
interfering with text selection or drawing. Recompute after edits, PDF loads, zoom and resize.
Exclude withdrawn and unauthorized review data. Use Astryx HoverCard and presentation decorations;
do not add persistent marks or change source/frozen bytes. Verify actual pointer/keyboard behavior,
stale/ambiguous/withdrawn cases, responsive rendering and unchanged document revision on hover.
Run the shared changed/full gates and record rendered evidence and current limitations.
