# Migrate a VPS installation to Cloudflare

Use a maintenance window and a fresh destination. This is a one-way migration. Keep the source volume backups and the original public origin and Better Auth secret. Migration archives contain password hashes, session tokens, and pending invitations. Keep them in restricted storage.

1. Block source ingress, drain in-flight requests, and stop the Compose services to close sockets and pause background mail. For an existing installation, archive the named volumes together using the [backup procedure](../README.md#backup-and-restore).
2. Extract the archives into a private working copy with `auth/auth.sqlite` and `contracts/` below the same directory. Include SQLite companion files. Build the version of the maintenance Worker qualified for this source layout with `pnpm --filter @clausid/worker build`. Start it on loopback using the copied data, with `PUBLIC_ORIGIN=http://127.0.0.1:17897` and a temporary random `INTERNAL_AUTH_KEY` in its environment.

   ```sh
   apps/worker/node_modules/workerd/bin/workerd serve deploy/migration-workerd.capnp \
     --external-addr auth=127.0.0.1:18999 \
     --directory-path contractDisk=/absolute/path/to/copied-data/contracts
   ```

3. In a separate shell, set `CLAUSID_OPS_KEY` to that temporary key. Run `node scripts/transfer.mjs export <copied-data-dir> <new-export-dir>` and `node scripts/transfer.mjs preflight <export-dir>`. Reconcile any reported source references before proceeding. The exporter fails on unclassified populated objects and unexpected stored records. Keep the source stopped and shut down the export Worker afterward.
4. Prepare [the Cloudflare installation](cloudflare.md) with new D1 and Durable Object storage and the original auth secret and public origin. Keep the public hostname blocked throughout import. Enable maintenance with a separate temporary `OPS_KEY` Worker secret. Import `auth.sql` into the empty, migrated D1 database with `pnpm exec wrangler d1 execute AUTH_DB --remote --file <export-dir>/auth.sql`. Check row counts for `user`, `account`, `session`, `verification`, and `rateLimit` against the manifest.
5. Point `CLAUSID_OPS_ORIGIN` at the isolated destination Worker’s HTTPS address and set `CLAUSID_OPS_KEY` to its maintenance secret. Run `node scripts/transfer.mjs import-objects <export-dir>`, then `node scripts/transfer.mjs verify <export-dir>`. Each imported object is read back and compared with its source snapshot. Retry a failed partial import against fresh destination resources.
6. With external ingress still blocked, remove the temporary maintenance key for operator-only testing. Rehearse sign-in with an existing session and fresh login, workspace access, pending invitation redemption, a draft reconnect, and signing evidence comparison at the original public origin. Older sessions may need re-login if cookies fail verification. Before accepting user writes, ensure the target matches the export and the source remains frozen. Switch traffic after the rehearsal and rebuild the fresh destination from the verified source export if the rehearsal wrote test data. Confirm that the destination delivers pending mail. After the destination accepts writes, recover there to preserve new changes.

## Audit workspace ownership before upgrading

For a VPS upgrade, use the same isolated maintenance Worker and copied data as steps 1 and 2. Set `CLAUSID_OPS_KEY` and run `node scripts/transfer.mjs audit-workspaces <copied-data-dir>`. The audit compares owned workspace IDs across account objects and verifies that every initialized sharing object agrees with the account directory. It reports ownership conflicts without reassigning workspace data. Resolve any reported conflict before reopening upgraded traffic.

Existing workspace IDs, URLs, and invitations are retained. The migration export runs the same ownership audit automatically.
