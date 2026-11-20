# Cloudflare Runtime Compatibility Batch008

Application PARTIAL_NOT_COMPLETE. Parent ddecaeb4d90e8f87ff2ee81c60e7fbb246082f20. Runtime regression fix under verification; no deployment, merge or full product acceptance.

## Reproduced Failure

Authenticated Cloudflare metrics showed21 frontend Worker errors while asset4xx/5xx counters were0. A sampled favicon invocation reported Unexpected loadManifest(/.next/server/preview-props.json) call. Clean recovered007 reproduced500 for favicon.ico and an arbitrary missing route; favicon.svg returned200. Added actual-Worker regressions also reproduced500 instead of303 for the dynamic legacy auth verifier's cross-origin rejection. Passing public pre-rendered pages had missed this fallback boundary.

Installed lockfile selected Next16.4.0 through the specification ^16.3.8. OpenNext1.20.9 does not inline Next16.4's new required preview-props manifest. Upstream PR1356 remains OPEN and is absent from released1.20.10, which has unrelated patch changes.

## Scoped Fix

Pin Next exactly16.3.8, the latest published16.3 patch observed from the official npm registry. OpenNext1.20.8 raised its security floor to16.3.8; earlier insecure versions are not selected. Recreate the actual npm lock, including platform SWC integrity entries and npm-materialized optional bundled metadata. Other direct package versions, adapter, authority, RLS, OAuth and routes remain unchanged.

Do not patch node_modules/generated bundles, inline fabricated draft-mode keys, install unreviewed upstream branch code, swallow errors or return404 for genuine outages. The adapter must execute the real SSR fallback and authentication handler. Current package-advisory audit is distinct from the unresolved backend full-image gate.

Actual-Worker tests assert missing favicon/unknown GET and HEAD404 with empty HEAD bodies, existing SVG200, and a cross-origin legacy auth POST303 to a generic callback without forwarding token_hash. They do not consume a real confirmation token, create a session or contact providers. Existing document routing and public keyboard/browser tests remain.

## Fresh Platform Facts

Batch007 final external evidence records the now-authenticated Cloudflare/Supabase/Qdrant audit. Candidate still serves older source, not these commits. Candidate gateway binds rehearsalSupabase/candidateQdrant; the shared preview's visible URL now also rehearsal/candidate despite historical production mapping. It remains shared and non-disposable; secret project correspondence was not read.

Independent Qdrant exact counts legacy17/fourv6 zero and aliases empty are aggregate inventory, not orphan ownership or a bound deletion ID/generation receipt. Candidate workspace/document/version/generation indexes and no candidate snapshots observed; other index/snapshot coverage remains partial. No vectors/customer payloads, credentials or resources were modified.

Supabase040-042 remain unapplied. Organization still uses Vercel Marketplace billing/access management although runtime is Cloudflare. No integration removal, terms acceptance, paid activation or configuration change. Hosted identities/metadata are not OAuth/private workflow acceptance.

## Acceptance And Recovery

Source-save reruns pass319frontend/48files, lint/typecheck, Next/OpenNext25assets,489backend+10subtests,57isolated,79scripts,273gateway, immutable migrations/foundation and npm audit0 known advisories. Actual Worker54desktop/mobile public/routing and12Firefox/WebKit/mobileWebKit routing pass, including both previously failing regressions. Actual Chrome displays the normal404. Broad public cross-browser/recovery/exact-head CI results after source save belong in external receipts, not prospective PASS. No hosted source update.

Before saving: rerun full frontend/lint/typecheck, actual Next/OpenNext build and Worker regressions, unaffected backend/gateway/script contracts and ledger/migration checks. After source export, restore a new complete checkout, verify every hash/size/index mode, install fresh dependencies and rerun relevant frontend/actual Worker checks. Final external receipt binds exact saved source, real locks, archive checksums, CI successes AND failures.

All224 normative requirements and ten products remain accepted. Backend image57High/50Medium matches, full source/schema/runtime rollout, provider rights/budgets, real two-user OAuth/private workflows, erasure generations/legal holds/receipts and production identity/readiness contracts remain unfinished. No gate/protection or closure assertion is weakened.

Primary references checked2026-10-10:
- https://github.com/opennextjs/opennextjs-cloudflare/pull/1356
- https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/%40opennextjs%2Fcloudflare%401.20.8
- https://opennext.js.org/cloudflare

Unpin only after the released adapter supports the required manifest and these real runtime, dependency and image checks freshly pass. Do not freeze an insecure version if new advisories emerge.
