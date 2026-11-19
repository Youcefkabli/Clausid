# Signing and evidence

- **SIGN-001:** A preview binds a current draft revision, signer set, digest and expiry. Changed
  content or expired previews require another review.
- **SIGN-002:** Freeze stores the exact preview bytes as the frozen PDF. It does not render again.
  Signing references the frozen version ID and SHA-256 digest.
- **SIGN-003:** Signatures bind eligible verified account, email, name, consent version, version ID,
  digest and timestamp. Recent sign-in is required. The contract is Signed after all required signatures.
- **SIGN-004:** Evidence contains `contract.pdf` and `signing-evidence.json`; the manifest's SHA-256
  covers exactly those PDF bytes. Consent and signatures are recorded separately from PDF bytes.
- **SIGN-005:** Frozen content is not editable as a draft. A contract with a recorded signature
  cannot be deleted through draft deletion.

Status: Living reference
Owner: Clausid maintainer
Verified against: 027772e plus the engineering implementation; see tracker

## State machine and authority

Contract state is `Draft`, `Awaiting signatures`, `Signed` or `Voided`. Workspace display statuses
are separate metadata. The provider prepares/shares a workspace document; contract membership and
owner checks remain authoritative. An editor role does not imply a right to sign.

| Operation | Preconditions                                                       | Committed state                                                | Rejection                                           |
| --------- | ------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------- |
| Preview   | Owner/provider path, current draft revision, review resolved        | Preview metadata and exact bytes                               | 409 stale/unresolved; rendering errors leave draft  |
| Freeze    | Same unexpired preview ID and revision                              | Frozen bytes, version, signer invitations; Awaiting signatures | 409 stale/missing/expired preview                   |
| Sign      | Eligible verified identity, matching version/digest, recent session | Signature; Signed after all required signatures                | 409 unavailable/version mismatch; 428 stale sign-in |
| Void      | Owner and Awaiting signatures                                       | Voided; invites/outbox cleared                                 | Unavailable operation rejected                      |
| Evidence  | Signed and authorized                                               | Read-only ZIP response                                         | Missing/ineligible artifact unavailable             |

## Preview and invalidation

The request carries revision and 1–20 unique normalized signer emails. The actor rejects duplicate
signers and unresolved applicable suggestions/annotations. It chooses stored negotiated bytes,
source bytes, or renders the native draft. It computes SHA-256, creates a preview UUID and stores
bytes plus signer set/revision/expiry. Expiry is 15 minutes. Fetching an old preview also checks
revision and expiry; a cached browser link does not freeze the right document by itself.

Draft/review/annotation mutations invalidate preview metadata and remove preview bytes in the same
transaction as the change. Generating a preview does not create signatures. A renderer failure
cannot transition the contract to Awaiting signatures.

## Freeze protocol

`Contract`'s freeze branch looks up the existing preview bytes and copies them into `frozen`.
It uses the preview ID as version ID, keeps its digest/signer set, records a timestamp, removes
preview bytes and persists invitations/outbox together with the state change. There is no second
render call. Delivery may be retried; an invitation's digest, verified email and expiry still gate access.

Original and negotiated artifacts remain distinct from frozen evidence. A parser/type migration
must not recalculate a digest from a newly rendered document or rewrite the frozen artifact.

## Signature idempotency and freshness

The request contains versionId, 64-hex digest, name (1–120 trimmed characters), `consent: true`
and consent version `1`. The server binds its own account ID/email and timestamp. Consent text is
`I have reviewed this document and agree to sign it electronically.`

Version/digest mismatch is checked before signing. A repeated signature by the same account and
same name returns the current view after the matching version check, rather than adding another
record. New signatures require `canSign` and a sign-in created no more than ten minutes ago.
`Signed` follows the complete required signer set, not the number of current editors.

The signature is an explicit record; typing a name alone into a form is not persistence. A contract
with a recorded signature cannot be removed through draft deletion. The public response's `canSign`
is useful UI data, while the actor rechecks authority for the operation.

## Evidence and recovery

The ZIP contains `contract.pdf` and `signing-evidence.json`. The manifest records contract/title,
version, SHA-256, frozen time, required signers, consent text/version and signature records.
The hash covers exactly `contract.pdf` bytes. It does not cover the entire JSON manifest or establish
an independent signing authority. Preserve frozen PDF and manifest together through recovery.

Owners: [actor preview/freeze/sign/evidence](../apps/worker/src/contract.ts),
[schemas/consent](../packages/contracts/src/index.ts), [offline verifier](../packages/ops/src/main.rs).
Evidence: [input tests](../tests/validation.test.ts), [workflow](../tests/workflow.spec.ts),
[restore](../tests/persistence.spec.ts). Hosted identity/mail, legal acceptance and operational
recovery qualification require their own evidence; local schema acceptance does not establish them.
