# Provider rights, licence, and quota register

Status: `REVIEWED_FAIL_CLOSED`

Reviewed: 2026-09-21
Review again by: 2026-12-20

No recurring public connector is enabled. The runtime default remains
`REVIEW_REQUIRED`; an undocumented quota is denied and paid fallback is false.
This means the definition-of-done gate for **enabled** sources is satisfied
without silently enabling a source whose rights are uncertain.

| Provider | Decision | Enforced client posture | Official evidence |
| --- | --- | --- | --- |
| SEC EDGAR | `APPROVED_WITH_DUTIES`, disabled | Declared contact User-Agent; ≤10 requests/second; 5,000/day workspace cap | [SEC fair access](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) |
| Federal Register | `REVIEW_REQUIRED`, disabled | 1 request/second; 1,000/day; Retry-After | [FR API](https://www.federalregister.gov/developers/documentation/api/v1) |
| EU TED | `REVIEW_REQUIRED`, disabled | 250/page; 15,000 pagination cap; 1,000/day | [TED Search API limits](https://docs.ted.europa.eu/ODS/latest/reuse/search-api.html) |
| GLEIF | `APPROVED_WITH_DUTIES`, disabled | 60/minute; preserve LEI source/update time | [GLEIF API](https://api.gleif.org/docs) and [terms](https://www.gleif.org/en/meta/lei-data-terms-of-use/) |
| Crossref | `APPROVED_WITH_DUTIES`, disabled | Polite pool: 10/second, concurrency 3; `mailto`; 429 backoff; abstract rights remain source-specific | [Crossref limits](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication) |
| OpenAlex | `LEGAL_REVIEW`, disabled | Zero admitted recurring requests | Current official rights/quota evidence was not captured; fail closed |
| OSV | `APPROVED_WITH_DUTIES`, disabled | Client cap 2/second and 2,000/day despite no service rate limit; preserve upstream licences | [OSV FAQ](https://google.github.io/osv.dev/faq) |
| CISA KEV | `APPROVED_WITH_DUTIES`, disabled | Conditional HTTP; 4/hour; preserve licence and remediation context | [CISA KEV catalog and licence](https://www.cisa.gov/known-exploited-vulnerabilities-catalog) |
| USGS Earthquake | `REVIEW_REQUIRED`, disabled | 20,000 events/query; 1/second; bounded dates | [USGS FDSN event service](https://earthquake.usgs.gov/fdsnws/event/1/) |
| NOAA CDO | `APPROVED_WITH_DUTIES`, disabled | Token required; service 5/second and 10,000/day; client cap 1,000/day; 1,000 rows/response | [NOAA CDO API](https://www.ncei.noaa.gov/cdo-web/webservices/v2) |

## Enablement rule

A provider can move from disabled to enabled only when a workspace policy
records allowed operations, prohibited operations, duties, quota window,
review date, evidence hash, and an accountable reviewer. `LEGAL_REVIEW` and
`REVIEW_REQUIRED` never authorize fetch, store, embed, export, monitor, API, or
MCP operations.

## Scope caveat

This is an engineering rights register, not legal advice. Source-specific
copyright, database rights, privacy restrictions, and downstream licences still
apply to each item. The application preserves source identifiers, timestamps,
licence metadata, and attribution duties in evidence lineage.
