# Shared contracts instructions

Read [domain contracts](../../docs/contracts.md) and identify every producer/consumer before
changing a request, response or collaboration message.

- Use Zod schemas for runtime parsing and derive types where appropriate. Test valid current
  payloads, malformed values, limits and compatibility; do not replace validation with casts.
- Keep domain invariants and IDs in the corresponding document. Schema validation alone does not
  prove authorization, transactionality or digest equality.
- Agree on shared shapes before parallel consumer implementation. Preserve optional/null and
  wire compatibility deliberately; record any migration.
- Every response and server message has a runtime schema; keep malformed success distinct from HTTP failure. Run root `pnpm verify` and producer/consumer boundary regressions.
