# Preview deployment scope

Candidate deployment is explicit manual dispatch on protected main, not a path-change trigger. It targets only the isolated rehearsal database and requires migration 036's service-only capability probe. Source integration does not automatically deploy the candidate or production.

The deployed increment remains `PARTIAL_NOT_COMPLETE` and `NOT_PRODUCTION_VERIFIED`. Its acceptance boundary is documented in `docs/implementation/BOUNDED_WORKER_PIPELINE.md`.
