# NexusRAG Comprehensive QA Prompt

Use this prompt to test NexusRAG end to end and fix issues one by one.

```text
You are testing the NexusRAG application. Do not assume anything that can be verified from the repo, README, deployed URLs, or API responses.

Goal:
Comprehensively verify that the frontend, backend, and deployed environment work together for the four core sections: Chat, Documents, Analytics, and Settings. If a bug is found, produce a minimal reproduction, identify the root cause, patch it, run tests, and verify the fix before moving to the next issue.

Context:
- Repository: Anupam0202/NexusRAG
- Frontend: Vercel, https://nexusrag.vercel.app
- Backend: Render, https://nexusrag-backend-wv2f.onrender.com
- Core document types: PDF, DOCX, XLSX/XLS, CSV, TXT, MD, JSON, images.
- Render free tier is memory constrained and can restart/spin down. Treat corpus persistence after restart as a known deployment constraint unless persistent storage is added.

Required setup checks:
1. Read README.md and compare documented features with the actual code and deployed /api/v1/status payload.
2. Verify frontend environment points to the Render backend, not Railway or localhost.
3. Verify CORS from https://nexusrag.vercel.app to the Render backend.
4. Verify /health, /api/v1/status, /api/v1/documents, /api/v1/settings, and /api/v1/analytics/summary.

Documents section:
1. Test desktop, tablet/iPad, and mobile widths.
2. Confirm uploader is compact, readable, touch-friendly, and lists exact accepted formats and limits.
3. Confirm unsupported files show an unsupported-type error, not a misleading size error.
4. Upload PDF, DOCX, TXT, MD, and an image or scanned PDF if available.
5. Confirm document count, chunk count, file size, status, refresh, and delete all work.
6. Confirm upload failures preserve any successfully uploaded documents and show actionable UI errors.
7. On iPad/mobile, verify the app's UI is focused and clean. Do not claim the app can hide OS file-provider locations from the native file picker; only verify accept filters, labels, batch limits, and visual compactness.

Chat section:
1. Open Chat with zero documents and confirm the empty state guides the user to upload.
2. With documents uploaded, ask source-specific questions using exact filenames.
3. Verify sources are scoped correctly and do not include unrelated documents.
4. Test one broad summary query and one precise extraction query.
5. Trigger or simulate LLM quota/generation failure and confirm source-backed fallback answers appear instead of a crash.
6. Test clear chat and source panel open/close on desktop and mobile.

Analytics section:
1. Confirm metrics match backend analytics/status counts.
2. Confirm pipeline configuration reflects effective backend settings, especially Render-constrained features such as reranking, semantic chunking, contextual enrichment, query expansion, OCR, and cache.
3. Confirm refresh and auto-refresh do not flicker or show stale contradictory values.
4. Confirm no hard-coded feature labels disagree with /api/v1/status.

Settings section:
1. Confirm settings load from backend and save successfully.
2. Confirm sliders stay within backend validation ranges.
3. On constrained Render deployments, confirm memory-heavy toggles are visibly locked off and backend PATCH rejects enabling them.
4. Confirm save errors are shown clearly and do not corrupt local UI state.

Backend checks:
1. Run backend lint and tests.
2. Test upload validation: unsupported extension, oversize file, PDF page limit, scanned PDF OCR page limit, and high-megapixel image rejection.
3. Test document upload/delete clears semantic cache.
4. Test explicit filename retrieval scope.
5. Test constrained settings reject heavy features.

Frontend checks:
1. Run frontend lint and production build.
2. Browser-test /chat, /documents, /analytics, /settings at desktop, iPad/tablet, and mobile widths.
3. Capture screenshots of all four sections after fixes.
4. Check browser console errors, visible overflow, clipped text, overlapping UI, mobile navigation, dark-mode toggle, and backend status badge.

Deployment checks:
1. Confirm latest GitHub commit is deployed to Vercel and Render.
2. Re-check live API health and UI after redeploy.
3. Re-upload sample documents after Render restarts, because the current free-tier vector store is not persistent.
4. Re-run source-specific chat checks on the live app.

Final report format:
- Commit/deployment IDs
- Bugs found
- Fixes applied
- Tests passed/failed
- Screenshots captured
- Known constraints
- Next recommended improvements
```
