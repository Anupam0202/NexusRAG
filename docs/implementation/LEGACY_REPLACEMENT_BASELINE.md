# Owner-directed legacy replacement baseline

Status: `OWNER_DIRECTED_REPLACEMENT_BASELINE`

The original normative definitions for `R01–R32`, `CF01–CF32`, and `A01–A32` were not present in the supplied prompt or repository history. On 2026-09-21 the accountable owner directed implementation using the best understanding of the application. The definitions below therefore replace the missing legacy text for this repository; they do not claim to reproduce an unavailable historical document.

## R register

| ID | Replacement requirement | State | Primary evidence |
| --- | --- | --- | --- |
| R01 | Tenant identity is explicit on every authority record | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R02 | Authentication is required for private operations | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R03 | Workspace membership gates every private operation | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R04 | Roles map to least-privilege capabilities | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R05 | Cross-workspace identifiers never widen access | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R06 | Customer originals remain private | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R07 | Document versions are immutable and fenced | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R08 | Active versions are explicit | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R09 | Lifecycle epochs prevent stale publication | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R10 | Jobs are leased and bounded | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R11 | Retries are idempotent and capped | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R12 | Cancellation is durable | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R13 | Audit events preserve actor and action | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R14 | Private responses are never cached | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R15 | Secrets are never returned to clients | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R16 | Logs redact sensitive values | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R17 | Uploads use server-allocated object keys | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R18 | Upload media and archive limits are enforced | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R19 | Retrieval is workspace filtered | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R20 | Retrieval is version filtered | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R21 | Vector generations are fenced | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R22 | Citations preserve evidence locators | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R23 | Unsupported claims abstain | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R24 | Contradictions remain visible | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R25 | Human review gates consequential outputs | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R26 | Provider rights fail closed | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R27 | Provider quotas fail closed | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R28 | Usage is reserved before metered work | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R29 | Deletion is service mediated and receipted | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R30 | Recovery preserves Supabase authority | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R31 | Exports remain bounded and attributable | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |
| R32 | Readiness claims match measured state | `LOCALLY_TESTED` | `supabase/baseline/001_v6_zero_cost_baseline.sql; backend/tests/regressions; docs/implementation/RECOVERY_REHEARSAL.md` |

## CF register

| ID | Replacement requirement | State | Primary evidence |
| --- | --- | --- | --- |
| CF01 | Workers.dev Preview is the canonical preview origin | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF02 | Frontend uses OpenNext Workers Static Assets | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF03 | Gateway and frontend have explicit compatibility dates | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF04 | Gateway rejects binding or configuration drift | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF05 | Private API responses use no-store | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF06 | Security headers are emitted on every response | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF07 | CORS allows only the configured frontend origin | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF08 | Unauthenticated private requests fail closed | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF09 | Supabase JWTs are verified by Supabase Auth | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF10 | Workspace membership is checked server side | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF11 | Capability scopes derive from workspace role | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF12 | Result limits are server bounded | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF13 | Deadlines bound upstream requests | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF14 | Per-user preview rate limiting is enforced | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF15 | Mutations require idempotency where applicable | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF16 | Service credentials remain Worker secrets | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF17 | Supabase remains business authority | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF18 | Qdrant remains reconstructible retrieval state | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF19 | Gemini receives only bounded synthetic/live requests | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF20 | No hidden paid fallback exists | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF21 | Unknown quota produces a typed state | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF22 | HTTP 429 remains retryable and explicit | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF23 | Provider failures use safe public errors | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF24 | Cloudflare coordination is non-authoritative | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF25 | Preview deployment is protected by GitHub Environment | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF26 | Live smoke probes gate deployment | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF27 | Desktop and mobile browser tests gate deployment | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF28 | Accessibility scans gate deployment | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF29 | Visual baselines gate deployment | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF30 | Canary promotion and rollback are rehearsed | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF31 | Custom DNS is not required for Preview verification | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |
| CF32 | Production is not claimed from a workers.dev preview | `LOCALLY_TESTED` | `apps/gateway/src/preview-worker.js; tests/cloudflare; .github/workflows/cloudflare-preview-deploy.yml` |

## A register

| ID | Replacement requirement | State | Primary evidence |
| --- | --- | --- | --- |
| A01 | GitHub and Google OAuth are the enabled sign-in methods | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A02 | Email/password authentication is disabled | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A03 | Supabase Site URL targets the Cloudflare preview | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A04 | OAuth callback targets the Cloudflare preview | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A05 | Signed-out users receive an authentication boundary | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A06 | Signed-in identity is visible in the application shell | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A07 | Initial workspace onboarding is available | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A08 | Workspace creation is idempotent | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A09 | Workspace selection is stored client-side | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A10 | API requests carry the Supabase access token | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A11 | API requests carry the workspace binding | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A12 | Evidence capabilities are discoverable after authentication | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A13 | Evidence search is bounded | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A14 | Claim retrieval is bounded | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A15 | Citation retrieval is bounded | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A16 | Entity lookup is bounded | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A17 | Relationship lookup is bounded | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A18 | Obligation lookup is capability scoped | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A19 | Procurement lookup is capability scoped | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A20 | Passport retrieval is capability scoped | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A21 | Finding retrieval is capability scoped | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A22 | Monitor status is capability scoped | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A23 | Every private read writes a best-effort audit event | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A24 | Cross-origin requests use exact-origin CORS | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A25 | Expired tokens fail with AUTH_REQUIRED | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A26 | Missing workspace bindings fail safely | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A27 | Unknown routes fail safely | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A28 | The UI reflows without horizontal overflow | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A29 | Keyboard focus remains visible | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A30 | Reduced motion preserves content | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A31 | Automated WCAG 2 A/AA checks pass | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |
| A32 | Authenticated preview status is reported separately from production | `LOCALLY_TESTED` | `frontend/src; frontend/src/e2e; apps/gateway/src/preview-worker.js` |

## Acceptance boundary

- These registers are accepted for Preview verification only.
- Production verification still requires production DNS, representative production evaluation data, and production operations approval.
- Any recovered original register text supersedes this replacement only after a reviewed gap analysis.
