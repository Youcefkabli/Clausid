# Workspace presence — task evidence and handoff

Status: Implemented and verified locally
Owner: Clausid maintainer; current coding-agent implementation
Issue: Not created; authorized in chat
Verified against: base 600514c9efee449096796ec73ce007aea72b721d; local uncommitted changes

## Assignment

Implement the accepted [participant plan](workspace-presence-plan.md) as one bounded feature across
contracts, Worker and existing web templates. Starting branch was `codex/engineering-adoption` with
a clean tree. Git hooks report active. Personal Codex hook trust is separate and was not changed.

## Verification evidence

- `pnpm format` ran for maintained files; `pnpm check:local` passed documentation, source/dependency
  policy, formatting, strict types/type-aware lint and **77 unit tests in 15 files** on the final
  runtime implementation. New tests cover identities, multiple tabs, leases/status transitions,
  malformed cursors/frames, isolated retries/access loss, signer write denial, and continuous typing.
- Focused `pnpm exec playwright test tests/presence.spec.ts` passed against real workerd/auth,
  SQLite and Mailpit. It verifies private document ID/title redaction, rejected nonmember sockets
  and foreign origins, ignored identity spoofing, named text carets/selection colors, workspace
  activity, tab aggregation, profile-name refresh, duplicate/long names, 320px header height,
  mobile roster and disconnect cleanup, with no page errors.
- Viewed desktop/light, dark, mobile and caret/selection PNGs under ignored
  `.data/presence-evidence/focused/` and `test-results/`. Mobile capture now waits for the drawer
  to finish entering and disables screenshot animations; dark text/actions and full drawer fit
  were visually confirmed. The final full run refreshes the screenshots with retained role labels.
- Initial local checks caught Worker-global types leaking into the test compiler and unsafe
  third-party JSON return types. Extracted pure state logic and narrowed producer values; no
  compiler/linter exemptions or policy changes were introduced.
- First full gate stopped because `wasm-bindgen` was absent from PATH. Found and verified the
  existing `/private/tmp/clausid-pdf-tools/bin/wasm-bindgen` **0.2.130**, matching the repository.
  Rust is **1.93.1**, Node **24.11.1**, pnpm **10.33.0**. No new dependency was installed.
- The next full gate passed all build/deployment/static steps and six browser workflows, but
  caught a real 320px navigation-height regression. Replaced the participant header display with
  a compact button at small widths; kept the existing 36px layout assertion unchanged. Focused
  presence/browser and 77-unit gates then passed. Earlier focused failures were corrected test
  gestures/locators/name expectations; one run was interrupted after an agent-triggered HMR reload.
- Final `pnpm verify` **passed** on the local uncommitted feature: documentation/policy/format,
  strict types/type-aware lint, **77 unit tests in 15 files**, website diagnostics/builds, fresh
  Rust/Wasm build, every workspace build, Astryx built-output doctor (**12 pass, zero warnings,
  zero failures**), Cloudflare deployment dry-run/auth schema parity and **all seven serial browser
  workflows**. Browser time was 5.6 minutes, including the existing rate-limit retry intervals.
  The existing collaboration/freeze/signature, provider permission, paired persistence recovery,
  empty workspace and explicit unsaved-edit recovery cases all passed without weakening checks.
- Preserved and viewed final light/dark, cursor/selection and fully entered mobile screenshots
  in ignored `.data/presence-evidence/final/`. The final 320px navigation remains 36px tall; long
  names truncate and colors align with names. Provider/Editor/Signer labels remain visible.
- Final source manifest: 17 changed application/contract/test files against base `600514c`;
  SHA-256 **acc9f55b374112baa750428932bbc2732a79c909b67a1f003eb3dfd7cd97793c**.
  The manifest is `.data/presence-evidence/source-manifest.json`; documentation is excluded so
  evidence recording cannot change the verified runtime digest. Full gate log is
  `/private/tmp/clausid-presence-verify-final.log`.
- Delivery `pnpm check:changed` **passed**, including documentation, source/dependency policy,
  formatting, strict types/type-aware lint and all 77 unit tests. It required the application
  profile, which already passed separately. `git diff --check` also passed.

## Resource ownership

Feature checks use `.data/presence-check` and Vite/workerd/auth ports 15173/18787/18788. Browser
suites remain serial, including fixed persistence ports 17887/17888. Started task-owned Mailpit
on 127.0.0.1:1025/8025 using `/private/tmp/clausid-mailpit/mailpit`; no mailbox clearing performed.

## Next action

Review the local feature diff and the recorded evidence. No commit/push, remote CI, staging or
production deployment occurred. Hosted qualification and personal Codex hook activation remain
separate. Test services have been shut down; restart Mailpit before another browser/full gate.

## Service cleanup

The final Playwright runner shut down its Vite/workerd/auth and fixed-port persistence processes.
Stopped task-owned Mailpit PID 63736 after the full gate. Verified ports
15173/18787/18788/17887/17888/8025/1025 have no listeners. Isolated data/evidence remain under `.data/`.

## UI shell correction — 2026-11-19

Status: Implemented and verified locally

- User requested matching header/sidebar backgrounds and separator lines, and participant
  indicators beside the account avatar without editor-toolbar overlap.
- Canvas now uses the existing Astryx section shell variant. Header and all four sidebar
  regions share the surface token and the existing one-pixel border token. Other app pages
  retain their previous shell variant.
- Added a dedicated Canvas header participant slot, rendered immediately before the account
  avatar and after Export. Header tracks reserve the side controls' content width and bound
  the toolbar's existing horizontal scroll area.
- Preserved the prior uncommitted feature; only the two owning UI files, the existing presence
  browser scenario and this evidence record change for this correction. Before snapshots are
  under ignored `.data/shell-correction/before/`.
- `pnpm format` and `pnpm check:local` passed, including all 77 unit tests. Focused real-service
  browser verification passed: identical light/dark shell surfaces, identical one-pixel separator
  colors/widths, adjacent participant/account controls, no toolbar intersection, and pointer hit
  testing at 1920/1280/1100/1024/901/641/390/320px. The original 36px header assertion remains.
- Initial added geometry probe caught a responsive reparenting race in its own measurement;
  it now waits for the toolbar to switch header rows before reading bounds. No assertion was
  weakened. Viewed corrected light/dark desktop screenshots.
- Full `pnpm verify` **passed** on the corrected shell: all 77 unit tests, all seven browser
  workflows (4.6 minutes), builds, website checks, fresh Wasm, Astryx built-output doctor and
  Cloudflare deployment dry-run/auth schema parity. `pnpm check:changed` and `git diff --check`
  also passed. No gate or existing header-height check was weakened.
- Viewed final desktop light/dark, 1024px and mobile evidence. Screenshots and the current source
  manifest are in ignored `.data/shell-correction/final/`. This source manifest supersedes the
  earlier presence-only digest: **f6d22e63b9019e55aebbbbb05a348ca876d5abeb2fcddb19a217bb860548e288**.
  Full gate log: `/private/tmp/clausid-shell-verify.log`. No commit/push or deployment occurred.
- Shell-correction cleanup: the browser runner stopped its Vite/workerd/auth and persistence
  services; stopped task-owned Mailpit PID 9439. Confirmed ports
  15173/18787/18788/17887/17888/8025/1025 are free. Isolated data/screenshots remain in `.data/`.

## Stacked header avatars — 2026-11-19

Status: Implemented and verified locally

- Replaced online-member dots/count with the existing Astryx AvatarGroup: overlapping initials,
  stable member-color markers, and a +N overflow indicator. Desktop shows up to three members;
  compact headers keep a two-slot stack, using one member plus overflow above two connected members.
- Retained the participant-list click action and name tooltip, with one accessible button and
  no nested interactive avatars. Header placement beside the account avatar is unchanged.
- Reused supported group sizes and kept the compact trigger within its existing width. Native
  group borders separate the stacked circles; the supported Avatar status slot displays each
  assigned member color.
- `pnpm check:local` passed all 77 unit tests. An initial full application gate also passed
  all seven browser workflows before visual review caught ineffective custom avatar outlines.
  Subsequent border-style probes failed their explicit color assertion. Removed those overrides
  and used the component's supported marker slot; the focused real-service browser scenario then
  passed with exact computed member colors and overlapping avatar bounds at all tested widths.
  No gate, compiler setting or header-height assertion was weakened.
- Final `pnpm verify` **passed** on the supported-marker implementation: all 77 unit tests,
  all seven serial browser workflows, builds, website checks, fresh Wasm, Astryx built-output
  doctor and deployment dry-run/auth schema parity. `pnpm check:changed` and `git diff --check`
  also passed. The full gate log is `/private/tmp/clausid-avatars-qualified.log`.
- Viewed final light/dark desktop, medium-width and mobile screenshots. Final evidence is in
  ignored `.data/stacked-avatars/final/`; source-manifest SHA-256 is
  **83be42c8d37c52f8a2e07205a2f28fd604d69f5e47780b56183fe244ea441e6a**, superseding the
  prior shell-only manifest. Verified the source files still match that manifest. No commit,
  push, deployment, dependency change or policy change was made.
- Before snapshots are in ignored `.data/stacked-avatars/before/`; only the participant component,
  existing browser scenario and this evidence record changed for this refinement.
- Stacked-avatar cleanup: browser services shut down; stopped task-owned Mailpit PID 63363.
  Confirmed ports 15173/18787/18788/17887/17888/8025/1025 are free. Restart Mailpit before
  another full browser run; isolated data and evidence remain in `.data/`.

## Astryx UI consistency refinement — 2026-11-19

The subsequent UI review standardizes sharing/signing dialogs, member lists,
spacing, feedback and action hierarchy. The existing presence transport, account
colors, shell layout and stacked avatars are preserved. Scope, source-advisory
dispositions, rendered evidence and final qualification are recorded separately
in the [UI consistency review](ui-consistency-review.md).
