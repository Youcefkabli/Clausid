# Clausid

Clausid is a self-hosted web application for drafting contracts together and collecting electronic signatures on a frozen PDF.

## What you can do

- Invite collaborators by verified email and edit a contract together with live cursors.
- Select signers, review the exact PDF, then freeze and send it for signing.
- Collect typed signatures with recorded consent and download an evidence bundle containing the frozen PDF, its SHA-256 digest, and signing records.

## Workspace workflow

Create a workspace with at least one invitee. Upload an editable PDF to open it as the first contract in Canvas, or continue to an empty Canvas. Select wording in the PDF or open **Suggestions** in the right rail and choose a source line. Enter the replacement and submit it. Use **Comments** for page discussions and drawings. The service provider approves or rejects each proposal. Canvas displays the negotiated PDF, and signing freezes the reviewed bytes while preserving the original and negotiation history. The rewrite engine supports replacements that fit inside a supported source line.

Use **Sections** to navigate or correct the document outline and **Index** to find terms and references. In native drafts, select a passage to comment or suggest a replacement. The provider decides suggestions before preparing for signing.

Use **Add document** to start an additional draft. Choose **Export → Share → Share with workspace** to give workspace parties editing access to that draft.

## Develop locally

Use the Node version in `.node-version`, pnpm 10.33.0, and Mailpit. Run `corepack enable` if pnpm is unavailable. The first Worker build also needs Rust 1.93.1, the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli` 0.2.130 on PATH to compile the PDF engine.

```sh
pnpm install --frozen-lockfile
docker compose --profile dev up -d mailpit
pnpm dev
```

Open [Clausid](http://127.0.0.1:5173) and [Mailpit](http://127.0.0.1:8025). You can also run Mailpit directly on SMTP port 1025 and HTTP port 8025. The dev launcher builds the Worker and applies auth migrations, then starts Vite+, standalone workerd, and the private Node auth service. Dev storage defaults to `.data`. Copy `.env.example` to `.env` and set a stable auth secret if you want existing browser sessions and verification links to survive dev restarts.

Create two accounts in separate browser profiles, verify both in Mailpit, and sign in. Create a draft, share it with the other account, and open its invitation in that account's browser. Enter the signer addresses under **Prepare for signing**, review the PDF, and send it. Signers need a sign-in from the last ten minutes. If prompted, sign out and back in on the contract page.

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser suite uses real workerd, Better Auth, SQLite, and Mailpit. Supply `CLAUSID_TEST_BROWSER` with a Chrome executable path to use an existing installation.

## Development process

Start with the [documentation index](docs/index.md), [agent instructions](AGENTS.md), and
[development workflow](docs/development.md). The [contract surface](docs/contracts.md), feature references, [engineering plan](docs/clausid-engineering-plan.md),
[tracker](docs/clausid-engineering-tracker.md) and [detailed prompt pack](docs/prompt.md) live alongside the implementation. The [enforcement map](docs/enforcement.md)
distinguishes automated checks from review and hosted qualification.

```sh
pnpm check:local                # docs, policy, format, strict types/lint and unit tests
pnpm format                     # format maintained application/tool/docs files
pnpm check:changed              # affected checks; reports full profiles still required
pnpm verify --plan              # inspect the shared application/CI plan without running it
pnpm verify                    # application + website + real-service browser verification
pnpm verify:pdf                # Rust/Wasm + workerd PDF round trip
pnpm verify:ops                # offline operations CLI
pnpm verify:all                # all integration profiles
```

Provision the existing toolchain, Mailpit and browser first. See [local resource ownership](docs/runbooks/local-development.md)
for isolated data/ports and the remaining browser-concurrency limits. Git hooks install with
`pnpm install` or `pnpm hooks:install`; inspect `pnpm hooks:status`. Codex/Claude completion
configuration and the required Codex trust review are explained in [agent hooks](docs/agent-hooks.md).
Verification never publishes or deploys remotely.

## Website

The standalone Astro and Lumos homepage lives in `apps/website`. From the repository root, run `pnpm install --frozen-lockfile` and `pnpm --filter @clausid/website dev`. Open the URL printed by Astro. The website runs independently of the contract app and Mailpit.

In Stacki, choose **Open from folder** (called **Open Existing Project** in some versions) and select `apps/website`. Double-click the hero headline on the canvas to edit it. Stacki saves changes to `src/pages/index.astro` inside the website folder.

Use `pnpm --filter @clausid/website build` followed by `pnpm --filter @clausid/website preview` to preview the static production build.

## How it works

- **Web** uses React, Vite+, and Astryx’s Neutral theme and templates. Tiptap and Yjs handle editing and awareness. LiveStore materializes authorized workflow data in memory, and the dashboard refreshes from the server every five seconds.
- **Worker** runs under standalone workerd. Each contract has a SQLite-backed Durable Object that serializes writes to its draft, membership, signing state, and artifacts. Accepted edits are persisted before acknowledgement. The per-account directory stores contract IDs, and reads consult each contract for current access. The editor queues brief offline edits in its open tab.
- **Auth** is a private Node service running Better Auth with `better-sqlite3` and SMTP. Verification and session checks use Better Auth. Contract invitations are single-use, expire after seven days, and are tied to the invited verified address. The workerd service retries invitation mail from its durable outbox. Delivery retries can send the same link more than once.
- **Signing evidence** is a ZIP containing the immutable PDF and a JSON manifest with the digest, signer identities, timestamps, and recorded consent. The current PDF renderer embeds Noto Sans Latin fonts and blocks preview generation if the document contains characters it cannot reproduce.

## Deploy

- [Deploy on a VPS](#deploy-on-a-vps) with Docker Compose and an existing HTTPS proxy.
- [Deploy to Cloudflare](docs/cloudflare.md) using the native Workers deployment guide. The public template button is a release deliverable. Local Wrangler validation and hosted qualification are tracked separately.

### Deploy on a VPS

Set `PUBLIC_ORIGIN` in `.env` to your exact HTTPS origin with no trailing slash. Set `BETTER_AUTH_SECRET` and `INTERNAL_AUTH_KEY` to different, persistent random values of at least 32 bytes. Set `MAIL_FROM`, SMTP host, port, authentication, and TLS options for your mail service. Provide these values securely to Compose.

```sh
docker compose up -d --build
docker compose logs --follow worker auth
```

Clausid runs two Compose services. The Worker serves the SPA, API, and WebSocket on the loopback port `8787` (`CLAUSID_HTTP_PORT` overrides the host port). Better Auth remains on the Compose network and applies migrations before it starts listening. Your existing proxy terminates HTTPS and proxies all requests, including WebSocket upgrades, to the Worker.

See the [host Caddy example](deploy/Caddyfile). Any proxy must overwrite `X-Clausid-Client-IP` using the trusted client address and forward WebSocket upgrades. For Cloudflare Tunnel, run `cloudflared` on the host and point it to the dedicated loopback proxy listener in the example. Keep that listener private so external callers cannot supply their own Cloudflare client IP. The browser still uses the public HTTPS origin.

For an existing Compose installation, stop the old services, archive both SQLite volumes, and configure the host proxy before starting the new release. Run `docker compose up -d --build --remove-orphans` in the same Compose project. Retain the old release, proxy configuration, public origin, secrets, and named volumes. Run the [workspace ownership audit](docs/vps-to-cloudflare.md#audit-workspace-ownership-before-upgrading) on a copy before upgrading. Rehearse rollback on a copy. To roll back, stop the new stack and start the old release with its original configuration and project name.

Monitor `/healthz`, and exercise authenticated contract listing from a staging account to verify SQLite and auth. Monitor service logs for `Contract invitation delivery failed`, `Authentication or mail operation failed`, and `Clausid request failed`. Run the signing workflow in staging after changes to the runtime, mail delivery, auth, or PDF rendering.

### Backup and restore

1. Stop the stack during a maintenance window. Archive the full `auth` and `contracts` named volumes together, including any SQLite companion files. Save the deployed revision, configuration, and secrets through your normal secure backup process.
2. Restore both archives into the corresponding volumes with their original ownership. Restore the runtime version and keep the namespace `uniqueKey` values in `deploy/workerd.capnp` stable. Start the restored stack on an isolated host.
3. Sign in as an existing account, confirm the dashboard and drafts, and download sample completed evidence. Compare the SHA-256 digest of each restored PDF with the recorded digest. Resume traffic after these checks pass.

The self-host target uses workerd's local-disk Durable Object storage. Keep a single workerd process per storage volume and qualify runtime upgrades against a copy of the data.

### Verify backups and signing evidence with Rust

Build with `(cd packages/ops && cargo build --locked --release)` to use the pinned Rust toolchain. Run the following with `packages/ops/target/release` on your PATH.

```sh
clausid-ops backup manifest auth.tar contracts.tar > backup.json
clausid-ops backup verify backup.json auth.tar contracts.tar
clausid-ops evidence verify evidence.zip
```

Keep the backup manifest or PDF digest in a separately trusted location when you need to detect replacement. Matching hashes show consistency with the supplied manifest. Exercise restore and recheck a known signed artifact before relying on a backup.

## License

Clausid is licensed under the [GNU Affero General Public License, version 3](LICENSE). The adapted Astryx templates retain their [upstream MIT notice](THIRD_PARTY_NOTICES.md).
