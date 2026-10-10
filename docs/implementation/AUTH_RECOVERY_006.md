# Authentication Recovery Batch006

Status: LOCALLY_TESTED; complete application PARTIAL_NOT_COMPLETE. Source parent7a5661eeaaefff23866a021e3e5433edba4f40ea; final exact commit/tree is bound by the exported checkpoint manifest and external receipt. Nothing here asserts deployment or real OAuth acceptance.

## Root Causes And Scope

The selected-workspace layout guard incorrectly intercepted account security and the workspace invitation-acceptance page. Users could not reach their own session controls or join their first workspace through those pages. The callback independently required workspace discovery for every destination and did not bound session/discovery waits. Its recovery link discarded the requested destination.

Separately, WHATWG URL normalization converted /documents/..//attacker.invalid into //attacker.invalid. Returning that pathname to window.location.replace allowed an off-origin redirect for an authenticated login/callback. The sanitizer now validates normalized paths, up to five decoding steps, malformed encoding, backslashes/control characters and the fallback. Query/hash values remain encoded rather than recursively interpreted as destinations. Browser sessions, credentials and tokens were not used to reproduce this issue.

Shared exact route classification is used by the layout and callback. /settings/security and /workspaces retain their own authentication/actor checks but do not require a previously selected workspace. Nested workspace routes and all private tenant data remain guarded; server authorization is unchanged. /onboarding handles its own discovery and creation. A timeout stops this callback's publication, not the SDK's underlying network operation or independent Auth state synchronization.

## Coverage Matrix

| Workflow / relevant accepted IDs | UI / authority / failure path | Evidence and remaining boundary |
| --- | --- | --- |
| Account security without workspace; A05,A06,A25 | WorkspaceDiscoveryBoundary -> /settings/security -> Supabase Auth identity/session scope | Component tests for loading/missing/error discovery. Existing security tests remain. Real OAuth/private browser acceptance pending. |
| Invitation and workspace bootstrap; A07,A09,A11,R03,R04 | /workspaces -> recipient-bound acceptance/unbound actor context -> service-authorized RPC | Component boundary regressions and unchanged269 gateway cases. Hosted040 absent; live acceptance pending. |
| Callback destinations; A04,A05,A25,S19,G11 | Scrub URL -> bounded SDK session -> shared workspace decision -> safe navigation | Safe account/onboarding routes, unsafe target, authenticated login/callback regressions. Real provider sessions pending. |
| Stalled session/discovery; A25,S19,R32 | Existing15-second deadline -> safe error/recovery -> ignore late callback results | Fake-clock deferred-promise tests assert no late workspace/navigation and cleared timers. Not proof of network cancellation. |
| Discovery failure; A07,R32 | Unavailable membership is not WORKSPACE_NOT_FOUND | Existing outage/onboarding/unmount regressions retained. No invented workspace creation. |
| Redirect security; A04,G11,S10 | Untrusted next/fallback -> normalization/decoding validation -> same-origin path |29 policy cases plus signed-in login/callback and public browser recovery cases. No provider error/code leakage. |
| Accessibility/responsive; A28,A29,S26-S30 | Error alert, progress status, focusable recovery link | Public desktop/emulated-mobile smoke and direct Chrome inspection. Physical/assistive technology and private flows not established. |

## Actual Commands And Check Boundaries

From frontend: npm ci --ignore-scripts; npm test; npm run lint; npm exec tsc -- --noEmit; npm run build; npm run cf:build. Final lint/typecheck and317 frontend tests pass, as does the rebuilt OpenNext artifact. Build settings are synthetic public Supabase configuration and a localhost API, never production credentials. The repository has no typecheck npm script; the mistaken invocation failed and was corrected without changing package.json.

Focused tests: npm test -- src/lib/auth-redirect.test.ts src/app/auth/login/page.test.tsx src/app/auth/callback/page.test.tsx src/components/auth/WorkspaceDiscoveryBoundary.test.tsx src/lib/workspace-discovery.test.ts.

Public browser: npm exec playwright -- test public-smoke.spec.ts --workers=2 against local Next port3002 passed46 desktop/emulated-mobile checks. Combined public-smoke/worker-routing against local Wrangler port3003 passed50. Cross-browser uses playwright.cross-browser.config.ts. Original visual tests failed all4 because approved Windows baselines do not exist; generated actuals are retained separately, not blessed. Existing Linux baselines and thresholds remain unchanged. Final external logs record which commands actually passed or failed after this source save.

Fresh backend: new Python3.12 environment installed from unchanged backend/requirements-test.txt, then backend/scripts/run_full_tests.py and backend/scripts/run_isolated.py from the documented directories. Scripts/gateway/foundation/migration checks are independently rerun. A synthetic test suite is not managed Supabase/Storage/provider acceptance.

## Environment And Remaining Scope

Fresh GitHub identity/repository and current PR9/main match the supplied handoff. Both Supabase projects are accessible/healthy; rehearsal catalog lacks finish_retention_claim and claim_workspace_retention. Public candidate still advertises older frontend2fbc5c9/gateway46bb14f source. Private Cloudflare management/Qdrant access and two approved OAuth identities are not supplied by an anonymous Chrome session.

The September21 report is retained as historical evidence. Cloudflare/Supabase/Qdrant/Gemini remain the active design; Vercel/Render/Railway are not reintroduced. Keycloak is not referenced in current source; that does not certify unrelated external account cleanup.

Image clearance, hosted source/schema parity, complete private ingestion/grounding/deletion, lifecycle generations/legal holds/receipts, ten products and rights-approved quality acceptance remain open. All224 definitions are unchanged. No platform deletion, migration, deployment or live provider processing is authorized by this document. Preserve protected branches, quarantined recovery resources and prior checkpoints.
