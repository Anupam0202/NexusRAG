# UI And Actor Contract Batch007

Status: LOCALLY_TESTED, application PARTIAL_NOT_COMPLETE. Parent2b1d48b63ffbfa38cacef4471bacd567e11aee28. Final exported manifest binds saved source; CI/recovery after source save are external receipts, not prospective passes.

## User Observation And Root Cause

The existing signed-in Chrome candidate displays a workspace and both connected OAuth identities. Document read inventory loads, but edit permissions cannot be verified. The local frontend requires workspace_id, role AND user_id to match the originating session before dispatching any document mutation. Gateway /api/v1/workspaces/current validated authentication/membership but returned only workspace/role, so even owners fail that client fence.

Gateway now appends user_id:user.id from the verified Supabase actor after the workspace record spread. Client headers or unexpected foreign upstream fields cannot choose it. Both bound and default discovery preserve active-workspace/membership controls. Four role cases plus default discovery reproduced five failures before the one-line fix; all273 gateway regressions pass. A frontend regression rejects the legacy missing-actor response without losing read access. No server/client authorization checks were removed. No schema migration required for this response field.

## Focus And Recovery Fixtures

Batch006 fresh mobileWebKit tests found native Tab escaping the navigation modal. Explicit cycling of every ordinary Tab/Shift-Tab avoids Safari link-skipping preferences; modifier combinations remain native. Escape, restored focus/inert/scroll state and resizing/unmount cleanup remain. Full-cycle unit test and unchanged mobileWebKit browser assertions pass in Next and local Worker.

Fresh checkpoint recovery also found ledger tests assuming the first entry was R01. Defect entries legally precede normative entries. Select R01 by identity, prove reordered omission rejection, and retain the original tampering/no-closure assertions. UTF8 Docker fixture read works under Windows default encoding. Lint config loading now has bounded120s setup rather than consuming the5s assertion budget; no exclusions/rules were weakened.

## Fresh Evidence And Limits

-319frontend tests/48files, lint, tsc --noEmit PASS.
-489backend+10subtests,57isolated,79scripts,273gateway/0skips, migration/foundation PASS with synthetic/offline transports.
- Next/OpenNext built25assets; public46Next/50Worker Chromium desktop/emulated-mobile PASS. Two mobileWebKit keyboard tests PASS on each runtime.
- Broad cross-Next reached69passing assertions but hung in Windows teardown; stopped with exit1 and recorded INCOMPLETE, not PASS. No skipped assertions or shortened teardown accepted as success. Exact-head Linux browser CI still required.
- Win32 visual baselines absent; original Linux baselines/thresholds unchanged. User Chrome read-only observation is not fresh Google/GitHub login, sign-out, second-user isolation, upload or deletion verification.
- Hosted frontend2fbc5c9/gateway46bb14f differ from saved source. Supabase catalogs still lack claim/completion RPCs. Chrome management access Cloudflare signed out; private Qdrant inventory missing. Do not label old public health/read-only UI as source deployment acceptance.
- Parent PR10 mandatory image CI FAILED57High/50Medium backend matches; no suppression, supported-runtime downgrade/upgrade guess, threshold or protection bypass. Source-response and focus fixes do not clear this gate.
- Production workflow RELEASE_SHA/SOURCE_COMMIT and READY/CONFIGURED acceptance mismatch remains separately recorded OPEN_ENGINEERING. Provider rights, zero-cost budgets, legal holds/erasure generations, all224 accepted requirements and ten products remain open where not evidenced. Vercel/Render/Railway not restored; Keycloak not introduced.

## Reproducible Commands

From repository: npm run test:cloudflare; python -m unittest discover -s tests/scripts; python scripts/verify_v6_migrations.py; python scripts/verify_cloudflare_foundation.py; python scripts/check_execution_ledger.py. Backend documented full/isolated runners use the real test specification and offline guard. From frontend: npm test, npm run lint, npx tsc --noEmit, npm run cf:build. Public browser suites explicitly target Next or local Wrangler; do not confuse mocked APIs with providers.

After each source export restore only into a new directory, compare all file hashes/sizes/index modes, install fresh dependencies, rerun relevant checks and preserve failures. Sanitized test receipts exclude private browser sessions, provider tokens, server query logs, customer content, local virtualenvs/caches and .git. No merge/deployment/hosted mutation/destructive cleanup occurred. Final external handoff records exact source/checksums and later results truthfully.
