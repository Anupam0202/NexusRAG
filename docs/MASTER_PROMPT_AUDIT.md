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
| 3 — Supabase | PARTIAL | 51/51 public tables have RLS, 83 public policies and 3 Storage policies exist, and the clean baseline rehearsal passes. Controlled multi-user live isolation remains pending. |
| 4 — Qdrant | PREVIEW_VERIFIED | Disposable create/index/upsert/tenant-and-version query/delete validation passes. |
| 5 — Gemini | PREVIEW_VERIFIED | Bounded synthetic request passes with thinking disabled and no customer data or paid fallback. |
| 6 — Evidence Workbench UI | PREVIEW_VERIFIED | Evidence OS route builds, deploys, passes smoke validation, and has zero automated WCAG 2 A/AA violations. Authenticated product E2E remains incomplete. |
| 7 — findings/reviews/calculations/monitors | LOCALLY_TESTED | Domain and database contracts exist; complete browser workflow is not verified. |
| 8 — provider registry/rights | LOCALLY_TESTED | Fail-closed registry and rights decisions exist; current rights evidence for enabled recurring sources is incomplete. |
| 9 — terms/quota radar | LOCALLY_TESTED | Review-safe domain behavior exists; recurring monitoring is not deployed end-to-end. |
| 10 — obligation compiler | LOCALLY_TESTED | Review-first obligation model and tests exist; selected-scope end-to-end workflow is incomplete. |
| 11 — procurement graph | PARTIAL | Shared graph schema exists; provider-specific end-to-end product is incomplete. |
| 12 — counterparty graph | PARTIAL | Shared graph and uncertainty contracts exist; end-to-end product is incomplete. |
| 13 — product passport | LOCALLY_TESTED | Deterministic JSON-LD/W3C PROV export and receipt tests pass. |
| 14 — scientific/open-source packs | PARTIAL | Shared evidence foundations exist; both complete product packs are not verified. |
| 15 — Evidence API/MCP | PARTIAL | Authenticated Evidence API routes exist; a complete published capability-enforced MCP surface is not verified. |
| 16 — evaluation/recovery/release | PARTIAL | CI, migration rehearsal, supply-chain evidence, and provider probes pass. Quality metrics, accessibility, browser E2E, restore/canary/rollback, and release gates remain incomplete. |

## Connected-state verification

- GitHub branch: `v6-zero-cost-foundations-clean`; pull request remains draft.
- Vercel and Render deployment files are absent. New commits no longer receive
  the prior Vercel preview check.
- Cloudflare has both the gateway Worker and OpenNext frontend Worker. The
  frontend carries static assets. No custom-domain zone is connected.
- The intended Supabase project contains 51 public tables; all 51 have RLS.
  There are 83 public policies, 3 Storage policies, 8 Auth users, and 7 Storage
  objects. No destructive rebuild was attempted.
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

Not yet verified to the master definition of done:

- desktop/mobile authenticated E2E and visual regression;
- automated accessibility gate on the deployed preview;
- measured Recall@20, citation precision, supported-claim coverage, abstention,
  entity-link, change-alert, and reviewed-obligation thresholds;
- 400 labeled plus 125 held-out evaluated cases (the current job validates
  fixture inventory only);
- controlled multi-user RLS and Storage integration;
- restore, canary, rollback, and deletion rehearsal against deployed preview;
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

**DO NOT MERGE.** The deployment job is red and the master definition of done
has mandatory partial gates. Merge is permitted only after all required checks
for one head commit are green and remaining master requirements are either
implemented and measured or explicitly accepted as blockers without using a
completion claim.