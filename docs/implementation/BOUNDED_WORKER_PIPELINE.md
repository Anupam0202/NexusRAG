# Bounded Worker ingestion and grounded chat

## Status

`LOCALLY_TESTED` — the implementation is committed to the Preview branch. It must not be represented as `PREVIEW_VERIFIED` until the exact-head deployment and authenticated end-to-end probes pass.

## Implemented scope

- `POST /api/v1/documents/upload`
- `GET /api/v1/documents`
- `POST /api/v1/chat`
- authenticated workspace and capability enforcement
- bounded uploads up to 1,000,000 bytes
- UTF-8 text, Markdown, CSV, and JSON inputs
- filename normalization, SHA-256 receipts, deterministic overlapping chunks
- private Supabase Storage originals and authoritative document/version/chunk rows
- Gemini embeddings and grounded generation
- Qdrant payload indexes and workspace/document/index-generation fencing
- evidence citations and abstention when retrieval returns no evidence
- retrieved text treated as untrusted evidence, not instructions
- usage and audit writes with no hidden paid fallback

## Explicitly outstanding

- PDF, DOCX, OCR, archive and large-file processing
- malware/unsafe-file strategy beyond the bounded MIME allowlist
- durable asynchronous jobs, cancellation, retries and stale-worker fencing
- document status/chunk/reindex/delete routes
- deletion receipts covering Supabase, Storage and Qdrant
- chat-session persistence and history controls
- hybrid retrieval and reranking
- two-real-user browser isolation
- representative production-quality evaluation

## Acceptance boundary

The branch remains `PARTIAL_NOT_COMPLETE` and `NOT_PRODUCTION_VERIFIED`. Merge, production readiness, SLA, legal-rights, and complete Master Prompt claims remain prohibited until their documented gates pass.
