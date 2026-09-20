# Evaluation

Evaluation should prove that NexusRAG answers from uploaded documents, cites the right sources, avoids hallucination, and degrades gracefully when generation providers are unavailable.

## Current Coverage

- Backend tests cover API behavior, ingestion validation, generation primitives, routing, pgvector fallback, member administration, security helpers, and vector-store scoping.
- Frontend Vitest coverage includes safe markdown links, low-confidence rendering, multi-document filter normalization, and chat export.
- A committed Playwright public smoke suite covers guarded production routes.
- The public suite covers desktop and Pixel 7-class mobile layouts, console and
  page errors, safe auth redirects, configured OAuth providers, horizontal
  overflow, keyboard focus, and reduced-motion behavior.
- Sample evaluation routes and result models exist for RAG quality checks.
- Evaluation summaries include p50/p95 latency, fallback rate, quota failure rate, and estimated cost posture.
- Analytics records usage, errors, fallback posture, cache behavior, and ingestion status.
- Status endpoints expose deployment, vector backend, Supabase/Qdrant, upload, OCR, and provider health signals.
- The V6 dataset builder emits 400 labeled and 125 held-out deterministic
  synthetic cases. Fixed gates now score Recall@20, citation precision,
  supported-claim coverage, correct abstention, entity precision, change-alert
  precision, reviewed-obligation precision, calculations, and cross-workspace
  access. This evidence is explicitly non-production.
- Live Supabase Storage RLS was rehearsed with two synthetic identities and
  complete cleanup.

## Required E2E Scenarios

- Sign up, sign in, and sign out.
- Create two users and two workspaces, then verify isolation.
- Upload PDF, DOCX, spreadsheet, TXT, Markdown, JSON, and image files.
- Verify ingestion status, document listing, chunk listing, and deletion.
- Ask document-specific and workspace-wide questions.
- Verify citations, source file names, page numbers, and confidence.
- Exhaust or disable LLM provider quota and verify extractive fallback.
- Delete a document and verify it is removed from metadata, storage, and vector search.
- Verify usage, audit, analytics, settings, provider keys, and provider health UI.

## Quality Gates

- Backend tests pass.
- Frontend lint passes.
- Frontend production build passes.
- Public backend `/api/v1/status` returns healthy deployment settings.
- Public frontend renders Chat, Documents, Analytics, Settings, Login, Signup, and Billing/Usage without console errors.
- Authenticated production upload/chat E2E passes against the same Supabase project used by the deployed frontend.

## Remaining Evaluation Work

- Expand component coverage for members, privacy controls, uploads, and streaming.
- Add authenticated Playwright E2E that can create two provider-backed
  sessions/workspaces and upload real files through the application.
- Add provider-backed citation, answerability, faithfulness, and retrieval
  scoring; deterministic synthetic contract scores must not be relabeled as
  production quality.
- Add prompt-injection test datasets.
- Add regression fixtures for scanned PDFs and embedded-image OCR.
