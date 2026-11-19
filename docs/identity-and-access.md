# Identity and access

- **ACCESS-001:** Better Auth owns credentials and sessions. Contract operations use a verified
  account; a client-provided role or directory listing is not authorization.
- **ACCESS-002:** Workspace ownership and contract membership are distinct. The workspace creator
  is the service provider; provider-only sharing and preparation must be enforced server-side.
- **ACCESS-003:** Current contract membership governs reads and writes. Revocation/expiry must
  affect open connections as well as future HTTP requests.
- **ACCESS-004:** Signer eligibility binds account and verified email. A recent session is required
  to sign; being an editor does not by itself confer signing authority.

Status: Living reference
Owner: Clausid maintainer
Verified against: 027772e plus the engineering implementation; see tracker

## Identity is not membership

[createAuth](../apps/auth/src/policy.ts) configures verified-email password accounts, a minimum
12-character password, reset-driven session revocation, seven-day sessions and a ten-minute fresh
age. The public origin is trusted explicitly. Secure cookies depend on HTTPS. Cookie caching is
disabled so current session policy is consulted. Rate limiting uses the database (60 per 60 seconds).

The [Node server](../apps/auth/src/server.ts) exposes Better Auth routes and private session/mail
operations. Private operations require a timing-safe internal key check; ordinary callers receive
404 for a wrong key. The [Cloudflare adapter](../apps/worker/src/cloudflare.ts) constructs the same
policy with D1 and native email. It is an in-process service binding, not a second public auth API.

The public Worker removes caller-supplied private headers before auth forwarding and supplies the
configured origin/proxy information. For an API request it obtains a verified session, then passes
an account (account ID, verified email, name, creation and expiry) to private actor operations.
Never accept an account object supplied by the browser. Better Auth account IDs are not workspace UUIDs.

## Authority matrix

| Operation                          | Required authority                                           | Authoritative check               |
| ---------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| Workspace customization/invitation | Workspace owner/provider                                     | Workspace sharing handler         |
| Contract view/socket               | Current contract membership                                  | `Contract.#role`                  |
| Share/prepare a workspace contract | Provider authority plus contract ownership                   | Public route and actor            |
| Add native review/PDF proposal     | Current eligible collaborator and draft                      | Actor review/annotation path      |
| Decide a replacement               | Contract owner                                               | Actor decision path               |
| Sign                               | Designated verified account/email and current frozen version | Actor sign path                   |
| Delete                             | Permitted draft/empty workspace, no recorded signature       | Actor/directory deletion protocol |

Directory membership is a lookup aid. Actors recheck access on reads and edits; revocation closes
open sockets through `#publish`. Session expiry produces a refresh-session close; missing membership
ends access. Signers receive a filtered view, not editor-only review details or source routes.

## Invitation lifecycle and failure behavior

Tokens are 32 random bytes represented as 64 lowercase hex characters. Stored invitation proofs
are SHA-256 digests. Redemption binds token, verified email and expiry (seven days). A different
account's email cannot redeem a forwarded link. Workspace redemption remembers the redeemed digest
so retrying the same accepted invitation is safe. Contract membership receipts/index registration
must finish before the public operation reports success.

Workspace setup persists an invitation outbox and schedules an alarm; mail delivery can be retried.
A delivery failure does not revoke a valid stored invitation. The same link can arrive more than once.
Manual workspace invitation reports mail failure as 503 after persisting its invitation, so retry
semantics and message text must not pretend that no server-side work occurred.

Signing checks a fresh sign-in in the actor, independently of a button's enabled state. Existing
compatible account/session formats must survive parser changes. Do not log cookies, reset links,
raw invitation tokens or contract contents in evidence. Hosted mail/proxy/D1 acceptance is separate
from [local account tests](../tests/account.spec.ts) and [workflow tests](../tests/workflow.spec.ts).

## Background identity compatibility

`workspaceSharing` uses the full internal authenticated account for normal operations. The private
`/sharing/forget-contract` cleanup path instead parses the stored owner party forwarded by the
contract deletion alarm. It requires the existing owner identity and does not fabricate session
creation/expiry. `tests/records.test.ts` proves a party-only header cannot pass the full account parser.

The private auth invitation relay parses its JSON body before dispatching mail. Its existing string
fields and workspace/editor/signer URL behavior are preserved; malformed shapes cannot call the
mailer. This shape check complements the internal key check and does not grant invitation authority.
