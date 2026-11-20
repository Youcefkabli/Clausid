# Astryx UI consistency review

Status: Implemented and verified locally
Owner: Clausid maintainer
Issue: Direct UI refinement requested in chat
Base: `600514c9efee449096796ec73ce007aea72b721d` on `codex/engineering-adoption`

## Scope and findings

Reviewed the web app against the installed Astryx **0.7.16** layout, principles,
dialog, list and component guidance. Preserved the existing uncommitted workspace
presence implementation, the 36px header, stacked avatars, and the settings,
login, workspace wizard and table template frames. No dependency, theme,
authorization, persistence or signing-contract changes are part of this refinement.

| Finding                                                                                   | Refinement                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Share, signature and void dialogs used different headers and action placement             | Astryx DialogHeader, LayoutContent and LayoutFooter, with shared padding, separators, consistent dismissal and error clearing |
| Member, invitation and signer collections used browser-styled lists                       | Astryx List/ListItem rows with aligned secondary information and compact row actions                                          |
| Page, invitation and form spacing depended on global CSS selectors                        | Astryx stacks and spacing tokens; removed obsolete layout selectors and global form styles                                    |
| Comment actions lacked a clear primary action; native/PDF row actions had different sizes | Primary submit/reply actions, loading feedback, compact secondary actions                                                     |
| Void confirmation looked like a normal primary action                                     | Destructive confirmation styling; cancel remains directly available                                                           |
| Status/error text used raw wrappers and paragraphs                                        | Astryx Text and Banner with existing live-region semantics                                                                    |

Form semantics and input labels remain native and accessible. The share and
signature dialogs use the form-purpose dismissal behavior supplied by Astryx.
Workspace rows show the available display name and email together. The signing
setup dialog also uses the standard dialog inset, preserving its existing stepper
and footer frame.

## Source audit and remaining adapters

`pnpm exec astryx doctor --built .` from `apps/web` initially reported **66**
source advisories (32 styling, 34 component findings). After refinement it reports
**21** (20 styling, one component finding), with **12 passing checks and no
failures**. This source review is separate from the narrower `--built dist`
check used by the full verification profile. The advisory count is not an
accessibility or visual-quality score.

Remaining source advisories include token-based StyleX layouts, existing template
font/footer styling and these native integration boundaries:

- Tiptap owns editable content, selection and collaboration decorations.
- PDF.js owns canvas/text-layer geometry; the preview uses a native iframe.
- Resizable panel adapters forward their supplied class/style props.
- The existing document-tab padding adjustment preserves the compact header.

These adapters retain their current behavior. No rule, check or threshold was
weakened to remove warnings.

## Verification and handoff

- `pnpm format` passed.
- `pnpm check:local` passed: documentation/policy/format, strict types and lint,
  and 77 unit tests in 15 files.
- Rendered review caught inherited zero-padding in the first implementation.
  Two earlier full runs were deliberately stopped for that correction; neither
  is counted as a passing gate. Restored the Dialog inset and Layout spacing,
  and added vertical separation and 320px gutter assertions.
- Focused `pnpm exec playwright test tests/workflow.spec.ts -g 'verified users collaborate'`
  passed (one workflow, 1.6 minutes). An earlier anchored title filter selected
  no tests and was corrected; that invocation is not counted as verification.
- Final `pnpm verify` passed on the current source: strict types/lint, all 77
  unit tests, website diagnostics/builds, fresh Rust/Wasm and application builds,
  Astryx built-output doctor (12 pass, zero warnings/failures), Cloudflare
  deployment dry-run/auth schema parity, and all seven serial browser workflows
  (4.6 minutes). This includes provider permissions, reviewed PDF bytes,
  signatures, persistence recovery and explicit retry of unsaved edits.
- Viewed final sharing/signing dialogs at desktop and 320px, void confirmation,
  workspace parties, and light/dark member rosters. Existing header tests retain
  the 36px assertion, matching shell surfaces/dividers, avatar overlap and colors,
  no toolbar intersection, and pointer hit checks down to 320px.
- `pnpm check:changed` and `git diff --check` passed. The additional application
  profile requested by the changed-file gate passed via the full verification
  above. No hosted, release or personal-agent-hook qualification is claimed.

Before snapshots are in ignored `.data/ui-consistency/before/`. Final screenshots,
source-audit JSON, logs and the verified source manifest are preserved in
`.data/ui-consistency/final/`. The manifest covers 21 changed source/test files
against the recorded base; SHA-256
`0176d927f0f1f7336decf71b360928d516564be293f642817ce16fed18d92808`.
Documentation is excluded so evidence recording does not change the runtime digest.
The local full-gate log is `/private/tmp/clausid-ui-consistency-verify.log`.
Test resources use `.data/presence-check`, Vite/workerd/auth ports
15173/18787/18788, fixed serial persistence ports 17887/17888, and task-owned
Mailpit on 1025/8025. No commit, push, staging or production release is included.

The browser runner stopped its Vite/workerd/auth and persistence processes.
Stopped task-owned Mailpit PID 66441 and confirmed all listed ports are free.
Isolated data and rendered evidence remain under `.data/`. Git hooks are active
(`pnpm hooks:status`); personal agent-hook trust remains separate.
