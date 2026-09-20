# NexusRAG V6 implementation report

Status: `PREVIEW_VERIFIED`

Preview foundations, live providers, the Cloudflare frontend and gateway, and
the Supabase rehearsal are verified. The deployment workflow derives standard
Worker origins, builds and uploads OpenNext, then smoke-tests the live routes.

## Delivered in this increment

- Evidence-quality contracts for `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONTRADICTED`, `INFERRED`, `UNSUPPORTED`, `STALE`, and `SOURCE_UNAVAILABLE`.
- Deterministic decimal calculations with unit checks, formulas, precision, and evidence lineage.
- Review-first regulatory obligations with authority, jurisdiction, actor, action, temporal validity, locators, reviewers, and lifecycle states.
- Software Product Evidence Passport JSON-LD export with W3C PROV links and deterministic SHA-256 receipts.
- Fail-closed zero-cost provider registry starter. Every public connector remains `LEGAL_REVIEW` until terms, attribution, quotas, and allowed operations are evidenced.
- Evidence Intelligence OS product surface and Setup Center with explicit readiness states.
- Offline regression coverage for claim status, contradictions, calculations, obligations, and passport exports.
- Authenticated Evidence OS APIs for capability discovery, claim assessment, calculations, obligation review, and Product Passport export.
- Bounded research-planning, procurement, counterparty, science, open-source,
  public-risk, MCP capability, setup, standards, observability, AI-safety, and
  recovery contracts with isolated regression coverage.
- Fixed synthetic quality scoring for 400 labeled and 125 held-out cases. The
  scorer enforces thresholds without making a production-quality claim.
- Bounded live-provider validation that uses one synthetic Gemini request and a disposable, automatically deleted Qdrant collection.
- OpenNext Cloudflare frontend packaging and protected Preview deployment workflow.
- Removal of active Vercel and Render deployment blueprints.

## Verified connected state

- GitHub `main` remained at `d964fb88bb6fd936fff72d930805c71f3b229a73` at audit time.
- Active implementation branch: `v6-zero-cost-foundations-clean`.
- The connected Supabase MCP targets the previously observed NexusRAG schema; its protected project identifier is intentionally not committed.
- The connected Supabase schema contains the V6 shared evidence, rights, graph, monitor, budget, export, and deletion foundations with RLS enabled on reviewed public tables.
- The connected project is not empty (Auth users and private Storage objects exist), so no destructive rebuild was attempted.
- Email/password authentication is disabled; GitHub and Google OAuth remain enabled. The owner excluded the inactive-path leaked-password warning from the current Preview gate.
- Cloudflare has one V6 preview gateway Worker and one OpenNext frontend
  Worker, with no Pages project, KV namespace, Queue, Workflow, AI Gateway,
  Vectorize index, D1 database, custom domain, or zone. R2 is not enabled. The
  empty permission-check D1 database was safety-checked and deleted.
- Cloudflare’s Qdrant secret bindings passed a disposable live create/index/upsert/query/delete probe. The probe exposed and fixed use of Qdrant’s retired search endpoint and added explicit workspace, version, and index-generation payload indexes.
- Cloudflare and GitHub Preview Gemini bindings pass bounded synthetic validation with thinking disabled, no customer data, and no paid fallback.
- The Next.js application passes lint, unit tests, typecheck, production build, and OpenNext Cloudflare bundle generation.
- The live Cloudflare frontend passes homepage, Evidence OS, and gateway-health smoke checks. Live GitHub OAuth, workspace listing/selection, owner capability discovery, bounded Evidence API reads, and cross-workspace denial pass through the authenticated Cloudflare gateway. GitHub `main` is protected by pull requests, five required
  checks, an up-to-date branch requirement, conversation resolution, linear
  history, the `Preview` deployment gate, and no administrator bypass.
- WCAG 2 A/AA scans report zero violations on the deployed Chat and Evidence OS
  routes after contrast, zoom, and keyboard-scroll fixes.
- A controlled live Supabase rehearsal used two synthetic identities and two
  workspaces. Exact allocated Storage writes passed, arbitrary-path writes were
  denied by RLS, the owning workspace could read the published object, the
  other workspace saw zero rows, and all fixtures were removed.

## Safety properties

- Unknown quota means `REVIEW_REQUIRED`.
- Unknown or review-pending rights never become allowed by default.
- Calculations do not rely on generated prose.
- Contradictory evidence cannot be labeled supported.
- Approved obligations require a human reviewer.
- Verified/public/contradicted passport claims require evidence.
- Provider registry has no hidden paid fallback.

## Exact blockers

1. Public-provider terms and quota evidence requires current source review before enabling recurring acquisition.
2. No custom-domain DNS cutover is possible until a Cloudflare zone is connected.
3. Full document ingestion, generated-answer chat, and two-real-OAuth-user browser E2E still require the Python processing runtime or equivalent Worker implementation. The authenticated Evidence API/MCP read surface is deployed and live-verified.
4. The unavailable historical `R`, `CF`, and `A` wording was replaced by an owner-directed Preview baseline; recovered originals would require a reviewed gap analysis.
5. No Cloudflare zone exists. Workers.dev is the approved Preview origin; a custom domain remains a Production-only action.

## Rollback

The implementation is isolated to the feature branch and Cloudflare Preview workers. Rollback is a branch revert and Worker deployment rollback. No destructive Supabase migration, DNS cutover, paid usage, retained probe collection, retained D1 database, or retained E2E fixture is part of this increment.