# Retained Python Private Turn Authority - Batch021

Status: PARTIAL_NOT_COMPLETE. Locally exercised source candidate, not hosted
private-user verification, deployment or production acceptance.

## Boundary And Reproduction

At saved parent f0a70c12e2a29296fe8a970e18294459dbdfec47 the actual REST and
WebSocket persistence helpers and MessageRepository use privileged split writes.
An offline synthetic transport shows same-workspace foreign-owner writes and a
user-only partial pair after the second insert fails, while both return a session.
The standalone Codex Security reproduction artifact has SHA256
7fa8bc404f5ff8e042b148e75ad4d926a80815e57e728f4863deef4b839aa1cb. It is not
hosted exposure or customer exploitation evidence.

The candidate removes unfenced private-turn table helpers. A caller-JWT RPC reads
current private-owner context, canonical ID, bounded history, revision and a
separate history epoch before quota/history/model/cache effects. A second read
after the quota await rejects revocation or changed snapshots before generation.
The final RPC rechecks current Auth session/JWT expiry, membership, workspace and
session lifecycle/ownership under locks. Server-only exact-payload hash staging
cannot be issued by browsers and is separate from quota admission. Creation, the
two message rows, revision/epoch and staging consumption commit together. No
privileged caller-token retry, direct-table fallback or automatic regeneration
is introduced.

Statement triggers advance history_epoch for all affected insert/update/delete
message sessions, including older writers that do not advance revision. Identity,
visibility and tombstone changes also fence the epoch. Existing revision contracts
are preserved. This is a forward migration, not a modification of applied history.
Current grant assertions deny browser table writes, Auth-session table access and
staging; caller read/commit are authenticated-only, fixed-search-path wrappers.

## Compatibility And Review

Python owner/admin/editor/viewer membership roles may use their OWN private
conversation. Workspace ownership is not private-session ownership; participants,
null-owned, legacy-visible, foreign and tombstoned sessions do not gain private
append. Existing participant/legacy history reads and owner-only clear contracts
remain separate and their database tests still pass. Local/demo behavior stays
explicitly separate; missing enterprise configuration never becomes demo.

One independent read-only pre-patch investigator and one fresh read-only candidate
review cycle were completed. The candidate reviewer identified four concrete
gaps. Parent confirmation/correction adds the after-quota authority recheck,
existing workbench source-lifecycle projection for run-linked automatic history,
generation-usage accounting independent of persistence success, and disconnect
checks before generation/commit. The reviewer did not execute tests or certify
the final revised source; parent regression/diff review follows the one cycle.

Private generation uses request-owned memory and authority-bound cache namespaces,
never the shared mutable session memory. Confirmed generation usage is recorded
even when commit fails or delivery is lost. REST success and WebSocket done require
a strict scoped receipt. HTTP authority/conflict/unconfirmed errors have static,
actionable WebSocket codes without private exception text. Cancellation propagates.
A disconnect observed before commit skips persistence; a delivery failure after
commit cannot undo a durable transaction. Caller-authorized history/reload remains
necessary for uncertain outcomes; no success frame or blind metered retry is sent.

## Actual Local Verification

- Denied-network backend:630tests plus10subtests pass; includes actual handlers,
  serialized frame order, strict receipts, before-effect denial, quota-await
  revocation, source-projection changes, usage, disconnect and cancellation.
- Actual RAGChain/Cache test proves request-owned history, unchanged shared memory,
  matching-authority hits and different-epoch cache separation.
- PostgreSQL17.11/pgvector0.8.7 from signature-checked official PGDG packages ran
  unprivileged in a new Unix-socket-only disposable WSL cluster. No system database
  service or hosted project was modified. Full baseline/forward-migration,
  existing authority/grant/Storage fixtures, new four-role/forgery/second-row
  rollback/source-withholding assertions and independent concurrent sessions pass.
  Logical backup/restore passes61tables and105public/Auth/Storage functions.
  The temporary database was dropped and server stopped; Auth/Storage are stand-ins,
  not Supabase services or actual OAuth/JWT acceptance.
- Concurrency covers competing append/clear, legacy epoch mutation, membership/
  workspace revocation, Auth-row contention/removal, expiry after lock waiting and
  inverse member/workspace lock order. Additional production lifecycle/rights/
  provider and general asynchronous cancellation semantics remain unfinished.
- Initial SQL fixture attempts had wrong claim role during member mutation and
  invalid job kind; both fixtures were corrected without relaxing guards. A run
  passed SQL/backup but failed a CRLF-only wrapper line; a corrected new-cluster
  rerun exits0. Two memory-fixture attempts used nonexistent APIs; corrected to
  the existing add(role,content) contract. Failed available logs are retained.
- Source-time scripts/Gateway/frontend/build, exact saved-source recovery and new
  CI/image results must be recorded in subsequent immutable receipts. Do not infer
  them from parent020, a reused development environment or this source-time note.

## Open Acceptance

No approval/install exists for20261013195435_backend_private_turn_authority.sql
on hosted Supabase. Exact019 rehearsal-only approval is fulfilled and cannot be
transferred. No deployment, production/customer history, provider processing or
new hosted fixture identity operation occurred.

This batch does not close all private-session/source/rights/cache/lifecycle
requirements. Authority cannot be treated as held across external model work;
final mutation is fenced and known pre-generation awaits are revalidated. Source
and rights changes during model use, general legacy/unverified history policy,
complete metered atomic reservation, durable caller idempotent reconciliation,
legal holds/erasure, real two-user journeys, native worker deployment and ten
complete products remain accepted work. Parent exact image scan remains FAILED
107matches101Medium6Low,frontend0,ignored0; no security gate changed.

Continue all224 definitions/tenproducts and highest-risk independent engineering
after the complete source/recovery checkpoint. Main/release remain untouched;
retain the existing draft PR12 rather than making a new review branch or bypassing
failed gates. Native/image, hosted acceptance, source/schema/origin compatibility,
rights/budgets and safe release/rollback/cleanup are not proven by local success.
