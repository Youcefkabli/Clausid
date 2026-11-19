# Historical record

Archived from `docs/specs/CSD-002-agent-and-git-hooks/handoff.md`. Its results apply only to its recorded tree.
The current program is the [engineering plan](../../clausid-engineering-plan.md) and [tracker](../../clausid-engineering-tracker.md).

# CSD-002 — Handoff

Base `027772e` plus uncommitted foundation and hook changes. Git hooks are installed in this
checkout via local `core.hooksPath=.githooks`; no global hook setting was changed. Root postinstall
installs the tracked wrappers in future Git clones, preserving custom-hook conflicts.

The maintainer confirmed reviewing and trusting both Codex project definitions on 2026-11-18.
A fresh local `hooks/list` probe nevertheless still reports both enabled but untrusted, with no
errors/warnings. The binary and project path match the earlier probe, and configuration was not
changed. Personal review is complete by maintainer report; effective activation remains unconfirmed.
No trust bypass or personal state rewrite was used. Claude's actual Stop lifecycle passed a local-
response smoke; Pi is intentionally unconfigured because its installed version lacks the blocking event.

Implementation and local verification are complete; [tasks](tasks.md) records the staged negative/
positive checks, 29 unit tests, installed Claude lifecycle and full pre-push snapshot gate (five
browser, ten PDF rewrite and two operations tests plus builds/static checks). Fresh snapshot testing
also caught the binary-shim remapping and Vite dependency-store serving issues, both corrected.

Next: reconcile the desktop review with the conflicting local loader trust status, then exercise
a trusted session. Configuration/loader evidence is not a live trusted Codex turn.
Submit the uncommitted implementation for review/CI when requested. Do not start the separate
client-boundary pilot or publish/deploy as part of this workstream.

Verification used snapshot-owned data and ports `15173/18787/18788`, plus the browser suite's fixed
persistence/Mailpit endpoints. Temporary snapshots and fixture servers were removed; owned Mailpit
is stopped at handoff. Serialize future browser gates and confirm service cleanup after interruption.
