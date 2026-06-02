# Security

NexusRAG is designed around tenant isolation, durable auth context, and defensive handling of untrusted documents and model output.

## Implemented Controls

- Supabase JWT validation and workspace-scoped API context.
- Workspace membership checks for protected document, chat, settings, analytics, and key routes.
- Supabase storage and metadata tables used instead of Render local disk for production user data.
- File validation for extension, empty content, upload size, and magic bytes for PDFs and common image formats.
- Filename sanitization to strip paths, dangerous characters, and control characters.
- Prompt-injection pattern detection and strict sanitization support.
- PII redaction helpers for emails, phone numbers, SSNs, and card-like values.
- Per-IP rate limiting middleware.
- BYOK provider keys are handled server-side and raw keys are not returned to the browser.
- Markdown links in chat responses are restricted to relative, hash, `http`, `https`, and `mailto` links with safe external-link attributes.
- Audit events are available for security-relevant actions.

## Environment Rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_API_KEY`, or `QDRANT_API_KEY` to the frontend.
- Vercel should only receive `NEXT_PUBLIC_*` variables and the public backend URL.
- Render should receive server secrets and mirrored Supabase/Qdrant variables.
- Do not enable anonymous demo mode in production.

## Remaining Security Work

- Add dedicated prompt-injection regression suites for retrieval, summarization, and agentic tool scenarios.
- Persist and enforce tenant quotas as hard authorization decisions.
- Add allow/deny controls for remote URLs if future document ingestion accepts URLs.
- Add browser-side frontend tests for markdown rendering and XSS cases.
- Add security headers and CSP tuning for production domains.
- Add data retention and workspace deletion workflows with verified storage cleanup.

## Incident Checklist

1. Disable affected provider keys.
2. Rotate Render, Supabase, Qdrant, and Gemini credentials.
3. Review audit events for the affected workspace.
4. Disable anonymous demo access if enabled.
5. Quarantine suspicious uploaded files.
6. Rebuild affected vector indexes after cleanup.
