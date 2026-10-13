# Private Gateway Turn Authority - Batch019

Status: PARTIAL_NOT_COMPLETE. Source candidate; hosted installation and full
private-session acceptance are not established. No production or provider action.

## Reproduced Boundary

At parent19285fef052e31b3dd7bf4862be818eaf905a8f1, Gateway chat writes sessions,
user/assistant messages and a stale revision with the service role. A synthetic
transport returns membership preflight success then changes membership before
the assistant write; the actual handler returned200 and persisted that answer.
This is local controlled reproduction, not a hosted exploit or customer probe.

## Candidate

The read-only caller-JWT/public-key context checks active workspace, research
role and private session ownership before admission; a missing session returns
revision0. The final caller-bound transaction rechecks current active workspace,
member role and exact private owner, session lifecycle and captured revision.
Server-only staging binds the exact checked question/answer/sources/metadata and
workspace/session/revision/key by a canonical payload hash on the protected
admission. A browser cannot use an outstanding admission to forge assistant
evidence or change an attested payload. The final caller-bound pair, new session,
revision and admission-consumption marker commit together.
Clear or competing writes invalidate stale revisions rather than resurrect history.
Missing/denied/expired/consumed admissions cannot mint unlimited RPC turns.
Foreign, participant and legacy sessions do not gain Gateway owner authority.
Existing participant/legacy read and clear contracts are unchanged.

Workspace NO KEY UPDATE precedes membership/admission/session NOWAIT locks;
inverse old writer or member DELETE lock orders fail before partial mutation.
Exact receipts and caller identity are checked by Gateway. Denial, conflict,
ambiguous persistence or cancellation never return a completed answer, audit
success, privileged fallback or automatic metered retry. Question-before-answer
timestamps and stored revision preserve deterministic history restoration.

CLI2.120.0 created20261013084820_gateway_private_turn_authority.sql. Public wrappers
are INVOKER, private implementation fixed-empty-path DEFINER with auth.uid and
authenticated-only execution. No table access/RLS/JWT grants are widened. This
file is NOT installed in either hosted project; fulfilled013 approval is unrelated.

## Verification And Remaining Work

31 new Gateway cases cover bound roles/IDs/revision/receipts, foreign-context
denial before quota, revocation/clear conflicts, cancellation and ambiguity.
Final402 Gateway tests pass, including real synthetic upload-to-answer contracts
and four server-attestation controls. Final359 frontend,585backend+10subtests,
57isolated,87scripts,lint,typecheck,Next/OpenNext25routes pass locally. Actual
SQL authority/locking/concurrency and fresh saved-source/recovery/CI are pending.
SQL assertions cover ownership, admission reuse/denial/expiry, lifecycle, ordering,
clear fencing and forced second-insert rollback; concurrency assertions cover
revocation, workspace change, competing turns, clear and inverse lock order.
Their actual disposable PostgreSQL execution and exact saved-source CI remain
required. Source syntax or mocked receipts do not prove transactional authority.
One read-only investigator could not start due model capacity; separate parent
investigation performed. One fresh candidate review completed and identified
two confirmed issues: unstaged direct RPC could forge assistant evidence and a
failed first turn could leave an uncleareable local draft. Protected server-only
attestation closes the former; explicit local-only reset preserves durable denial
and ambiguity behavior while resolving the latter. UI regression fails before,
five focused checks pass after. Final SQL/exact-source verification remains required.

The raw pytest invocation differs from the required secret-free denied-network
runner; it reported584pass/one provider-fixture status failure. The required
runner initially passed585+10. A new fake-client-called assertion then fails:
the parent google namespace retained the real cached submodule. Patch both
sys.modules and parent namespace; unchanged503/no-storage plus fake-client-called
assertions now pass in585+10 denied-network cases. No provider exception policy
change, removed assertion or live acceptance claim. Both failures retained.

This scope does not close retained FastAPI append/cache authority, cancellation
of in-flight provider processing, legal holds, source-deletion/citation transaction
fences, durable query runs/erasure, real two-user OAuth, products or production.
All224 exact normative definitions and ten products remain accepted and unfinished.
Image gate107matches101Medium6Low still blocks release; no bypass or waiver.
Batch018534-source/33-receipt ZIPs and new exact recoveries are frozen; refer to
external BATCH018_HANDOFF.md for identities, checksums and complete CI receipts.
