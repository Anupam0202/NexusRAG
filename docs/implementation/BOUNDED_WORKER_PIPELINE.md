# Bounded Worker ingestion and grounded chat

## Status

`PARTIAL_NOT_COMPLETE` — source/runtime acceptance must be checked against the exact reviewed commit. Historical preview deployments do not prove current source is live. The comprehensive application audit is the authoritative current status.

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
