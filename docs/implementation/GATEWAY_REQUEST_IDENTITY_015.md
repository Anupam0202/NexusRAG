# Gateway Request Identity Validation

Application PARTIAL_NOT_COMPLETE. A request input/canonicalization correction,
not conversation write authority, hosted acceptance or a new quota policy.

## Defects And Compatibility

Gateway chat used a permissive36-character hex/hyphen test to accept session_id,
otherwise silently substituted a newly generated UUID. This could create a
different conversation instead of rejecting a malformed requested identity.
Some malformed values reached persistence with an invalid UUID; a valid trial
admission happens earlier, so a real database may reject the session after
account admission. Synthetic fixtures demonstrate admission/write attempts,
not real hosted counters or a customer-data exploit. Uppercase UUID response
metadata also differed from canonical durable/history identifiers.

Account admission required a UUID in its error message and existing database
signature but used a loose prefix/tail regex. Malformed all-hyphen or ungrouped
tails could reach the UUID RPC and fail as persistence errors rather than input
errors. Existing migrations032/034/039 define p_idempotency_key UUID, so casing
is already equivalent in the database. This is not a claim that casing bypassed
SQL replay protection or that source input validation alone enforces ownership.

Chat now requires a provided non-null session_id to be a string matching the
existing UUID_PATTERN before settings/document reads, quota or record writes.
Invalid values return a static422 INVALID_SCOPE without reflecting the value.
Only omitted/null starts a newly generated UUID. Valid uppercase/lowercase UUIDs
normalize to one lowercase session ID used for lookup, persistence and response.
No new version/nil restrictions or arbitrary legacy identifier conversion.

The shared account admission path validates its header with the same existing
UUID_PATTERN and lowercases before RPC. Invalid shape returns400 before quota
or record/storage writes. Upload retains its existing read-only duplicate lookup
before admission; a duplicate that needs no admission keeps existing behavior.
This does not change arbitrary-string idempotency on workspace creation or
other differently typed APIs. No JWT/RLS/role, quota limit, replay, provider
attestation, private persistence semantics, database or credential changes.

## Verification And Limits

20 initial handler tests reproduced19 failures/one existing denial control PASS;
76 neighboring fixture/history assertions passed. Diagnostics count synthetic
quota RPC and writes; no actual provider/Supabase/customer mutation was executed.
Corrected22 focused tests cover omitted/null, empty/invalid hex/grouping/space,
primitive/object/array input, valid upper/lower IDs, malformed admission keys,
same canonical ID throughout synthetic response/messages/session creation, and
shared upload rejection before quota/storage. Two newly added upload fixtures
initially used a wrong path and missing classification; corrected from the actual
frontend API and existing duplicate-read behavior without weakening no-write
assertions. Failed harness log retained. Those extra upload tests were not run
pre-patch; do not claim22 pre-patch reproduced failures.

Fresh local371gateway/zero skips,585backend+10subtests,357frontend/51files,
57isolated,79scripts, lint/typecheck,Next/OpenNext25assets and migration/foundation
checks pass at source save. The actual local Worker runner adds session422 and
admission-key400 assertions with only synthetic Auth/member/empty metadata GETs,
no owner credentials/queues/crons or provider/upstream write. Prior fixture mode
and role checks remain intact. Actual locked dependencies are unchanged.

Exact saved-source CI, complete archive/recovery and fresh reruns are still
required and belong in immutable later receipts. Prior014 actual image and
required summary failed163backend matches57High/50Medium despite successful
containers/native/neural runtime checks; no inherited security clearance.
All224 normative requirements and ten products remain accepted.

Conversation ownership/participant mutation, atomic append/revision, stale
authority and cleanup/generation races remain unfinished. Input canonicalization
does not solve those transactions, cache/query authority or full audit/erasure.
Hosted013 migration approval, actual two-user OAuth/private workflow and current
source/schema rollout remain separate gates. No hosted migration, deployment,
paid activation or customer/provider/destructive operation occurred.
