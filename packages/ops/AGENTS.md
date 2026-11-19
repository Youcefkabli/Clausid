# Offline operations instructions

Read [persistence and recovery](../../docs/contracts/persistence-and-recovery.md) and
[backup and restore](../../docs/runbooks/backup-and-restore.md).

- Commands verify supplied artifacts; matching hashes establish consistency with the supplied
  manifest, not independent authenticity or a successful restore.
- Keep archive parsing bounded and reject duplicate/ambiguous entries and invalid manifests.
  Avoid exposing password hashes, sessions, invitations or contract contents in diagnostics.
- Use the pinned Rust toolchain. Run root `pnpm verify:ops`; add regression fixtures for changed
  archive/evidence behavior. Real paired-volume recovery is a separate qualification step.
