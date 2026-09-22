# Gateway lifecycle preview boundaries

The Preview gateway supports authenticated document upload, status, chunk inspection, reindex, retry, cancellation, deletion, persisted chat history, clearing, and optional server-sent event responses.

Current safety bounds:

- uploads are limited to 10 MB;
- ZIP expansion is limited to 64 entries and 20 MB;
- PDF and image extraction use the configured Gemini provider;
- deletion is complete only after Qdrant, private Storage, and Supabase receipts verify the operation;
- request-time processing records durable job and lease state, but a queue/Workflow consumer is still required before claiming fully asynchronous ingestion;
- production DNS, release, and paid-resource changes require explicit owner authorization.
