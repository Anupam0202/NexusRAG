# Hosted History Read And Exact Recovery

Application PARTIAL_NOT_COMPLETE. This bounded batch records one explicitly
approved rehearsal schema operation and fixes a verified checkpoint metadata
roundtrip defect. It does not close private-session or production acceptance.

## Approved Hosted Operation

The user approved only migration20261011185509_gateway_private_history_read.sql,
SHA256c6e67215400eda00a05fa52aef1b09012cfab7ba12ce5183e048eef435a7d17c,
to rehearsalukgjygzfhyvnrsecdcuu. Source26145ca/tree624015f contains those bytes.
Fresh project identity, existing authority/read functions, absence of new RPCs
and no authenticated table access were checked before installing the exact SQL.
Supabase recorded20261012131630_gateway_private_history_read at13:16UTC Oct12.

Post-install catalog verification compared all three function bodies with the
approved source, not mere name presence. Both private implementations are STABLE
DEFINER/jsonb; the public wrapper is STABLE INVOKER/jsonb. Each fixes an empty
search_path; anon/PUBLIC/service-role execution is revoked and authenticated
execution is present. Authenticated SELECT/INSERT/UPDATE/DELETE on chat_messages
remain false. The existing bounded reader's lifecycle correction is present.
The security advisor still reports only leaked-password protection disabled.

No stored-history function was invoked, no customer row or fixture identity was
created/read/deleted, and production/deployment/providers were untouched. This
is VERIFIED_REHEARSAL_SCHEMA_ONLY. Real two-user OAuth/JWT REST, UI integration
and production grants/deployment are distinct, unproven operations. The approval
is fulfilled; it is not approval for another migration or broader processing.
The narrow installed read functions have no data rollback requirement; reverting
their authority correction is not an automatic rollback. A further hosted DDL
repair would need its own exact scope. Existing UI remains on older code.

## Checkpoint Defect And Correction

recover() validates the outer trusted checksum and manifest's complete source
hashes, then writes decoded/reformatted JSON metadata. That changes valid JSON
formatting and Windows line endings despite the verified original archive bytes.
The new fixture uses a trusted compact/CRLF manifest, preserves archive entry
metadata, and fails on the old code while nine existing protections pass.

Recovery now uses archive.read(META) and write_bytes(), exactly as it already
does for source/log entries. Validation and refusal to overwrite destinations
remain unchanged. Ten focused cases pass, including forged trusted-checksum
denial, traversal, duplicate logs, dirty/untracked work and tracked symlink denial.
No source mode, log selection, dependency installation or acceptance is invented.

The previous016 evidence recovery verified100 data receipts but normalized its
metadata separately. Preserve that attempt; redo all entries including manifest
in a NEW recovery. Never alter frozen ZIPs or overwrite the earlier destination.
New complete source/evidence archives, exact paths/hashes/sizes/archive and index
modes plus fresh actual dependency installs/checks are required for this batch.

## Remaining Work

Final016 native image compatibility passed, but its mandatory unsuppressed scan
and summary failed116backend advisory/package matches including1Critical and
7High; frontend0,ignored0. Unused base Pebble and remaining OS/zlib findings need
separate supported remediation and real native/image proof. Scanner counts are
not claims of reachable exploits. No gate/threshold/provenance waiver occurred.

Atomic caller-bound session creation/append/revisions, stale permissions/cache,
lifecycle fencing/legal holds/durable erasure receipts, Qdrant inventory/proof,
all224 normative requirements/ten complete products, rights/budgets/canonical
source-schema-origin and real authorized private workflows remain unfinished.
Continue independent engineering without failed-gate merge or premature release.
