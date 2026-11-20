# Cleanup Client Receipt Boundary: Batch009

Application PARTIAL_NOT_COMPLETE. This source-only fix does not establish actual provider erasure or authorize destructive operations.

## Reproduction And Fix

The API client trusted any HTTP2xx JSON for document deletion, session clearing, workspace erasure and retention. A false/missing/malformed body could therefore resolve normally, permitting best-effort success counts, local-history removal or workspace-context clearing. Session clearing also omitted the ID encoding used by message reads. Retention UI wrote its own clock as last completion rather than loading the durable authority timestamp.

Actual client transport/component tests reproduce27 failed assertions before the change. Explicit true success is now required for document deletion/history clearing. Workspace and retention lifecycle replies require the expected workspace_deleted boolean, empty failures, and non-negative safe-integer cleanup counts. Errors expose only an actionable CLEANUP_UNCONFIRMED message; raw response details are not surfaced. No mutation is automatically retried. Existing actor/workspace header fences and server authorization remain intact.

The session identifier is encoded as one path segment. Retention refreshes the exact actor/workspace inventory and privacy settings after successful completion. Only last_retention_at from the durable settings response is displayed; missing/failed refresh does not invent a timestamp or show a success toast.

37focused tests PASS: false/null/absent/string success, invalid lifecycle/counts/partial failures, generic errors, best-effort counting, encoded IDs, actor/workspace binding, no automatic retry, durable timestamp, refresh failure, retained local history and workspace context. These synthetic tests are not live destructive-flow acceptance. Both backend lifecycle and bounded Worker supported/unsupported behavior remain authoritative.

## Verification And Scope

Run full frontend Vitest, lint, TypeScript, Next/OpenNext, gateway/regression/script integrity and ledger checks. Export complete committed source/real locks, verify every restored file/mode, reinstall frontend dependencies and reexecute relevant checks in a new recovery directory. Exact-head image checks remain mandatory even though this batch has no backend/image dependency change. Later actual results belong in the external batch handoff, not prospective PASS entries here.

Owner-requested GitHub consolidation preserves all47predecessor commits in the existing candidate PR12 against main. Closed PR8-11 are superseded, not merged. Do not create another remote branch/PR for this batch. Preserve main protections, release-triggered provider boundary, immutable checkpoint tags and source archives. No fresh main-base CI was returned just by retargeting; subsequent head requires exact head/base evidence.

All224 normative definitions and ten products remain accepted. No hosted migration/deployment, real OAuth/provider processing, customer deletion, paid activation or security/secret/DNS/billing change. HTTP response validation is not an independent Qdrant/Storage/database erasure proof. Outstanding legal holds, generation fencing, durable erasure receipts, hosted rollout and complete product acceptance remain open.
