# Deploy Clausid on Cloudflare

The native deployment uses one Worker, Static Assets, two SQLite Durable Object namespaces, D1 for Better Auth, and Cloudflare Email Service. It requires Workers Paid and a sending domain onboarded to Cloudflare Email Service. Configure GitHub integration and billing in your own account.

## Clean install with Wrangler

1. Install the repository’s pinned Node and pnpm versions and run `pnpm install --frozen-lockfile`. Install Rust 1.93.1 with the `wasm32-unknown-unknown` target and `wasm-bindgen-cli` 0.2.130 for the PDF engine build. Authenticate Wrangler in the intended Cloudflare account.
2. Provision a D1 database with `pnpm exec wrangler d1 create clausid-auth`. Update its ID under the `AUTH_DB` binding in `wrangler.jsonc`. Pick the Worker name and public URL. Set `PUBLIC_ORIGIN` to the exact HTTPS origin, and `MAIL_FROM` to the mailbox on your onboarded sending domain. If you use a custom domain, configure it on the Worker.
3. Run `pnpm --filter @clausid/web build` and `pnpm run deploy`. The deploy command applies the D1 migrations and deploys with an email binding restricted to `MAIL_FROM`. Keep future D1 migrations compatible with the Worker already serving traffic.
4. Set `BETTER_AUTH_SECRET` with `pnpm exec wrangler secret put BETTER_AUTH_SECRET`. Use a persistent random secret of at least 32 bytes. Auth and the application respond with a configuration error until the required settings are present.
5. Register and verify an account, exercise password reset, and send an invitation to an external email address. Test collaborative editing and complete a signing workflow before opening the deployment to users.

## Public deploy template

Generate the template from a release tag with `sh scripts/cloudflare-template.sh <tag> <new-directory>`. Publish only that directory to the public template repository. The release maintainer should point the Cloudflare deploy button at that repository after qualification. The dashboard must provision the D1 database and namespaces, run the pinned build and deploy commands, and expose configuration inputs for the public origin, sender, and auth secret. Verify the actual dashboard flow before advertising the button. Use the Wrangler instructions above for manual deployment. After successful qualification, replace the example URL below with the published template URL and add the button to the project README.

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/OWNER/clausid-cloudflare)
```

For upgrades of an existing VPS installation, use the [migration runbook](vps-to-cloudflare.md).

## Recovery checkpoints

These are coordinated recovery points within Cloudflare’s retention window. Record an independent trusted hash for completed PDFs that matter to your recovery and verification process.

1. Stop user ingress at the public origin. Set the temporary `OPS_KEY` Worker secret to a random value of at least 32 bytes. Wait for the maintenance deployment to be active and prior requests, WebSockets, and mail work to drain. Maintenance requests close any remaining object sockets. Leave the app and mail paused while creating or restoring a checkpoint.
2. Record the D1 bookmark, the current application release, the account ID, and both namespace IDs. In a local JSON file use the keys `d1Bookmark`, `release`, `accountId`, `directory`, and `contract`. Use the narrowest Cloudflare token supported by the object-list endpoint. Set it as `CLAUSID_CLOUDFLARE_READ_TOKEN` locally, and set `CLAUSID_OPS_ORIGIN` and `CLAUSID_OPS_KEY` to the Worker origin and temporary secret.
3. Run `node scripts/transfer.mjs checkpoint <config.json> <checkpoint.json>`. Store the checkpoint with the deployment configuration and known frozen PDF digests. Remove the temporary Worker secret before reopening traffic.
4. To recover, re-enter maintenance and run `node scripts/transfer.mjs check-inventory <checkpoint.json>` before restoring either store. Restore D1 with `wrangler d1 time-travel restore AUTH_DB --bookmark=<bookmark>`. Run `node scripts/transfer.mjs recover <checkpoint.json>` to restore and verify the recorded object snapshots. An inventory mismatch stops automated object recovery. Reconcile differences before restoring either store, including objects created after the checkpoint.
5. Verify account access, workspace permissions, draft revisions, and representative signed PDF hashes before reopening. Stay in maintenance if any store fails to restore. Remove the temporary secret and confirm pending mail resumes.

In a recovery rehearsal, run `node scripts/transfer.mjs verify-checkpoint <checkpoint.json>` before making changes after the checkpoint. Cloudflare point-in-time restore requires a hosted test account.


## Audit workspace ownership before upgrading

Keep user ingress blocked and enable the maintenance secret as in the checkpoint procedure. Run `node scripts/transfer.mjs audit-cloud-workspaces <config.json>` using the account and namespace IDs and inventory token. The audit fails on duplicate workspace owners or a mismatch between a sharing object and the account directory. Resolve any conflict before reopening traffic.
