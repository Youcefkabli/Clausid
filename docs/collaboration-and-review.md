# Collaboration and review

- **COLLAB-001:** An accepted draft update is persisted before acknowledgement. Replayed update
  IDs do not apply the same edit twice. Presence is transient and not a signed artifact.
- **COLLAB-002:** The open tab may queue brief offline edits and resend after reconnect. It must
  surface unsaved changes if access ends or the contract freezes; it must not claim those were saved.
- **COLLAB-003:** Native review anchors use Yjs relative positions plus the quoted text. Approval
  resolves the passage against current content; failed/stale changes do not silently choose another site.
- **COLLAB-004:** Provider approval is required for replacements. Review changes invalidate the
  preview. Reusing a request ID with a different payload is a conflict where receipts are supported.

Status: Living reference
Owner: Clausid maintainer
Verified against: 027772e plus the engineering implementation; see tracker

## Native document ownership

The browser's Tiptap editor operates on a Y.Doc. `connectContract` sends encoded updates with
UUID request IDs, queues unsaved updates in the open tab, and manages transient awareness. The
actor owns accepted bytes/revision. LiveStore stores workflow projections in memory; neither the
projection nor the browser's displayed role grants access.

`Contract.webSocketMessage` enters `#serial`, rechecks current membership and session expiry,
parses `clientMessage`, and rejects editing imported PDFs through the native edit channel.
For a new edit it applies current state plus the candidate to a disposable document, verifies
completeness and a 524,288-byte encoded draft bound, and checks the ProseMirror schema.
The SQL transaction stores bytes, revision, edit ID and preview invalidation before the actor sends
`ack`. The in-memory document changes only after that commit. A retry with the same ID only acks.

## Message and connection states

| Message    | Meaning                                         | Consumer effect after validation                   |
| ---------- | ----------------------------------------------- | -------------------------------------------------- |
| `state`    | Authorized contract view; optional native draft | Establish view/draft and writable/presence state   |
| `edit`     | Accepted update ID, revision and encoded bytes  | Apply validated update; advance displayed revision |
| `ack`      | Persisted update ID and revision                | Clear that pending ID; do not invent an edit       |
| `presence` | Client ID, clock and nullable cursor state      | Update awareness only                              |
| `error`    | Operating failure message                       | Surface failure without claiming persistence       |

The server rejects incoming edit envelopes above 360,000 characters and encoded updates above
350,000 characters. Presence IDs/clocks are uint32 and cursor JSON is capped at 1,200 characters.
These are different bounds from a full draft snapshot. Presence is never included in a signature.

Ordinary disconnect retries from 400 ms up to a five-second delay; a refresh-session close retries
immediately after an HTTP access check. Access-ended close 4003 terminates access. Server frames pass the shared schema and binary staging before publishing. A malformed frame
closes with application code 4002, retains local text and pending IDs, stops automatic retry and
shows an explicit Retry connection action. Retrying revalidates access and replays the same IDs.

## Review transaction and anchor semantics

The [Canvas design workstream](canvas-design-plan.md) adds a selection toolbar and inline comment
composer. A comment snapshots its passage before focus moves, retains text and request identity on
failure, and publishes a thread only after the existing server mutation succeeds. Temporary passage
highlights are browser presentation, distinct from authored color marks. Native formatting uses
validated links and fixed text colors, with matching PDF output. Select All around one text block
is normalized to its inline range for approval; replacements spanning blocks remain rejected.

Document hover previews resolve the current native relative positions and quote without selecting
or editing text. Dotted passage decoration and gutter controls are presentation-only. Hover/focus
shows authorized author/time, content, replies and state; activating a marker opens the existing
review panel. Hover is suppressed while selecting or drawing. Stale anchors remain in history and
are not attached to different wording. Signer-only views do not expose the review overlay.

Native review anchors contain base64 Yjs relative positions and the quoted text, not DOM offsets.
`reviewPassage` resolves them against current text and rejects a stale quote (409), invalid location
or a replacement spanning paragraphs (422). Approval operates on a disposable document first.

`reviewRequest` names an account-scoped request receipt. The actor hashes the payload; reusing the
same ID with different content is 409. Adding a thread, replying, deciding or changing outline
metadata invalidates the preview and increments revision. A receipt and changed state/bytes are
committed together. A failed approval does not close the suggestion or replace persisted draft bytes.

Suggestions require owner approval/rejection; ordinary comments can be resolved by their permitted
author. Reopening is distinct from approval. Limits are 120 native threads, 240 total native replies
and 500 outline corrections. These collections are independent of the PDF annotation limits.

## Recovery and evidence

Unsent edits live only in the tab. A freeze or revocation with pending data must show an unsaved
failure, not Saved. Valid reconnect resends the same IDs so the server receipt prevents duplication.
[Boundary tests](../tests/boundaries.test.ts) and [connection tests](../tests/connection.test.ts)
cover malformed JSON, unknown variants, binary decoding, pending preservation and explicit recovery.
The [browser suite](../tests/workflow.spec.ts) corrupts a real acknowledgement, observes the unsaved
message, retries the original edit and verifies persisted text after reload without page errors.

Owners: [connection](../apps/web/src/connection.ts), [review passage](../apps/worker/src/draft.ts),
[actor](../apps/worker/src/contract.ts), [public contracts](../packages/contracts/src/index.ts).
Evidence: [workflow](../tests/workflow.spec.ts), [persistence](../tests/persistence.spec.ts), and
boundary regression tests added by the engineering program. Shape checks do not prove authorization.

## Workspace participants and named cursors

The [workspace presence plan](workspace-presence-plan.md) and [verification record](workspace-presence-tracker.md)
track live participant visibility. The workspace Directory owns a separate authenticated socket with
schema-validated activity/snapshots. Its roster includes all accepted members and aggregates open
tabs into Online, Editing, Away or Offline. Names come from verified account identity; account-based
colors remain stable across tabs. Legacy membership names fall back to email until refreshed.

Activity is transient, with 25-second heartbeats, 90-second leases and bounded session refresh.
Editing lasts two seconds after local native changes; hidden/60-second-idle tabs are Away.
Document IDs/titles are included only after current per-recipient Contract authorization; otherwise
activity is described without exposing the document. Workspace membership does not grant contract access.
Presence failure/retry is independent of draft saving and cannot acknowledge edits.

Tiptap reuses the contract awareness channel for named native carets and colored selections.
Presence is available to authorized read-only viewers; native edits still require a writable draft
and an owner/editor role. PDFs expose participant activity without native-text cursors or mouse pointers.
