# Requirement traceability

Status: `DEFINED_AND_LOCALLY_TESTED_WITH_LEGACY_SOURCE_BLOCKERS`

The supplied V6 prompt defines `Z01–Z32` and instructs the project to add `S`, `G`, and `P`. This file defines those three new families and maps them to implementation evidence. The prompt asks to preserve `R`, `CF`, and `A`, but does not provide their normative definitions; those 96 legacy entries remain `BLOCKED_SOURCE_DEFINITION_MISSING` rather than being invented.

## S register

| ID | Requirement | State | Primary evidence |
| --- | --- | --- | --- |
| S01 | Use stable public identifiers | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S02 | Use versioned evidence identifiers | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S03 | Preserve source locators | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S04 | Preserve source timestamps | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S05 | Preserve content hashes | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S06 | Support JSON-LD export | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S07 | Support W3C PROV links | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S08 | Use ISO-8601 timestamps | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S09 | Use UTC for durable accounting | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S10 | Use standard HTTP status codes | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S11 | Honor Retry-After | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S12 | Support cursor pagination | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S13 | Support conditional HTTP | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S14 | Preserve MIME types | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S15 | Use SPDX-compatible licence identifiers | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S16 | Produce CycloneDX SBOM | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S17 | Use documented API schemas | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S18 | Keep schemas versioned | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S19 | Use typed failure states | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S20 | Support deterministic exports | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S21 | Separate authority from caches | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S22 | Keep reconstructible indexes portable | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S23 | Keep provider adapters replaceable | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S24 | Expose capability discovery | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S25 | Fence MCP operations by capability | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S26 | Use accessible semantic HTML | `PREVIEW_VERIFIED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S27 | Meet WCAG 2 A/AA automated gates | `PREVIEW_VERIFIED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S28 | Support reduced motion | `PREVIEW_VERIFIED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S29 | Support keyboard navigation | `PREVIEW_VERIFIED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S30 | Support responsive desktop/mobile layouts | `PREVIEW_VERIFIED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S31 | Document migration paths | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |
| S32 | Document interoperability limits | `LOCALLY_TESTED` | `docs/ARCHITECTURE.md; backend/src/domain/standards_mapping.py; frontend/src/e2e/public-smoke.spec.ts` |

## G register

| ID | Requirement | State | Primary evidence |
| --- | --- | --- | --- |
| G01 | Fail closed on unknown rights | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G02 | Fail closed on unknown quota | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G03 | Require human review for consequential obligations | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G04 | Require review for uncertain entity links | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G05 | Preserve contradictory evidence | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G06 | Label inference separately from evidence | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G07 | Block untrusted content from authorizing tools | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G08 | Treat retrieved instructions as data | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G09 | Redact secrets from logs | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G10 | Redact private query attributes | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G11 | Enforce workspace authorization | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G12 | Fence versions and lifecycle epochs | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G13 | Enforce least-privilege capabilities | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G14 | Keep provider credentials server-side | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G15 | Keep originals in private storage | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G16 | Record immutable audit evidence | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G17 | Record provider and policy revisions | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G18 | Record reviewer identity and time | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G19 | Support retention and deletion | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G20 | Preserve deletion receipts | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G21 | Keep export available near capacity | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G22 | Keep deletion available near capacity | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G23 | No hidden paid fallback | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G24 | No free-tier SLA claim | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G25 | Bound automated work | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G26 | Prioritize user-triggered work | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G27 | Support cancellation and resume | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G28 | Detect stale workers | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G29 | Require idempotency keys | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G30 | Make recovery decisions explicit | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G31 | Publish honest readiness states | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |
| G32 | Document residual risk | `LOCALLY_TESTED` | `backend/src/domain/ai_safety.py; backend/src/domain/observability_contract.py; supabase/baseline/001_v6_zero_cost_baseline.sql` |

## P register

| ID | Requirement | State | Primary evidence |
| --- | --- | --- | --- |
| P01 | Claims carry evidence | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P02 | Claims carry confidence | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P03 | Claims carry review status | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P04 | Unsupported claims abstain | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P05 | Contradictions remain visible | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P06 | Calculations are deterministic | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P07 | Calculations preserve units | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P08 | Calculations preserve formulas | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P09 | Obligations preserve authority | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P10 | Obligations preserve jurisdiction | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P11 | Obligations preserve actor/action | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P12 | Obligations preserve temporal validity | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P13 | Approved obligations require reviewers | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P14 | Procurement records preserve source identity | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P15 | Procurement normalization is selective | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P16 | Counterparty matches expose uncertainty | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P17 | Adverse matches require review | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P18 | Passport exports use JSON-LD | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P19 | Passport exports use PROV links | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P20 | Passport exports have deterministic receipts | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P21 | Scientific evidence preserves study identity | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P22 | Scientific evidence preserves version | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P23 | Open-source findings preserve advisory identity | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P24 | Open-source findings preserve licence | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P25 | Public-risk alerts preserve source time | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P26 | Monitors distinguish unchanged/changed/failed | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P27 | Terms changes require review | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P28 | Evidence API requires workspace scope | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P29 | MCP tools are capability scoped | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P30 | MCP tools are non-destructive by default | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P31 | Setup Center exposes readiness | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |
| P32 | All verticals share evidence lineage | `LOCALLY_TESTED` | `backend/src/domain/evidence_quality.py; backend/src/domain/evidence_verticals.py; backend/src/domain/product_passport.py; backend/src/domain/evidence_mcp.py` |

## Z register

| ID | Requirement | State | Primary evidence |
| --- | --- | --- | --- |
| Z01 | Every metered operation has admission control | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z02 | Every provider has a documented quota | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z03 | Quota windows are configurable | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z04 | No paid fallback is hidden | `PREVIEW_VERIFIED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z05 | Low-priority work can be delayed | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z06 | Retry-After is respected | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z07 | Browser rendering is a last resort | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z08 | Static retrieval is preferred | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z09 | Conditional HTTP is used where supported | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z10 | Unchanged sources avoid AI calls | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z11 | Public datasets are selectively materialized | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z12 | Bulk analysis can run locally in DuckDB | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z13 | Reconstructible data has an expiry policy | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z14 | Irreplaceable evidence is protected | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z15 | Qdrant is reconstructible | `PREVIEW_VERIFIED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z16 | AI outputs are cached only when authorized | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z17 | Cache reuse respects source versions | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z18 | Cache reuse respects rights changes | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z19 | Workspace budgets are enforced | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z20 | Global budgets are enforced | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z21 | Administrators can see utilization | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z22 | Users see quota-based delays | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z23 | Exhaustion produces a typed state | `PREVIEW_VERIFIED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z24 | Export remains available near capacity | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z25 | Deletion remains available near capacity | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z26 | Background monitoring has priority tiers | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z27 | User-triggered refresh is supported | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z28 | Free-plan pauses are handled | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z29 | Read-only database mode is handled | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z30 | Every critical service has a migration path | `LOCALLY_TESTED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z31 | Free-tier behavior is tested | `PREVIEW_VERIFIED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |
| Z32 | The application never claims an SLA for free dependencies | `PREVIEW_VERIFIED` | `backend/src/domain/zero_cost.py; backend/src/domain/resource_accounting.py; config/zero-cost/cloudflare.free.json; backend/tests/regressions/test_v6_zero_cost_foundations.py` |

## Legacy register blockers

| Family | Entries | State | Blocker |
| --- | ---: | --- | --- |
| R | 32 | `BLOCKED` | Normative R01–R32 definitions are absent from the supplied master prompt and repository history. |
| CF | 32 | `BLOCKED` | Normative CF01–CF32 definitions are absent from the supplied master prompt and repository history. |
| A | 32 | `BLOCKED` | Normative A01–A32 definitions are absent from the supplied master prompt and repository history. |

Completion must not be claimed until the original legacy definitions are supplied or an accountable owner formally replaces them with a new baseline.
