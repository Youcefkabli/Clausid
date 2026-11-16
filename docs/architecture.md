# Clausid architecture

| Area | Boundary |
| --- | --- |
| [Web](../apps/web) | React and Astryx UI. Tiptap and Yjs provide collaborative editing and presence. LiveStore materializes authorized workflow data in memory. |
| [Worker](../apps/worker) | Authorizes workspace and contract operations. SQLite-backed Durable Objects persist edits, membership, signing state, and artifacts. The account directory indexes contracts and reads consult current access. |
| [Auth](../apps/auth) | Private Better Auth service with SQLite and SMTP. Owns verified email identities and sessions. |
| [Shared contracts](../packages/contracts) | Shared request, response, and message schemas. |
| [PDF processor](../packages/pdf-engine) | Standalone Rust/Wasm processor under an optional workerd profile. The signing workflow uses the Worker's renderer. |
| [Self-hosting](../deploy) | Caddy serves the SPA and proxies the API and WebSocket. Workerd and auth run on the private Compose network. See the [backup and restore procedure](../README.md#backup-and-restore). |

## Workspace to signing

1. The workspace creator is the service provider. The provider creates a private draft and shares it with workspace parties. The Worker enforces contract membership and persists accepted edits before acknowledging them.
2. The contract owner selects signers and generates a PDF preview of the current draft revision. Freeze requires a current, unexpired preview. The Worker stores the exact preview bytes as the frozen PDF and transitions to Awaiting signatures. A changed draft requires a new preview.
3. Signatures bind the eligible verified account, consent version, frozen version ID, and digest. Signing requires a recent session. The contract becomes Signed when all required signers have signed.
4. The evidence ZIP contains the frozen `contract.pdf` and `signing-evidence.json`. The recorded SHA-256 covers the exact bytes of `contract.pdf`. The manifest records consent and signatures separately.
