# NexusRAG execution checkpoint

## Batch: retention-lease-004

**Application: PARTIAL_NOT_COMPLETE. Batch: LOCALLY_TESTED schedule-write fencing; no hosted operation or production verification.**

Full accepted scope is unchanged; the normative registers and execution-ledger.json determine closure, not a local test count.

### Recovery and source identity

- Workspace reset to preceding a04. Retrieved exported batch003 ZIP and verified trusted SHA256212226bc808b23b52899aaf3e13496096ae8429b5fb520204b1d530b4a9de047, then restored its bytes into /data/NexusRAG-batch004. All490 source hashes/modes matched exact8faaebad5bbcfb70a3e8161dd645a7069ddb9c29. Associated fetched git metadata with reset --mixed; no overwriting recovered code or conversational reconstruction.
- Before new edits freshly reran457backend+10subtests,57isolated,269gateway/no skips,68scripts and foundation on that restored source. Historical receipt logs were not treated as fresh passes.
- Review branch release/production-candidate-redaction / PR8 remains unmerged. Main85b14f131f5eacb07082a32c7173f20be472772f unchanged; no protection bypass. Final ZIP manifest binds saved commit and all tracked hashes/modes.
- Source retains unchanged dependency specifications/lockfiles, including frontend/package-lock.json. Created a new isolated test venv from backend/requirements-test.txt; resolved transitive versions are an external receipt, not an invented production lockfile.

### Completed changes

- Added forward-only migration041 finish_retention_claim RPC, service-role-only permission and runtime auth.role guard, fixed search_path, SECURITY INVOKER. No applied baseline or migration history edited.
- Completion/retry locks the settings row and requires the exact worker, original claim expiry, current enabled policy/days and unexpired database time after lock acquisition. Same-worker stale claims and committed-success retry replays cannot overwrite a newer/released schedule. Success schedules one day and records completion; retry preserves prior completion and schedules one hour. Denials return false without mutation; invalid arguments/auth fail with static codes.
- Scheduler requires matching owner and valid future aware expiry before cleanup, then uses only the fenced RPC. Missing/unexpected responses fail closed; there is no legacy/unfenced upsert fallback. Lease loss and ambiguous retry failure remain unsuccessful and explicitly counted; later rows continue and partial lifecycle-reported counts remain visible.
- Added18backend cases for bad claims, stale/ambiguous completion and strict RPC results. Updated existing scheduler fixtures to guarded calls without removing privacy/fail-closed assertions. PostgreSQL tests cover authority/policy/expiry/replay, exactly one concurrent finish and expiration while waiting for a row lock. Local/CI rehearsal includes041; original baseline remains immutable.

### Fresh checks / scope

| Check | Result | Qualification |
| --- | --- | --- |
| Full offline backend | PASS:475tests +10subtests | New clean test venv; denied network fixtures |
| Isolated backend | PASS:57tests | No live provider/Storage |
| Gateway | PASS:269tests/no skips | Unchanged executable gateway, rerun |
| Scripts / foundation / immutable migration integrity | PASS:68scripts; validators pass | Ledger closure false |
| PostgreSQL17 baseline +026–041 / locking / backup-restore | PASS | Disposable local SQL/Auth/Storage stand-ins, real pgcrypto/pgvector; database dropped and server stopped |
| Parent8faa completed CI |12successes/2intentional deployment skips; image + mandatory summary FAILED | Detailed new raw image findings NOT reacquired; do not borrow a04 counts |
| Frontend/clean npm install/build/browser/live roles/Storage/provider/local images | NOT RUN in this batch | No inherited passes |
| Final saved-source and ZIP recovery checks | Repeat before handoff; external receipts record actual exits/hashes | Restore all source bytes and freshly run selected checks; no historical pass inheritance |

Final clean commit and recovered source must independently pass selected checks including fresh disposable SQL replay/restore. Logs identify exact source and environment; exported helper verification alone does not execute tests.

### Unfinished work / next bounded batch

- Schedule-write fencing is not atomic external cleanup, durable deletion fencing, legal-hold enforcement, complete privacy/erasure acceptance or a deployed durable Python worker. Manual retention route still has separate unfenced schedule writes and must be integrated with scoped claim authority; running cleanup may outlive a lease or race policy changes. Do not call broader retention complete.
- Exact completed8faa image job114222818422 and summary114227102083 FAILED. Obtain and remediate actual compatible runtime findings without suppression/threshold reduction/unstable runtime substitution. New head requires independent exact-head checks and review before merge.
- Ledger247rows remains234OPEN_ENGINEERING/9IN_PROGRESS/1FAILED/2BLOCKED_EXTERNAL/1narrow VERIFIED. Full ten products, research/quality, extraction/progressive execution, lawful connectors, real-role/Storage/pipeline and cleanup inventory are unfinished engineering, not external blockers.
- Hosted040/041 migration and exact isolated candidate deployment require scoped approval and fresh drift/recovery checks. Production release/processing-rights/shared destructive cleanup/security/credentials/DNS/paid/contributor operations remain separately gated and untouched.

## Exact continuation commands

First obtain the latest exported ZIP and its trusted SHA256 from the handoff/checksum receipt. Do not use an earlier checkpoint merely because its filename looks familiar. Set `ZIP` and `SHA256` to those exact supplied values, not guesses.

```bash
# Run from the currently trusted source checkout, before changing code.
cd /data/NexusRAG-batch004
python3 scripts/checkpoint_source.py verify --archive "$ZIP" --expected-sha256 "$SHA256"
git rev-parse HEAD
git status --porcelain
```

Compare the ZIP manifest commit and file hashes with the checkout. If the checkout reset or differs, restore **the ZIP's bytes**, not conversational code descriptions:

```bash
# Use a new directory; never overwrite unrelated work.
python3 /data/NexusRAG-batch004/scripts/checkpoint_source.py recover \
  --archive "$ZIP" --expected-sha256 "$SHA256" \
  --destination /data/NexusRAG-recovered-next
cd /data/NexusRAG-recovered-next
cat RUN-STATE.md
```

If the trusted helper itself is absent after reset, validate the whole ZIP first, then obtain the helper from those verified bytes—not from a conversation summary:

```bash
printf '%s  %s\n' "$SHA256" "$ZIP" | sha256sum -c -
unzip -p "$ZIP" scripts/checkpoint_source.py > /data/verified-checkpoint-helper.py
python3 /data/verified-checkpoint-helper.py recover --archive "$ZIP" \
  --expected-sha256 "$SHA256" --destination /data/NexusRAG-recovered-next
```

Restore git metadata only after recovering source. Fetch the manifest's exact commit, never reset/checkout over recovered bytes. `reset --mixed` associates the index without rewriting source:

```bash
cd /data/NexusRAG-recovered-next
SOURCE_COMMIT=$(python3 -c 'import json; print(json.load(open(".checkpoint/manifest.json"))["source_commit"])')
# Preserve exported receipts outside the source tree; destination must not exist.
test ! -e /data/nexusrag-checkpoints/recovered-next-evidence
mv .checkpoint /data/nexusrag-checkpoints/recovered-next-evidence
git init
git remote add origin https://github.com/Anupam0202/NexusRAG.git
git fetch --no-tags origin "$SOURCE_COMMIT"
git reset --mixed "$SOURCE_COMMIT"
git diff --exit-code
git diff --cached --exit-code
test -z "$(git status --porcelain)"
```

The ZIP verifier already compares all source hashes; these checks confirm association with fetched history. Recovery does not reinstall dependencies or establish a fresh pass.

Recreate the documented offline backend environment and clean frontend dependencies, then rerun relevant checks. Do not copy old `node_modules`, virtual environments or their test statuses as verification of recovery:

```bash
cd /data/NexusRAG-recovered-next
python3 -m unittest discover -s tests/scripts
npm run check:cloudflare
npm run test:cloudflare
python3 scripts/check_execution_ledger.py
# Recreate the bounded pinned test profile; never activate provider secrets.
python3 -m venv /data/nexusrag-recovered-testenv
/data/nexusrag-recovered-testenv/bin/python -m pip install -r backend/requirements-test.txt
/data/nexusrag-recovered-testenv/bin/python backend/scripts/run_full_tests.py
(cd backend && /data/nexusrag-recovered-testenv/bin/python scripts/run_isolated.py)
(cd frontend && npm ci --ignore-scripts && npm run lint && npm test \
  && npm exec tsc -- --noEmit && npm run build && npm run cf:build)
```

For next remote inspection use GitHub MCP `pull_request_read` methods `get` and `get_check_runs`, owner `Anupam0202`, repo `NexusRAG`, pullNumber8. Capture the actual head SHA; inspect completed image logs on that SHA, not an older job. Never use this document to authorize a hosted/deletion operation.

## End-of-batch export

Update this file with the actual completed/unfinished work and passed/failed/not-run checks. Save source and dependency specifications/locks, verify the clean saved tree, then export outside the repository. Select only sanitized verification logs, never private tokens, signed log URLs, customer data or credential-bearing command payloads.

```bash
cd /data/NexusRAG-batch004
python3 scripts/checkpoint_source.py export \
  --archive /data/nexusrag-checkpoints/retention-lease-004.zip \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/results.json \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/scripts-final.log \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/gateway-final.log \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/backend-final.log \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/isolated-final.log \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/foundation-final.log \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/ledger-final.json \
  --log /data/nexusrag-checkpoints/retention-lease-004-logs/postgres-final.log
sha256sum /data/nexusrag-checkpoints/retention-lease-004.zip
```

Export the ZIP and final verification/checksum receipts as session files. Preserve each prior checkpoint until the newer checkpoint is verified and durably exported. Logs inside a recovered ZIP are historical evidence only. The next batch must rerun its acceptance checks against its saved/recovered source.
