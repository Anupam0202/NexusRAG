# Caller-Authorized History Cleanup

Application PARTIAL_NOT_COMPLETE. Bounded source fix for conversation cleanup,
not full query/cache authority, generation cancellation, complete erasure or
hosted acceptance.

## Boundary

The retained FastAPI endpoint admitted any current workspace member to a
service-role workspace/session DELETE. The Cloudflare gateway checked the
owner separately, then counted rows before a privileged DELETE and revision
PATCH. Returned-row validation was not destructive authority; the preflight
could be stale at mutation time.

Both clear callers now invoke clear_private_history with the validated caller
bearer and public API key, without privileged fallback. The unexposed private
implementation derives auth.uid, locks/rechecks an active workspace, current
membership and a live caller-owned session, then deletes scoped messages and
atomically increments the session revision. Its exposed wrapper is invoker-only.
Authenticated-only EXECUTE, fixed empty search_path, no actor argument, no new
table grants and unchanged RLS. Read/contribute/legacy permissions are not
deletion authority. Workspace administrators cannot clear another owner's chat.

The session remains live and reusable. A one-element canonical scoped receipt
contains literal success=true and the actual DELETE ROW_COUNT, including zero.
Both callers reject missing/multiple/foreign receipts and non-integer, negative,
boolean or unsafe counts. Empty denial is not zero-success; the gateway uses
CONVERSATION_UNAVAILABLE, not SESSION_NOT_FOUND, so the frontend preserves local
history on denial. Errors are static, no automatic mutation retry; cancellation
propagates in Python. Durable receipt precedes memory clear and success audit.

Memory UUID keys normalize all parser-accepted forms on read/write/clear.
Non-UUID local/demo keys are unchanged. Deploy by restarting old processes:
raw-key in-memory state from an older process is not migrated by this patch.
This normalization does not establish actor authorization for query/cache use.

## Evidence And Limits

24 backend assertions failed before correction;557 existing tests plus10 subtests
passed in that reproduction.22 gateway assertions failed before correction.
Fresh local585 backend+10,295 gateway and354 frontend tests passed. Focused tests
exercise denied/legitimate zero-message cleanup, exact caller credentials/scope,
safe errors, invalid counts, cancellation, UUID aliases, actual memory clearing,
UI denial retention, duplicate submission and a reusable next-turn workflow.

CLI2.120.0 migration new, after help inspection, scaffolded
20261011140756_private_history_clear.sql. Rollback-only SQL fixtures cover owner,
viewer-owned sessions, participants, ownerless legacy, workspace-owner override,
revocation, inactive workspace, tombstones, cross-workspace, missing identity and
unexpanded grants. Separate sessions test authority changes committed while the
clear waits, cleanup before revocation and a locked append before cleanup.
The count is transaction-local: a later authorized turn can create new messages.
No claim that all existing append/generation implementations share these locks.
Independent review confirmed an inverse lock order in existing direct member
removal. Membership locking now uses NOWAIT: contention fails before deletion,
releases the workspace transaction and permits revocation to complete. Workspace
NO KEY UPDATE still excludes lifecycle/revision changes but permits the foreign
key KEY SHARE locks used by existing appends. A regression orchestrates the exact
member-removal interleaving; no automatic retry or false cleanup claim is added.

Disposable PostgreSQL execution, exact-head image/required CI, fresh recovery and
the single independent review outcome must be bound to actual later receipts.
Local PostgreSQL is unavailable. New hosted migration/deletion/rollout has NOT
occurred. The prior011 rehearsal read RPC does not authorize this mutation.
No customer data, new account permissions, provider calls or paid activation.

Official guidance: [Supabase functions](https://supabase.com/docs/guides/database/functions)
and [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html).

All224 definitions and ten products remain accepted. Query/append/private memory
and cache authority, legal holds, deletion generations, independent erasure,
audit durability, current-source hosted rollout, real two-user OAuth/REST and
all product workflows remain unfinished. Image-security gates remain binding.
