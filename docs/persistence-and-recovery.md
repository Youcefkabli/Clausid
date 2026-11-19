# Persistence and recovery

- **RECOVERY-001:** Auth and application stores form a coordinated recovery point. Preserve
  SQLite companions, runtime/configuration, persistent secrets and Durable Object namespace keys.
- **RECOVERY-002:** VPS storage has one workerd process per volume. Rehearse upgrades/rollback on
  copies; never use production data as an agent's development directory.
- **RECOVERY-003:** Cloudflare checkpoint/recovery runs under maintenance with D1 and object
  inventories coordinated. An inventory mismatch stops automated object recovery.
- **RECOVERY-004:** Restoration verification checks account access, workspace permissions, drafts
  and representative signed PDF hashes before reopening traffic.
- **RECOVERY-005:** The offline CLI establishes consistency with supplied manifests. Independent
  trusted digests and an actual restore are separate evidence.

Status: Living reference
Owner: Clausid maintainer
Verified against: 027772e plus the engineering implementation; see tracker

## Stores and transaction owners

VPS auth uses Better Auth SQLite with WAL; application state uses SQLite-backed Durable Objects on
a separate writable disk. Cloudflare auth uses D1 and application state uses managed SQLite objects.
The namespace/object identity and runtime configuration are part of the recovery point.

`Directory` owns account indexes/reservations and workspace metadata tables; workspace sharing
instances use their own `workspace-sharing` key/value state. `Contract` owns `state`, `files`, `edits`
and `review_requests`. Artifact rows include original, negotiated, draft, preview and frozen bytes.
`Contract.#save` commits metadata and its supplied file/receipt writes together using transactionSync.
Cross-object workspace initialization uses retry/ready markers, not a distributed transaction.

`#state` and the Y.Doc in an actor are cached views of committed records. Updates must not be
acknowledged before durable writes. An in-memory LiveStore view is disposable after reload and is
not part of a database backup. Queued browser edits are not a server checkpoint.

## Backup and restore protocol

1. Stop writers or enable the target's maintenance procedure.
2. Capture auth and application data as one coordinated point, including SQLite WAL/companions,
   namespace keys, runtime/configuration, persistent secrets and known artifact identifiers.
3. Preserve the deployed revision and proxy/origin setup without publishing secrets in evidence.
4. Restore to an isolated target. Do not reopen traffic before inventory/access/artifact checks.
5. Sign in as existing accounts, inspect workspaces/drafts and compare representative signed PDF
   digests with separately retained trusted digests. Verify a new operational workflow as required.
6. Record target-specific acceptance and rollback facts, then explicitly reopen traffic.

A single workerd process owns a VPS storage volume. Starting two writers against it is not a
replication strategy. A backup manifest records consistency with supplied archives; independently
trusted hashes and a successful restore are different evidence.

## Maintenance and object compatibility

The [operations adapter](../apps/worker/src/operations.ts) requires a sufficiently long bearer key
and validates object kind/addressing/operation. Recovery checks table names/columns and row shapes;
restore refuses a destination containing data and restores alarms for pending work. Logical names
and physical IDs are different addressing modes. Preserve inventory correspondence across transfer.

The directory restore path understands missing historical tables and supplies empty compatible
collections where implemented. This does not permit arbitrary column changes. Private record parser
migration must accept legitimate previous optional/null forms without rewriting stored bytes. A
corrupt record is an explicit failure, not an excuse to reset an account or erase a contract.

The workerd namespace keys `clausid-contract-db-v1` and `clausid-directory-db-v1` must stay stable
for compatible VPS upgrades. D1 changes need migrations for existing installations, not just edits
to the initial schema. Cloudflare bundle/schema parity is a dry-run check, not a hosted restore.

## Qualification and failure handling

An inventory mismatch stops automated recovery. Keep the previous release, volumes, secrets and
proxy configuration to rehearse rollback on copies. Never use production data as an agent's
`CLAUSID_DATA_DIR`. Stop only verified owned services after a failed/interrupted local test.

Owners: [operations](../apps/worker/src/operations.ts), [transfer tooling](../scripts/transfer.mjs),
[offline CLI](../packages/ops/src/main.rs). Procedures:
[backup/restore](runbooks/backup-and-restore.md), [migration](runbooks/migration.md),
[release qualification](runbooks/release-qualification.md).
Evidence: [paired SQLite browser restore](../tests/persistence.spec.ts), Rust CLI tests and named
operator qualification records. Local restoration does not establish all Compose or hosted D1
recovery paths, and an artifact hash alone does not prove a recovered user's current authority.
