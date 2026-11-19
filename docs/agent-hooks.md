# Agent lifecycle and Git hooks

Hooks reuse the [shared verification commands](enforcement.md). They are repository guardrails,
not a sandbox, branch protection, a publisher, or a substitute for release qualification.

## Installation and activation

`pnpm install --frozen-lockfile` installs Git hooks through root `postinstall`. For an existing
checkout, run `pnpm hooks:install`, then `pnpm hooks:status`. This sets only repository-local
`core.hooksPath=.githooks` and makes the three tracked wrappers executable. Existing custom hook
paths or executable legacy hooks are preserved and reported as conflicts, never overwritten.
Package archives outside a Git root skip automatic installation. Installation must also be run
after an install that deliberately disabled lifecycle scripts.

Agent configuration is separate from Git installation:

- **Codex:** [.codex/hooks.json](../.codex/hooks.json) registers SessionStart, PreToolUse, PostToolUse and Stop. Review the
  exact project definitions in `/hooks` (CLI) or Settings → Hooks / Review hooks (desktop).
  Codex's [trust model](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks) skips new or
  changed untrusted hooks; repository files cannot grant this personal trust. The installed
  `0.169.0-alpha.11.1` client recognized all four definitions without errors. The maintainer confirmed
  completing personal trust review, but a fresh local loader still reported all four enabled and
  untrusted. Effective activation remains unconfirmed; see the [evidence](specs/CSD-002-agent-and-git-hooks/tasks.md).
- **Claude Code:** [.claude/settings.json](../.claude/settings.json) registers the same lifecycle
  handlers. Use a trusted project session with project settings enabled. `--bare`, disabled hooks,
  or settings-source exclusions can disable them. The installed `2.1.81` runner executed real
  pre-tool denial, post-tool shared checks and the bounded Stop lifecycle in the local smoke below.
- **Pi:** no adapter is installed. The local `0.66.1` extension API lacks Stacki's blocking
  `agent_before_settle` event. Registering an unsupported event would falsely imply enforcement.

No personal agent settings, credentials or hook trust records are modified by installation.
Restart/reload the relevant client session after configuration changes and inspect its hook status.

## Completion behavior

SessionStart records HEAD per agent/session/worktree under ignored `.data/agent-hooks/`, with
private state files. Stop invokes `pnpm check:changed --agent`, adding the recorded merge-base
argument when available. This includes commits made during the session, not only dirty files.
The agent mode always includes docs, policy, format, root types/lint and unit tests, even when the tree is clean.

Failures return a blocking JSON decision with bounded diagnostics. The agent gets three retries
for the same findings, and at most six automatic continuations across changing findings. At the
limit, the hook explicitly reports **STILL FAILING**; it permits a handoff, not a success claim.
A passing check clears the failure state. Invalid payload/state or infrastructure failures are
reported as hook errors and stop the automatic loop. No failed check is silently converted to pass.

The child check has an eight-minute limit, below the ten-minute hook timeout. The handler emits
one JSON object on stdout and captures check logs so they cannot corrupt the hook protocol.
This fast completion gate does not run browsers or replace full integration before push.

## Pre/post-tool behavior

The shared [pure tool policy](../scripts/agent/toolPolicy.mts) and [adapter](../scripts/agent/toolHooks.mts)
match Bash, apply_patch, Edit, Write and MultiEdit. PreToolUse rejects recognized Git/check bypass
flags/environment and named protected edits. Both direct paths and existing parent symlinks are
resolved from the event working directory. The same [protected inventory](../scripts/checks/protected.mts)
widening verification is consulted before ordinary documentation routing.

Future policy work requires the operator to launch the client with `CLAUSID_ALLOW_POLICY_EDITS=1`.
An agent command cannot set, replace or unset this authorization itself. The current full program
was already explicitly authorized; installing its new guards follows the migration. Denial explains
the blocked action and owning policy. Codex receives `permissionDecision: deny`, never unsupported
`ask`/`continue` fields for PreToolUse. See the [official event protocol](https://learn.chatgpt.com/docs/hooks#pretooluse)
and [Claude protocol](https://code.claude.com/docs/en/hooks#pretooluse).

PostToolUse formats only explicitly named successful edits inside the worktree, including moved
patch paths. Failed/opaque responses and shell calls receive read-only policy/static verification;
the adapter never guesses a directory to rewrite or changes the Git index. Logs are captured and
bounded; failures return blocking feedback. Input is limited to 128 KiB, post-policy to 60 seconds,
post-static/format batches to 120 seconds and the whole client hook to 240 seconds. Normal completion
still runs the shared local/unit gate. A post-tool check cannot undo a completed tool's side effects.

These recognizers are guardrails, not a full shell parser or security boundary. Computed paths,
opaque scripts, unobserved clients and process/client opt-outs need review and independent Git/CI
checks. No claim is made that a hook prevents every way to bypass a local check.

## Git behavior

| Hook         | What is checked                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | An isolated checkout of the actual index runs `pnpm check:changed`; unstaged fixes cannot hide staged failures                                         |
| `commit-msg` | Non-empty subject, at most 72 Unicode characters, blank line before a body; no conventional-commit prefix or mandatory body                            |
| `pre-push`   | Each unique pushed commit runs its required shared full profiles; tags/new branches/unknown bases use `verify:all`; docs-only updates run `check:docs` |

Deleted refs contain no new source and skip verification. Duplicate refs naming one commit share
one check. No cached success marker is used. Failures block the commit/push and leave user files,
index and branch unchanged. Only disposable verification checkouts are removed.

Snapshots clear exported Git-local variables, including alternate index/worktree settings.
Installed dependency links are reused, but workspace package links resolve to the snapshot's
source. Generated PDF declarations may be copied for static checking; full app/PDF gates rebuild
Wasm. Dependencies must already be installed. Snapshots do not load an untracked `.env`; push
browser checks explicitly use local Mailpit SMTP. Temporary `.git` repositories disable their
own hooks solely to prevent recursive verification; hooks in the user's checkout remain active.
The web dev server allows the snapshot workspace and the real pnpm dependency store so LiveStore's
Wasm can load from reused dependencies. It does not add the original checkout's source to that list.

Browser/push gates still need Mailpit, Chromium, Rust and wasm-bindgen, and remain serial because
the [persistence/Mailpit endpoints](runbooks/local-development.md) are fixed. Missing tools/services
fail rather than skip. Git's standard bypass options still exist; agents must not use them. CI
runs the shared profiles independently. Required branch checks remain a maintainer configuration.
Install the Wasm target for the pinned toolchain with
`rustup target add wasm32-unknown-unknown --toolchain 1.93.1`; installing it only for the default
toolchain can leave fresh snapshot builds unable to find Rust's `core` crate.

When first adopting this tooling, include the shared scripts/package commands in the staged/pushed
snapshot. A snapshot lacking its verification entry points fails; dirty local tooling is not used
to pretend an older commit contains them. Linked worktrees need the hook files in their branch;
the relative hooks path follows each checkout. POSIX shell hooks are tested on macOS; CI targets Linux.

## Verification evidence

[Regression tests](../tests/verification/hooks.test.ts) use disposable real Git repositories and
local bare remotes. They cover partial staging, dependency resolution, alternate Git indexes,
push selection, custom-hook preservation, quoted paths, message rules, and completion retries.

`pnpm hooks:smoke:claude` is an optional installed-client test, separate from CI's unit suite.
It uses a local response fixture and dummy API credentials. The actual Claude process loads
project settings, runs Stop, continues three times on intentional check failures, then reports the
unresolved result. A second phase requests a prohibited bypass and a harmless printf: the real
pre-tool denies the first, and real post-tool invokes shared checks after the second. Instrumentation
exists only in the disposable fixture. No paid provider is contacted. This verifies lifecycle
integration, not model quality or application behavior. Current results are in the [engineering tracker](clausid-engineering-tracker.md);
the [CSD-002 record](specs/CSD-002-agent-and-git-hooks/tasks.md) preserves earlier evidence.
