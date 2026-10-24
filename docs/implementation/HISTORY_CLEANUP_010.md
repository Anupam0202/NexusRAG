# Truthful Backend History Cleanup

Application PARTIAL_NOT_COMPLETE. Source-only FastAPI correction; current hosted Cloudflare and provider erasure acceptance are separate.

The old route cleared process-local history first, then caught persistence failures and returned success with a zero durable count. It also attempted to render raw private exceptions. Client batch009 confirmation cannot detect a lying upstream success flag.

Durable deletion must now return a non-negative integer after repository validation. The repository accepts only a list of deleted message records bound to the requested workspace and session; an empty list is a valid zero deletion. Unconfirmed transport replies and foreign-scope records fail rather than produce a count. Local memory clears only after this confirmation. Durable or local exceptions return a static503 without rendering provider detail. Cancellation propagates, preserving local state until durable completion. Success audit occurs only after both steps. No destructive retry was added.

Reproduced12 route failures before correction and7 repository receipt failures before validation. Tests cover durable failure, malformed/false/count receipts, ordering, zero deletes, local failure, cancellation, explicit demo local-only behavior and exact scope. Existing repository fixture now represents actual scoped deleted rows; no old assertion removed.

Limitations: a successful reply is not independent erasure verification or legal-hold/deletion-generation implementation. Durable deletion can succeed before local clearing fails;503 truthfully reports unconfirmed overall completion without undo or automatic retry. Audit durability and private-session owner/participant authorization are separate unfinished controls. FastAPI service-role message read/append/clear and workspace-keyed memory require further authority tracing; no production exposure is inferred from source alone. JWT, roles, RLS, provider gates and hosted resources are unchanged. Full ten-product and224-requirement acceptance remains open.
