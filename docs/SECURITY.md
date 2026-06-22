# Security

NexusRAG is designed around tenant isolation, durable auth context, and defensive handling of untrusted documents and model output.

## Implemented Controls

- Supabase JWT validation and workspace-scoped API context.
- Supabase Auth is the sole identity and session authority; NexusRAG never receives Google or GitHub credentials.
- Google is the primary public OAuth provider and GitHub is the secondary provider.
- OAuth callback destinations are restricted to sanitized same-origin application paths.
- Public sign-in and callback responses avoid provider-detail and token leakage.
- Account-security controls use explicit Supabase sign-out scopes instead of relying on the SDK's global default.
- Workspace membership checks for protected document, chat, settings, analytics, and key routes.
- Supabase storage and metadata tables used instead of Render local disk for production user data.
- File validation for extension, empty content, upload size, and magic bytes for PDFs and common image formats.
- Filename sanitization to strip paths, dangerous characters, and control characters.
- Prompt-injection pattern detection and strict sanitization support.
- PII redaction helpers for emails, phone numbers, SSNs, and card-like values.
- Per-IP rate limiting middleware that does not trust caller-supplied identity headers.
- BYOK provider keys are handled server-side and raw keys are not returned to the browser.
- Markdown links in chat responses are restricted to relative, hash, `http`, `https`, and `mailto` links with safe external-link attributes.
- Vercel responses include CSP, HSTS, frame denial, restrictive permissions policy, and content-type/referrer protections.
- Deleting a document also deletes its private Supabase Storage original before removing durable chunks and vectors.
- Workspace owner membership cannot be removed or downgraded; admins cannot manage other admins.
- Workspace ownership, plan, document identity, and storage identity fields are immutable to untrusted database clients.
- Audit events are available for security-relevant actions.

## Environment Rules

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `GOOGLE_API_KEY`, or `QDRANT_API_KEY` to the frontend.
- Never log OAuth authorization codes, provider tokens, provider client secrets, access tokens, refresh tokens, or raw authentication payloads.
- Vercel should only receive `NEXT_PUBLIC_*` variables and the public backend URL.
- Render should receive server secrets and mirrored Supabase/Qdrant variables.
- Do not enable anonymous demo mode in production.
- Store Google and GitHub client credentials only in Supabase Auth provider settings, never in Vercel, Render, browser variables, or the repository.
- Allowlist only the production and deliberate local `/auth/callback` URLs in Supabase.
- Keep Supabase authentication abuse protections enabled.
- Leave email authentication enabled only during the agreed rollback window; the NexusRAG production UI must expose OAuth providers only.

## Remaining Security Work

- Add dedicated prompt-injection regression suites for retrieval, summarization, and agentic tool scenarios.
- Add plan-specific durable quota/billing reconciliation beyond current hard workspace quota enforcement.
- Add allow/deny controls for remote URLs if future document ingestion accepts URLs.
- Add browser-side frontend tests for markdown rendering and XSS cases.
- Add configurable data-retention schedules and complete workspace deletion workflows.

## Incident Checklist

1. Disable affected provider keys.
2. Rotate Render, Supabase, Qdrant, and Gemini credentials.
3. Review audit events for the affected workspace.
4. Disable anonymous demo access if enabled.
5. Quarantine suspicious uploaded files.
6. Rebuild affected vector indexes after cleanup.
