# NexusRAG V6 implementation report

Status: `PARTIAL_NOT_COMPLETE`

This report deliberately does not use “complete.” Live Qdrant, Gemini, Cloudflare frontend parity, provider-rights approval, cross-tenant integration tests, accessibility E2E, recovery rehearsal, and all requirement-register gates remain open.

## Delivered in this increment

- Evidence-quality contracts for `SUPPORTED`, `PARTIALLY_SUPPORTED`, `CONTRADICTED`, `INFERRED`, `UNSUPPORTED`, `STALE`, and `SOURCE_UNAVAILABLE`.
- Deterministic decimal calculations with unit checks, formulas, precision, and evidence lineage.
- Review-first regulatory obligations with authority, jurisdiction, actor, action, temporal validity, locators, reviewers, and lifecycle states.
- Software Product Evidence Passport JSON-LD export with W3C PROV links and deterministic SHA-256 receipts.
- Fail-closed zero-cost provider registry starter. Every public connector remains `LEGAL_REVIEW` until terms, attribution, quotas, and allowed operations are evidenced.
- Evidence Intelligence OS product surface and Setup Center with explicit readiness states.
- Offline regression coverage for claim status, contradictions, calculations, obligations, and passport exports.
- Authenticated Evidence OS APIs for capability discovery, claim assessment, calculations, obligation review, and Product Passport export.
- Bounded live-provider validation that uses one synthetic Gemini request and a disposable, automatically deleted Qdrant collection.

## Verified connected state

- GitHub `main` remained at `d964fb88bb6fd936fff72d930805c71f3b229a73` at audit time.
- Active implementation branch: `v6-zero-cost-foundations-clean`.
- The connected Supabase MCP targets the previously observed NexusRAG schema; its protected project identifier is intentionally not committed.
- The connected Supabase schema contains the V6 shared evidence, rights, graph, monitor, budget, export, and deletion foundations with RLS enabled on reviewed public tables.
- The connected project is not empty (Auth users and private Storage objects exist), so no destructive rebuild was attempted.
- Supabase security advisor reports leaked-password protection disabled; this remains an operator action.
- Cloudflare has one V6 preview gateway Worker and no Pages project, KV namespace, Queue, Workflow, AI Gateway, or zone. R2 is not enabled. One empty permission-check D1 database exists.
- Cloudflare’s Qdrant secret bindings passed a disposable live create/index/upsert/query/delete probe. The probe exposed and fixed use of Qdrant’s retired search endpoint and added explicit workspace, version, and index-generation payload indexes.
- Cloudflare recognizes the Gemini binding, but the bounded synthetic Gemini request returned HTTP 403. No customer data was sent and no paid fallback was attempted.

## Safety properties

- Unknown quota means `REVIEW_REQUIRED`.
- Unknown or review-pending rights never become allowed by default.
- Calculations do not rely on generated prose.
- Contradictory evidence cannot be labeled supported.
- Approved obligations require a human reviewer.
- Verified/public/contradicted passport claims require evidence.
- Provider registry has no hidden paid fallback.

## Exact blockers

1. The Cloudflare `GOOGLE_API_KEY` binding returns HTTP 403 from the Gemini Generative Language API and must be replaced or have the API/model permission enabled.
2. Public-provider terms and quota evidence requires current source review before enabling recurring acquisition.
3. Cloudflare frontend upload, canary, rollback, DNS, and parity gates are not yet all verified.
4. Full RLS and Storage multi-user integration tests require disposable authenticated users and a controlled cleanup rehearsal.
5. Supabase leaked-password protection remains disabled by explicit operator decision.
6. All `R`, `CF`, `A`, `S`, `G`, `P`, and `Z` register items have not yet passed.

## Rollback

The implementation is isolated to the feature branch. Rollback is a branch reset/revert. No destructive Supabase migration, DNS cutover, paid usage, Qdrant mutation, or Gemini production call is part of this increment.