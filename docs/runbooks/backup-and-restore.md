# Backup and restore

Use [VPS paired-volume backup](../../README.md#backup-and-restore) or
[Cloudflare coordinated checkpoints](../cloudflare.md#recovery-checkpoints) for the actual target.
The [Rust CLI](../../README.md#verify-backups-and-signing-evidence-with-rust) checks supplied
archives/manifests; run `pnpm verify:ops` after changing that implementation.

For qualification, restore into an isolated target, verify accounts/workspace access/drafts,
download completed evidence and compare a known PDF digest against independently retained evidence.
Record the tested revision, target, archive identifiers, comparisons and result. The automated
[local SQLite test](../../tests/persistence.spec.ts) is not a Compose or Cloudflare restore rehearsal.
