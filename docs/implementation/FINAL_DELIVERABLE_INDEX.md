# V6 final-deliverable index

Status: `PARTIAL_NOT_COMPLETE_WITH_PUBLISHED_EVIDENCE`

| # | Deliverable | Evidence | State |
| ---: | --- | --- | --- |
| 1 | Executive implementation report | `docs/V6_IMPLEMENTATION_REPORT.md` | PREVIEW_VERIFIED |
| 2 | Repository inventory | `docs/MASTER_PROMPT_AUDIT.md` | VERIFIED |
| 3 | GitHub state | `docs/implementation/LIVE_PLATFORM_VALIDATION_2026-09-20.md` and protected `main` rule | VERIFIED |
| 4 | Cloudflare inventory | `docs/implementation/cloudflare-ledger.json` | VERIFIED |
| 5 | Supabase inventory | `docs/implementation/SUPABASE_SECURITY_REPORT.md` | VERIFIED |
| 6 | Confirmed project mapping | live platform report | VERIFIED |
| 7 | Architecture decision record | `docs/ARCHITECTURE.md` | LOCALLY_TESTED |
| 8 | Zero-cost architecture matrix | `docs/architecture/CLOUDFLARE_DECISION_MATRIX.json` | VERIFIED |
| 9 | Resource budget configuration | `config/zero-cost/cloudflare.free.json` | LOCALLY_TESTED |
| 10 | Provider registry | `config/provider-registry.zero-cost.json` | REVIEWED_FAIL_CLOSED |
| 11 | Rights and licence register | `docs/implementation/PROVIDER_RIGHTS_REGISTER.md` | REVIEWED_FAIL_CLOSED |
| 12 | Terms and quota report | provider registry and rights register | REVIEWED_FAIL_CLOSED |
| 13 | Standards mapping | `backend/src/domain/standards_mapping.py` and traceability report | LOCALLY_TESTED |
| 14 | Evidence graph schema | Supabase baseline graph tables | LOCALLY_TESTED |
| 15 | Obligation schema | `backend/src/domain/regulatory_obligations.py` | LOCALLY_TESTED |
| 16 | Procurement schema | `backend/src/domain/evidence_verticals.py` | LOCALLY_TESTED |
| 17 | Counterparty schema | `backend/src/domain/evidence_verticals.py` | LOCALLY_TESTED |
| 18 | Product Passport schema | `backend/src/domain/product_passport.py` | LOCALLY_TESTED |
| 19 | Supabase RLS report | Supabase security report | LIVE_VERIFIED |
| 20 | Storage security report | Supabase security report | LIVE_VERIFIED |
| 21 | Qdrant report | live-provider workflow artifact | PREVIEW_VERIFIED |
| 22 | Gemini report | live-provider workflow artifact | PREVIEW_VERIFIED |
| 23 | Computer/Browser report | Cloudflare ledger and recovery report | PREVIEW_VERIFIED |
| 24 | UI route/component inventory | Next build output and public browser suite | PREVIEW_VERIFIED |
| 25 | Requirement traceability | `docs/implementation/REQUIREMENT_TRACEABILITY.md` | PARTIAL — legacy definitions missing |
| 26 | Commands/exact results | live platform report and GitHub Actions | VERIFIED |
| 27 | Evaluation report | `docs/EVALUATION.md` plus evaluation artifacts | SYNTHETIC_GATES_PASSED |
| 28 | Security/privacy report | `docs/SECURITY.md` and Supabase report | PREVIEW_VERIFIED |
| 29 | Accessibility report | Cloudflare browser artifact | PREVIEW_VERIFIED |
| 30 | SBOM/licence report | CI CycloneDX and licence artifacts | VERIFIED |
| 31 | Capacity/utilization report | zero-cost config, provider registry, Setup Center | LOCALLY_TESTED |
| 32 | Free-to-paid migration paths | Cloudflare matrix and architecture report | LOCALLY_TESTED |
| 33 | Deployment/canary/rollback/restore/deletion | `docs/implementation/RECOVERY_REHEARSAL.md` | PREVIEW_VERIFIED |
| 34 | Exact blockers | master audit | VERIFIED |
| 35 | Published links | PR and GitHub Actions links only | VERIFIED |

No row marked partial is silently promoted to complete. The master status remains
`PARTIAL_NOT_COMPLETE` until the exact blockers in the master audit are closed
or formally accepted by an accountable owner.
