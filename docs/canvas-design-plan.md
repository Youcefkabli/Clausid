# Canvas design implementation plan

Status: Implemented and locally verified on 2026-11-19
Owner: Clausid maintainer and coding agent
Issue: Not created; implementation authorized in chat
Verified against: `600514c` plus the preserved presence/UI work; see the [tracker](canvas-design-tracker.md)

## Accepted outcome

Implement the four supplied visual references through a centered paper surface, selection toolbar,
inline comment composer and compact review rail. Keep the 36px application header, participant
avatars and existing synchronization feedback. Native drafts gain explicit links and a named text
color palette. Comments remain text-only. AI, attachments and application-wide redesign are outside
this assignment.

| Requirement | Acceptance                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| CANVAS-001  | Compact header, readable paper, responsive navigation/review panels and existing PDF geometry            |
| CANVAS-002  | Selection toolbar follows native/PDF selection, keyboard focus, zoom and scrolling                       |
| CANVAS-003  | Inline comments preserve the anchored passage, failed text and retry identity; confirmed threads persist |
| CANVAS-004  | Native links/colors validate, collaborate, reload and export into the reviewed PDF                       |
| CANVAS-005  | Review rail exposes real author/time/state, filters, replies and existing provider decisions             |
| CANVAS-006  | Real browser evidence, shared checks and original port-5173 PDF approval/reload pass                     |
| CANVAS-007  | Selecting text exposes its annotation actions beside the passage, without opening the header tools       |
| CANVAS-008  | Hovering annotated passages or drawings shows their discussions on the document, with keyboard access    |

## Interaction and layout contract

At 1280px and above, Comments starts open and navigation starts collapsed. Panels are resizable.
From 901 to 1279px only one panel expands at a time. At 900px and below, panels use drawers.
At 760px and below secondary native selection actions move into More; the comment drawer starts
at 640px. All actions remain reachable at
320px; navigation and review share one left rail at this width to preserve the paper budget.
Paper has an 840px maximum width and token-based 48px/24px desktop/mobile native insets.
PDF page dimensions, zoom, text-layer geometry and page separation remain owned by the viewer.

Native selection offers text style, marks, lists, color, link, Comment and Suggest replacement.
PDF selection offers Comment, Highlight, Underline, Strikethrough and Suggest replacement with
the existing source-line fallback. Text marks follow each selected visual line and use the existing
normalized drawing protocol, digest check, retry receipts and provider decisions. A multi-line
selection creates one reviewable mark per line. Native desktop selection exposes list/quote actions
directly; compact formatting menus remain beside the selection. All PDF text-mark actions fit at 320px.
Formatting is also reachable through Edit. Frozen/signer views retain reading/signing behavior.
The toolbar anchors above the selected range, flips below and stays within the viewport. It
updates on selection, scroll, resize, zoom and panel layout changes without losing the passage.

Comment opens an anchored composer. Enter creates a newline; Cmd/Ctrl+Enter submits. The existing
800-character bound applies. The composer retains failed text and request identity, never silently
retargets a dirty draft, and opens the confirmed thread in Comments after success. Escape restores
document focus. Switching panels preserves unsent text within the current document. Small screens
use a drawer composer. Thread highlights are temporary decorations, not stored document marks.

Annotated passages and drawings expose a hover preview containing author/time, comment or
suggestion, replies and current state. Overlapping discussions share a preview. Gutter markers
provide focus previews and click/tap access to the existing review panel. Hover does not select
text or write document state, and is suppressed during selection/drawing. Positions follow edits,
PDF loading, zoom and scrolling. Stale/ambiguous anchors do not attach to unrelated text;
page-only PDF comments have gutter markers. Withdrawn items and signer-only review data stay hidden.

Native colors are Default (remove mark), Gray `#5f6368`, Red `#b91c1c`, Amber `#92400e`, Green
`#166534`, Blue `#1d4ed8` and Purple `#6d28d9`. Explicit color overrides link blue. Links use
absolute HTTP, HTTPS or mailto URLs and an explicit add/edit/remove interface. No automatic links.
The existing Yjs channel carries link/textStyle marks. Worker validation checks attributes before
persistence; renderer parsing retains them. PDF output includes matching colors and wrapped URI
annotations. Existing drafts remain readable and frozen PDFs retain their recorded bytes.

## Implementation and qualification

Execute the [assignments](canvas-design-prompts.md) sequentially and record actual results in the
[tracker](canvas-design-tracker.md). Preserve the initial dirty tree, captured in ignored
`.data/canvas-design/baseline/`. Use installed Astryx components, Neutral theme and existing fonts.
Record the pinned text-style dependency in [dependency decisions](dependencies.md).

Verify formatting, comment retries, stale passages, invalid marks, permissions, collaboration and
PDF output. Inspect 1440/1024/768/390/320px layouts and light/dark chrome. Run `pnpm check:changed`
and `pnpm verify`; inspect rendered Brave evidence and the original PDF on port 5173. Matching
Worker and web assets must be loaded together. No deployment/publication is part of this task.
