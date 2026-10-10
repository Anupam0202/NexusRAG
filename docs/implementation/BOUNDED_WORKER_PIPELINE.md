# Bounded Worker ingestion and grounded chat

## Status

`PARTIAL_NOT_COMPLETE` — source/runtime acceptance must be checked against the exact reviewed commit. Historical preview deployments do not prove current source is live. The comprehensive application audit is the authoritative current status.

## Request admission limits

The reviewed gateway source uses a shared streamed UTF-8 JSON object reader before mutation: ordinary JSON and finding writes are bounded to 100,000 bytes / five seconds, invitations to 4,096 bytes / five seconds, with at most 2,048 transport fragments. Actual bytes—not an untrusted Content-Length—determine admission. Malformed JSON/UTF-8, abort, timeout, excessive fragmentation and overflow fail safely without reflecting private input or awaiting a stalled cancellation hook. JSON schema 400/422 contracts remain route-specific. Oversized envelopes (including long client-supplied history) are rejected with an actionable limit, never silently truncated. These are JSON limits, separate from multipart upload/extraction limits. Source tests/dry-run bundling are not proof that the approved candidate currently serves this reader; consult the authoritative audit and exact active source identity.

## Authoritative retrieval filters

Reviewed source accepts exact case-sensitive filename, case-insensitive extension, UUID uploader, inclusive ISO upload timestamp, page range, and up to eight literal scalar chunk-metadata predicates. Values are validated and URL encoded; keys containing dots are literal JSON keys, not paths. Durable documents/chunks, not vector payload metadata, establish scope. Missing page data never matches zero. UI date-only end bounds cover the full UTC day; explicit timestamp bounds remain exact.

At most100current matching documents are admitted. Page/metadata scopes must have at most200matching chunks: larger scopes fail before account reservation/session writes rather than being truncated. Authoritative chunk IDs fence Qdrant `has_id` and lexical candidates alongside tenant/version/generation authority. Both paths rehydrate/hash-check/filter before provider use and revalidate current source/filter authority before persistence/return. Empty matching scopes abstain without embedding/vector/generation calls. Unfiltered lexical sampling remains explicitly bounded/non-exhaustive.

This is source/local acceptance, not hosted rollout, representative recall, page-accurate extraction or complete research-mode implementation. Chunk metadata comes from existing durable ingestion/extraction; arbitrary metadata editing is not introduced. The authoritative audit records exact tests/deployment status.

## Implemented scope

- `POST /api/v1/documents/upload`
- `GET /api/v1/documents`
- `POST /api/v1/chat`
- authenticated workspace and capability enforcement
- bounded uploads up to 10,000,000 bytes
- UTF-8 text, Markdown, CSV and JSON; bounded DOCX XML/ZIP extraction; approved non-sensitive PDF/image extraction through Gemini
- filename normalization, SHA-256 receipts, deterministic overlapping chunks
- private Supabase Storage originals and authoritative document/version/chunk rows
- Gemini embeddings and grounded generation
- Qdrant payload indexes and workspace/document/index-generation fencing
- evidence citations and abstention when retrieval returns no evidence
- retrieved text treated as untrusted evidence, not instructions
- usage and audit writes with no hidden paid fallback
- durable batched ingestion, status/chunk/reindex/cancel/retry controls and generation fences
- scoped private chat history; bounded lexical/dense fusion, not cross-encoder reranking
- paginated document inventory, atomic workspace/member operations and private findings/reviews after migration 035

## Explicitly outstanding

- page-accurate extraction fidelity, native heavy/spreadsheet processing and larger-than-bound workloads
- malware/unsafe-file strategy beyond the bounded MIME allowlist
- complete verified derived-data and outstanding-remote-write deletion, retention enforcement and workspace erasure
- true progressive generation streaming, representative lexical recall and reranking
- invitation delivery/acceptance and complete connected product workflows
- two-real-user browser isolation
- representative production-quality evaluation

## Acceptance boundary

The application remains `PARTIAL_NOT_COMPLETE` and `NOT_PRODUCTION_VERIFIED`. Reviewable source may be integrated through protected checks without claiming product completion. Production deployment, rights activation and production-readiness claims require their separate owner-approved gates.
