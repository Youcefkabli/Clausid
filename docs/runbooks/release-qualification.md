# Release qualification

1. Select a candidate revision and deployment target; link the owning issue and accepted specs.
2. Run `pnpm verify:all` with the pinned prerequisites and inspect CI on that exact revision.
   Local-only changes have no new CI result until submitted.
3. Deploy to the isolated target using its owning runbook. Exercise two verified accounts,
   provider-only sharing/approval, live editing/reconnect, current preview/freeze, signer consent,
   evidence download and PDF digest comparison.
4. Rehearse that target's coordinated recovery and inspect restored access/drafts/artifacts.
   Record external email/proxy/runtime behavior separately from local checks.
5. Fill the [qualification record](../templates/qualification.md), including failures/pending checks.
   The maintainer records the decision and release reference; do not label a candidate qualified
   while required evidence remains missing.

No automatic publisher, tag creation or production deployment is introduced by this workflow.
