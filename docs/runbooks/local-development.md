# Local development and resource ownership

Use [README startup/toolchain](../../README.md#develop-locally), then inspect the
[verification plan](../enforcement.md). Provision dependencies and tools explicitly; gates do not
install them. Start Mailpit with the documented Compose profile or an existing local instance.

| Resource                  | Current control                        | Concurrency limit                                              |
| ------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| SQLite/draft data         | `CLAUSID_DATA_DIR`                     | Unique per worktree; never point at production or another task |
| Vite                      | `CLAUSID_VITE_PORT`                    | Reserve with workerd/auth ports; strict binding                |
| Main workerd              | `CLAUSID_HTTP_PORT`                    | Unique port and storage                                        |
| Private auth              | `AUTH_PORT`                            | Match dev launcher's workerd external address                  |
| Public origin             | `PUBLIC_ORIGIN`                        | Must match chosen browser origin                               |
| Test SMTP                 | `SMTP_HOST`, `SMTP_PORT`               | Allocate explicitly; helper still reads fixed Mailpit HTTP     |
| Mailpit test HTTP         | Helper currently uses `127.0.0.1:8025` | Do not clear another run's mailbox; serialize suites           |
| Persistence test services | Currently `17887` / `17888`            | Fixed in suite; serialize browser gates across worktrees       |
| PDF processor smoke       | Ephemeral loopback port                | Runner starts and cleans up its own stateless workerd          |

Record worktree, data directory, port allocation and service owner in the handoff. Playwright
uses one worker because auth is rate-limited by IP and refuses to reuse a pre-existing dev server.
Browser concurrency isolation remains follow-up work; changing only `CLAUSID_DATA_DIR` is insufficient.
After interrupting a browser gate, inspect its owned service processes and ports before retrying.
Nested dev services may survive an outer runner's termination; stop only processes whose ownership
you have verified, then confirm the ports are free.

Example after reserving unused ports (this runs a gate, not a deployment):

```sh
CLAUSID_DATA_DIR=.data/foundation-check CLAUSID_VITE_PORT=15173 CLAUSID_HTTP_PORT=18787 AUTH_PORT=18788 pnpm verify
```

Use `CLAUSID_TEST_BROWSER` for an existing Chromium executable. Check prerequisites first; a
missing browser, Mailpit, wasm-bindgen or Rust target is a failed/pending check, not a skip.
