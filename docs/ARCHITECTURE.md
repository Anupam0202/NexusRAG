# NexusRAG Architecture

NexusRAG is a multi-tenant RAG platform with a Next.js frontend on Vercel and a stateless FastAPI backend on Render. Supabase owns authentication, workspace metadata, audit events, chat persistence, original document storage, and the optional pgvector fallback. Qdrant is the primary production vector database. Local FAISS is retained only for local development and controlled demo fallback.

## Runtime Flow

1. A user signs in through Supabase Auth and selects or creates a workspace.
2. The frontend sends REST and WebSocket requests to the Render backend with the Supabase access token and workspace context.
3. The backend validates the JWT, resolves workspace membership, applies rate limits, validates uploaded files, and writes durable metadata to Supabase.
4. Original documents are stored in Supabase Storage. Ingestion jobs track queued, processing, completed, failed, and retry states.
5. The ingestion pipeline extracts text from PDF, DOCX, spreadsheets, CSV, images, text, Markdown, and JSON. OCR is enabled for scanned PDFs, images, and embedded document images when configured.
6. Chunks are embedded and indexed in Qdrant. If Qdrant is not available and pgvector fallback is enabled, embeddings can be written to Supabase `document_chunks.embedding`.
7. Chat uses workspace-scoped retrieval, semantic cache, reranking, prompt sanitization, LLM routing, BYOK support, and extractive fallback when generation is unavailable.
8. Analytics, usage telemetry, audit events, provider health, and cache stats are surfaced through API responses and UI dashboards.

## Frontend

- `frontend/src/app/chat` is the primary chat workflow.
- `frontend/src/app/documents` handles upload, document library, ingestion status, chunk browsing, and deletion.
- `frontend/src/app/analytics` displays query, ingestion, evaluation, and audit signals.
- `frontend/src/app/settings` contains runtime settings, workspace controls, provider key management, and usage/billing posture.
- `frontend/src/app/auth/login` and `frontend/src/app/auth/signup` are first-class auth entry points.
- `frontend/src/lib/api.ts` centralizes REST calls and backend error handling.
- `frontend/src/lib/websocket.ts` centralizes streaming chat transport.
- `frontend/src/components/chat/MessageBubble.tsx` renders markdown with explicit safe-link protocol filtering.

## Backend

- `backend/main.py` creates the FastAPI app and middleware.
- `backend/src/api/dependencies.py` resolves auth, workspace, settings, vector store, and RAG chain dependencies.
- `backend/src/api/routes.py` exposes REST endpoints for documents, chat, workspaces, settings, analytics, audit, evaluation, API keys, and status.
- `backend/src/api/websocket.py` handles streaming chat.
- `backend/src/ingestion/*` owns document loading, OCR, chunking, enrichment, and embedding.
- `backend/src/retrieval/*` owns hybrid retrieval, query transformation, reranking, and caches.
- `backend/src/generation/llm.py` and `backend/src/generation/router.py` own LLM calls, routing, fallback, provider health, and quota guards.
- `backend/src/vectorstores/*` owns Qdrant, pgvector fallback, and common vector-store contracts.
- `backend/scripts/process_jobs.py` can run queued ingestion outside the web request path.

## Data Stores

- Supabase Auth: user identities and JWTs.
- Supabase Postgres: profiles, workspaces, members, documents, chunks, jobs, chat, usage, audit, settings, keys, evaluations.
- Supabase Storage: original uploaded files.
- Qdrant: primary vector index.
- Supabase pgvector: optional small-demo fallback when enabled.
- Local disk: development-only fallback and no required production user data.

## Implemented Roadmap Actions

- Multi-tenant Supabase schema, RLS-oriented models, workspace membership, and authenticated API context.
- Durable document metadata, document storage integration, ingestion jobs, audit events, chat persistence, and evaluation tables.
- Qdrant primary vector store with workspace/document scoped payloads.
- Real pgvector fallback adapter, migration, match RPC, and workspace leakage tests.
- LLM routing foundations with BYOK/server/default modes, provider health, circuit breakers, token budgets, fallback reasons, and usage ledger primitives.
- Render/Vercel environment alignment, backend status surface, provider health surface, and vector backend status display.
- Upload validation, file type magic-byte checks, prompt sanitization, PII redaction, rate limiting, JWT validation, and safe markdown links.
- First-class signup page and billing/usage page with quota, provider key, vector backend, cache, and provider health posture.
- Async ingestion worker script and migration scripts for FAISS-to-Qdrant, legacy store quarantine, and metadata backfill.
- Backend tests covering routing, pgvector behavior, security contracts, generation fallback primitives, ingestion validation, and API behavior.

## Remaining Roadmap Actions

- Persist provider health and usage ledger entries as durable billing/quota records instead of only in-memory runtime guards.
- Enforce hard tenant plan quotas across upload count, bytes, documents, chunks, tokens, and requests.
- Add full cache suite with explicit invalidation: embedding cache, parse cache, chunk cache, retrieval cache, answer cache, and source verification cache.
- Add selected-document chat mode, document/date/uploader/page filters in the UI, and workspace-wide versus selected-document toggles.
- Add answerability detection, source quote verification, citation coverage scoring, and low-confidence UI states.
- Add member management, privacy controls, danger-zone UX, export chat, reindex controls, and richer provider health drilldowns.
- Add committed frontend unit/integration tests and Playwright E2E for signup/login, two users, two workspaces, upload, ingestion, chat, citations, deletion, and quota fallback.
- Run a production authenticated E2E once the deployed frontend and available Supabase admin project are the same project.
