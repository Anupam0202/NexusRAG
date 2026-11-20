# Caller-Authorized Gateway History

Application PARTIAL_NOT_COMPLETE. This batch addresses only the gateway history
read boundary, not full private-session authority or production acceptance.

## Boundary And Compatibility

GET/HEAD /api/v1/chat/sessions/{id}/messages previously performed an owner-only
service-role preflight, then a separate privileged message read. A committed
revocation, tombstone or workspace lifecycle change between those calls could
leave the projection using stale authorization. This is a source-backed race,
not a claimed customer-data exploit in a hosted environment.

The read now invokes read_gateway_private_history with the inbound caller JWT
and public API key. The private implementation derives auth.uid and checks the
active workspace and existing owner/participant/legacy conversation predicate
within the STABLE statement snapshot used by the projection. The public wrapper
is INVOKER; the non-exposed implementation is DEFINER with empty search_path and
qualified relations. Authenticated-only EXECUTE, no actor parameter, no private
table grant/RLS change, privileged fallback or automatic retry. The gateway's
membership precheck is not the final private-message authority.

The existing frontend restores history through a single request without paging.
The older narrow read_private_history RPC rejects limits above100. Reusing it
would silently truncate the gateway's500-message window, so the new RPC retains
a fixed oldest500 window ordered by created_at,id. Existing100-bound RPC behavior
is unchanged. This batch does not claim full-history pagination or latest-window
behavior. Equal timestamps now have deterministic id ordering.

One independent reviewer found a concrete alternate RPC lifecycle bypass: the
existing read_private_history directly exposes messages while membership and a
live session remain in an inactive workspace. Confirmed statically against its
predicate and direct callers; no hosted exploitation was attempted. This new
migration replaces only that private implementation to add the same active
workspace check, preserving its public wrapper, grants and1..100 limit contract.
The earlier already-saved/applied migration is not rewritten. Both RPCs are
asserted to deny the inactive workspace in the disposable SQL fixture. There
was no pre-patch execution of this alternate SQL case, so source confirmation
and the fresh exact-head SQL result must not be represented as a hosted exploit.

The gateway checks every returned row's canonical workspace/session binding and
the existing role/content/sources/metadata/timestamp shape. Malformed, foreign or
oversized projections fail503 HISTORY_UNCONFIRMED without rendering any record
or provider diagnostics. Explicit[] denial remains200empty to preserve the
existing non-disclosing API. Messages expose only the same five existing fields,
total remains returned-window length, and HEAD remains bodyless/private no-store.
Unsupported methods no longer perform a privileged private-record preflight.

## Verification And Remaining Work

28 gateway regressions failed against the prior source while43 nearby controls
passed. Corrected focused28 and full323gateway assertions passed locally; the
unchanged585backend+10subtests and354frontend tests also passed freshly. Source
SQL was scaffolded by Supabase CLI2.120.0 as
20261011185509_gateway_private_history_read.sql. No hosted application is implied.

Rollback-only disposable SQL fixtures cover owners, both participant permissions,
ownerless legacy readers, unrelated viewers and owner overrides, revocation,
tombstones, inactive workspace, cross-workspace/unknown/missing identities,
unexpanded grants, deterministic501-to500 ordering and unchanged101-limit denial.
Exact-head database CI/backup restore, saved source and fresh
recovery remain verification gates; their actual results belong in later receipts.
No local PostgreSQL is available. Prior rehearsal clear-migration approval does
not authorize installing this new function or production deployment.

Statement snapshot authority is not revocation of already-returned data or a
claim that query/append/process caches, cancellation, legal holds, erasure/audit
and all readers share this boundary. Real two-user OAuth/JWT REST, private
Storage/ingestion/retrieval, current-source hosted rollout and the ten accepted
product workflows remain unfinished. All224 normative definitions are retained.
The previous exact image gate failed163backend matches57High/50Medium; no gate,
dependency lock or security threshold was changed.

Official reference: [Supabase database functions](https://supabase.com/docs/guides/database/functions).
