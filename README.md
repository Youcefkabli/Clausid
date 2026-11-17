# Clausid

Clausid is a self-hosted web application for drafting contracts together and collecting electronic signatures on a frozen PDF.

## What you can do

- Invite collaborators by verified email and edit a contract together with live cursors.
- Select signers, review the exact PDF, then freeze and send it for signing.
- Collect typed signatures with recorded consent and download an evidence bundle containing the frozen PDF, its SHA-256 digest, and signing records.

## Workspace workflow

Sign in to open **Workspaces**. Create a workspace and use **Share workspace** to invite parties by verified email. The workspace creator is the service provider. Only the service provider can use **Add document** to start a private draft and choose **Export → Share → Share with workspace** to give current parties live editing access. Parties negotiate by editing the same draft. The service provider reviews and approves the frozen version for signing.

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

Attach a selectable-text PDF up to 1 MB in the **Document** step when creating a workspace. It becomes the first contract and opens in Canvas for the owner and invited parties. In an existing workspace, choose **Add document** to upload a PDF. Use **Export → Share** to grant a workspace party access, then use **Annotations** to propose text replacements and approve or reject them. After resolving the annotations, prepare the negotiated PDF for signing from Canvas.

The browser suite uses real workerd, Better Auth, SQLite, and Mailpit. Supply `CLAUSID_TEST_BROWSER` with a Chrome executable path to use an existing installation.

## How it works

- **Web** uses React, Vite+, and Astryx’s Neutral theme and templates. Tiptap and Yjs handle editing and awareness. LiveStore materializes authorized workflow data in memory, and the dashboard refreshes from the server every five seconds.
- **Worker** runs under standalone workerd. Each contract has a SQLite-backed Durable Object that serializes writes to its draft, membership, signing state, and artifacts. Accepted edits are persisted before acknowledgement. The per-account directory stores contract IDs, and reads consult each contract for current access. The editor queues brief offline edits in its open tab.
- **Auth** is a private Node service running Better Auth with `better-sqlite3` and SMTP. Verification and session checks use Better Auth. Contract invitations are single-use, expire after seven days, and are tied to the invited verified address. The workerd service retries invitation mail from its durable outbox. Delivery retries can send the same link more than once.
- **Signing evidence** is a ZIP containing the immutable PDF and a JSON manifest with the digest, signer identities, timestamps, and recorded consent. The current PDF renderer embeds Noto Sans Latin fonts and blocks preview generation if the document contains characters it cannot reproduce.

## Self-host

Set `PUBLIC_HOST` to a hostname pointed at the server and `PUBLIC_ORIGIN` to its exact HTTPS origin with no trailing slash. Set `BETTER_AUTH_SECRET` and `INTERNAL_AUTH_KEY` to different, persistent random values of at least 32 bytes. Set `MAIL_FROM`, SMTP host, port, authentication, and TLS options for your mail service. Provide these values securely to Compose.

```sh
docker compose up -d --build
docker compose logs --follow web worker auth
```

Caddy serves the SPA and proxies the API and WebSocket on the same origin. The public ports are 80 and 443. The workerd and auth services are private to Compose. The auth service applies migrations before it starts listening. For local Compose TLS previews, use `PUBLIC_HOST=localhost` and `PUBLIC_ORIGIN=https://localhost` with a trusted Caddy local CA.

Monitor `/healthz`, and exercise authenticated contract listing from a staging account to verify SQLite and auth. Monitor service logs for `Contract invitation delivery failed`, `Authentication or mail operation failed`, and `Clausid request failed`. Run the signing workflow in staging after changes to the runtime, mail delivery, auth, or PDF rendering.

### Backup and restore

1. Stop the stack during a maintenance window. Archive the full `auth` and `contracts` named volumes together, including any SQLite companion files. Save the deployed revision, configuration, and secrets through your normal secure backup process.
2. Restore both archives into the corresponding volumes with their original ownership. Restore the runtime version and keep the namespace `uniqueKey` values in `deploy/workerd.capnp` stable. Start the restored stack on an isolated host.
3. Sign in as an existing account, confirm the dashboard and drafts, and download sample completed evidence. Compare the SHA-256 digest of each restored PDF with the recorded digest. Resume traffic after these checks pass.

The self-host target uses workerd's local-disk Durable Object storage. Keep a single workerd process per storage volume and qualify runtime upgrades against a copy of the data.

## License

Clausid is licensed under the [GNU Affero General Public License, version 3](LICENSE). The adapted Astryx templates retain their [upstream MIT notice](THIRD_PARTY_NOTICES.md).
