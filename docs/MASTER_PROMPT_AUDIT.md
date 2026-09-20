# V6 master-prompt completion audit

Status: `PARTIAL_NOT_COMPLETE`

Audited against **NEXUSRAG MASTER IMPLEMENTATION PROMPT V6** on
2026-09-20. This report is a merge gate, not a production claim.

## Delivery phases

| Phase | State | Evidence or blocker |
| --- | --- | --- |
| 0 — connected-platform audit | PARTIAL | GitHub, Cloudflare, Supabase, Qdrant, and Gemini were inspected; GitHub environment values cannot be enumerated by the connector and are validated by fail-closed CI instead. |
| 1 — shared foundations | LOCALLY_TESTED | Tenant/version/job/usage/evidence/streaming/deletion contracts and 51-table Supabase schema are present. |
| 2 — Cloudflare preview | PREVIEW_VERIFIED | OpenNext frontend and gateway are deployed; live route and health smoke checks pass. |
| 3 — Supabase | LIVE_STORAGE_ISOLATION_VERIFIED | 51/51 public tables have RLS, 83 public policies and 3 Storage policies exist. A controlled two-identity live rehearsal proved exact-key upload admission, arbitrary-key denial, own-workspace published-object visibility, cross-workspace invisibility, and complete fixture cleanup. Core authority tables remain intentionally service-mediated rather than browser-readable. |
| 4 — Qdrant | PREVIEW_VERIFIED | Disposable create/index/upsert/tenant-and-version query/delete validation passes. |
| 5 — Gemini | PREVIEW_VERIFIED | Bounded synthetic request passes with thinking disabled and no customer data or paid fallback. |
| 6 — Evidence Workbench UI | PREVIEW_VERIFIED | Evidence OS route builds, deploys, passes smoke validation, and has zero automated WCAG 2 A/AA violations. Authenticated product E2E remains incomplete. |
| 7 — findings/reviews/calculations/monitors | LOCALLY_TESTED | Domain and database contracts exist; complete browser workflow is not verified. |
| 8 — provider registry/rights | REVIEWED_FAIL_CLOSED | Current official evidence, conservative client caps, duties, review dates, and evidence URLs are recorded. Zero recurring public providers are enabled; uncertain sources remain `LEGAL_REVIEW` or `REVIEW_REQUIRED`. |
| 9 — terms/quota radar | LOCALLY_TESTED | Review-safe domain behavior exists; recurring monitoring is not deployed end-to-end. |
| 10 — obligation compiler | LOCALLY_TESTED | Review-first obligation model and tests exist; selected-scope end-to-end workflow is incomplete. |
| 11 — procurement graph | PARTIAL | Shared graph schema exists; provider-specific end-to-end product is incomplete. |
| 12 — counterparty graph | PARTIAL | Shared graph and uncertainty contracts exist; end-to-end product is incomplete. |
| 13 — product passport | LOCALLY_TESTED | Deterministic JSON-LD/W3C PROV export and receipt tests pass. |
| 14 — scientific/open-source packs | PARTIAL | Shared evidence foundations exist; both complete product packs are not verified. |
| 15 — Evidence API/MCP | PARTIAL | Authenticated Evidence API routes exist; a complete published capability-enforced MCP surface is not verified. |
| 16 — evaluation/recovery/release | PARTIAL | CI, migration rehearsal, supply-chain evidence, provider probes, fixed synthetic quality scoring, deployed accessibility scans, public desktop/mobile browser E2E, and committed visual baselines pass. Authenticated product E2E remains incomplete; live canary, rollback, and restore have passed on Preview. |

## Connected-state verification

- GitHub branch: `v6-zero-cost-foundations-clean`; pull request remains draft.
- Vercel and Render deployment files are absent. New commits no longer receive
  the prior Vercel preview check.
- Cloudflare has both the gateway Worker and OpenNext frontend Worker. The
  frontend carries static assets. No custom-domain zone is connected. The
  empty permission-check D1 database was removed after an identity and
  zero-table safety check; D1, KV, R2, and Vectorize now hold no application
  state.
- The intended Supabase project contains 51 public tables; all 51 have RLS.
  There are 83 public policies and 3 Storage policies. Controlled E2E fixtures
  used two synthetic identities and two isolated workspaces, then verified
  zero remaining fixture users, workspaces, and Storage rows. No destructive
  rebuild was attempted.
- Supabase security advisor has one accepted warning: leaked-password
  protection remains disabled by explicit operator decision.
- Supabase performance advisor reports unused indexes. This is expected for a
  low-traffic schema and is not sufficient evidence to remove security,
  lifecycle, or query-path indexes.

## Required CI and supply-chain gates

Verified on the feature branch:

- migration integrity and clean local Supabase rehearsal;
- isolated backend regression suite;
- 79 frontend unit tests, lint, typecheck, Next production build, and OpenNext
  bundle;
- Cloudflare compatibility contracts;
- bounded Qdrant and Gemini live validation;
- dependency audit;
- CycloneDX SBOM and licence inventory.
- fixed scoring of all 525 synthetic contract cases, including the committed
  thresholds for retrieval, citations, claim support, abstention, entity
  precision, change alerts, reviewed obligations, calculations, and tenant
  isolation;
- public desktop/mobile Playwright coverage and deployed WCAG 2 A/AA scans.

Not yet verified to the master definition of done:

- authenticated product E2E;
- provider-backed quality scoring beyond the deterministic synthetic contract
  dataset; the 400 labeled and 125 held-out fixtures pass fixed synthetic gates
  but do not establish production retrieval or model quality;
- service-mediated API isolation with real signed-in sessions; direct Storage
  RLS isolation has been live-rehearsed with two controlled identities;
- full application-level workspace deletion and authority restore with real authenticated sessions; Cloudflare canary/rollback/restore and controlled fixture deletion have passed;
- complete `R01–R32`, `CF01–CF32`, `A01–A32`, `S01–S32`, `G01–G32`,
  `P01–P32`, and `Z01–Z32` traceability. The supplied V6 prompt defines the
  `Z` entries but does not include the source definitions for the other legacy
  registers.

## Current Preview environment

The credential preflight confirms that `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` are available. Cloudflare Worker origins are derived
from the account at deployment time. These browser-safe GitHub `Preview`
environment variables are configured:

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Canonical placement and ownership are documented in
`docs/GITHUB_ENVIRONMENTS.md`.

## Merge decision

**DO NOT MERGE.** All current-head GitHub checks are green, but the master
definition of done still has mandatory partial gates. Merge is permitted only
after the remaining requirements are implemented and measured or explicitly
accepted as blockers without using a completion claim.