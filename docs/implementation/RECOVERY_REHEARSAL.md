# Deployment, canary, rollback, restore, and deletion rehearsal

Status: `PREVIEW_REHEARSAL_VERIFIED`

Reviewed: 2026-09-21

## Release identity

Every rehearsal records the Git commit, Cloudflare Worker version and
deployment IDs, Supabase migration head, Qdrant disposable collection name,
and synthetic fixture prefix. Production state is never used as disposable
state.

## Cloudflare preview

1. Build the OpenNext bundle from the lockfile.
2. Upload a new immutable Worker version.
3. Record the currently active version as the rollback target.
4. Create a percentage deployment with 5% candidate and 95% current.
5. Probe homepage, Evidence OS, gateway health, security headers, desktop/mobile
   flows, accessibility, and visual baselines.
6. Promote the candidate to 100% only if every probe passes.
7. Rehearse rollback by deploying the recorded previous version to 100%, probe
   it, then restore the validated candidate to 100%.
8. Preserve deployment IDs and timestamps in this report. Never delete the
   final known-good version during the rehearsal.

The Preview workflow performs build, deploy, live smoke, accessibility,
desktop/mobile, and visual gates. A live percentage canary and rollback
rehearsal completed successfully on 2026-09-21.

## Supabase restore

- Durable authority remains Supabase; Cloudflare state is not a backup.
- Migrations are forward-only and rehearsed against a clean disposable
  PostgreSQL instance in CI.
- Restore order is schema, auth identities, private Storage originals,
  authority rows, then reconstructible Qdrant indexes.
- A restore must stay read-only until row counts, RLS/policy inventory,
  Storage object hashes, active document versions, and deletion tombstones are
  reconciled.
- Historical migrations 014–022 exist in the connected project but their exact
  original source files are unavailable. The canonical clean baseline is the
  approved recovery source; this limitation remains explicit.

## Deletion rehearsal

The controlled live Storage isolation test created two synthetic identities,
two workspaces, an allocated exact-path upload, a Storage row, and a published
version. Cleanup removed the object through the Storage-authorized maintenance
path, removed version/document/workspace/auth fixtures in dependency order,
and verified zero remaining users, workspaces, and objects.

Application deletion remains service-mediated, idempotent, bounded, and
receipt-based. Partial failure stays `blocked` or `pending` and is never
reported as deleted.

## Qdrant reconstruction and deletion

The live provider workflow creates a disposable prefixed collection, creates
workspace/version/generation indexes, inserts synthetic points, performs a
fenced query, and deletes the collection in `finally`. Qdrant is reconstructible
from Supabase authority records and private originals; no probe collection is
retained.

## Gemini and capacity failure

The live provider workflow sends one synthetic bounded request with thinking
disabled. HTTP 429 and quota exhaustion become typed states with reset/retry
metadata and no paid fallback. Customer evidence is not used by the live probe.

## Stop conditions

Stop promotion and retain or restore the last known-good version if any of the
following occurs: authentication or authorization failure, private evidence
exposure, failed deletion, missing export, visual/accessibility regression,
provider rights block, unmeasured quota, or incomplete accounting.

## Live Cloudflare evidence — 2026-09-21

- Candidate version: `9ada722a-08c9-44d0-93ca-6503f29b4636`.
- Last known-good version: `be3d80cd-17fd-4182-b117-b27d3e70db15`.
- Canary deployment `0cc68712-fe0a-4859-ac50-f98a03a6b2ed`: 5% candidate, 95% known-good.
- Canary probes: 25/25 Evidence OS requests passed.
- Promotion deployment: `f81c7447-91c7-4cd3-a6e4-166fdb6d8c03`.
- Rollback deployment: `07bf4c99-7e54-42d0-a736-cb29713e3f38`; homepage, Evidence OS, and sign-in probes passed.
- Restore deployment: `57caf250-02ea-49b1-9cf5-bf7bcdb56a1b`; current candidate restored to 100%.
- Post-restore probes: homepage, Evidence OS, and gateway health passed.

No customer authority data, DNS, secret value, or paid resource was changed.
