# Authentication instructions

Read [identity and access](../../docs/identity-and-access.md) and
[persistence and recovery](../../docs/persistence-and-recovery.md).

- Better Auth owns credentials and sessions. Preserve verified-email identity, session expiry,
  reset behavior, trusted proxy headers and the private VPS service boundary.
- Never record real credentials, tokens, reset links or customer documents in workstream evidence.
- Review SQLite/D1 schema changes and backward compatibility explicitly. Do not update the initial
  D1 schema merely to silence parity checks when an existing deployment needs a migration.
- Run root `pnpm verify`, including real Mailpit/account flows and auth schema parity. VPS SQLite
  and hosted D1 deployment acceptance remain separate from local browser success.
