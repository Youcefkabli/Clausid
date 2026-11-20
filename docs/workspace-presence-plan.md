# Workspace participants and live editing

Status: Implemented and verified locally
Owner: Clausid maintainer; current coding-agent implementation
Issue: Not created; authorized in chat
Verified against: base 600514c9efee449096796ec73ce007aea72b721d; local uncommitted feature

## Accepted outcome

Every accepted workspace member can open the full roster, see who is online, editing, away or
offline, and recognize native-document carets and selections by name and stable account color.
Workspace/document headers expose active participants. Contract-only collaborators appear separately.
Mouse pointers, PDF text cursors, historical attribution and color customization are excluded.

## Ownership and interfaces

The existing workspace Directory owns `/api/workspaces/:id/socket`. Its hibernating socket
attachments hold transient activity. The public router authenticates/validates origins; the
workspace object checks membership. Every publication checks session leases and current access.
Document labels/links are filtered through Contract views for each recipient; private IDs/titles
never enter an unauthorized recipient's snapshot. Sender activity must belong to this workspace.

Shared schemas own activity, participant snapshots, canonical user identity and Yjs cursor shapes.
Contract state optionally supplies `self`; existing state consumers can ignore the additive field.
Current/legacy carets can omit account ID. Malformed cursors are rejected before awareness sees them.
Optional membership names are refreshed from verified accounts on connection. Existing records need
no migration; unknown extensions and legitimate omitted/null fields retain their existing semantics.

Activity never enters draft revisions, review history, PDFs or signing evidence. Account colors use
a deterministic mapping independent of tab/session IDs; names distinguish similar colors. Existing
Yjs updates, durable acknowledgement, replay IDs and explicit document retry remain authoritative.

## Lifecycle

Aggregate tabs by account: Editing takes priority over Online, then Away, then Offline. Editing
lasts two seconds after local native updates. Hidden or idle-for-60-second tabs report Away.
Heartbeat is 25 seconds, lease expiry 90 seconds; session reauthentication is bounded to 120 seconds.
Closing one tab removes only its session. Workspace presence protocol failure exposes its own retry
without interrupting document saving. Directory alarms preserve invitation delivery and presence cleanup.

## Acceptance and delivery

See [task evidence and handoff](workspace-presence-tracker.md). Require source/schema regressions,
real multi-account browser coverage, private-document redaction, rendered desktop/mobile/theme
evidence, `pnpm format`, `pnpm check:local`, `pnpm check:changed` and `pnpm verify`.
No new dependencies, policy edits, commit/push, deployment or hosted qualification are included.
