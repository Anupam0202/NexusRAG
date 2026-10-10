# NexusRAG execution checkpoint

## Batch: lifecycle-privacy-002

**Application: PARTIAL_NOT_COMPLETE. Batch: LOCALLY_TESTED lifecycle failure privacy; no hosted operation or production verification.**

The full accepted scope remains unchanged. Normative registers and `docs/implementation/execution-ledger.json` remain authoritative for product closure; this is the current execution/recovery handoff.

### Source identity and continuation inspection

- Started from clean published37e1603fce3594fb2389ef3634b7ef93d82a2f86, review branch release/production-candidate-redaction, PR8 unmerged.
- Verified trusted prior full ZIP SHA2567072522b5069fa516477af2e477c398c154604a42827974a07d4da275b20f2eb, then matched all488 checkout source hashes before edits. No workspace reset or summary-based reconstruction.
- The final exported ZIP manifest records the exact saved commit and every tracked source hash/size/mode. Source and existing lock/dependency specifications are retained; frontend/package-lock.json is unchanged. No invented backend lockfile.
- Protected main85b14f131f5eacb07082a32c7173f20be472772f is untouched. No force push or protection bypass.

### Completed changes

- Lifecycle document/resource/workspace failure logs are type-only, without evaluating raw exception strings.
- Failure receipts use static messages and stable DOCUMENT_CLEANUP_FAILED / WORKSPACE_CLEANUP_FAILED / WORKSPACE_DELETE_FAILED codes, preserving useful resource/document identifiers.
- Real deletion response details and retention audit consumers receive safe receipts. Retention scheduler exception logging is type-only; its existing retry/lease behavior is unchanged.
- Partial deletion is not reported as complete: workspace removal/cache confirmation remain blocked on failures; already-completed vector/chat counts remain truthful.
- Added16synthetic regressions; existing two raw-message assertions now require safe messages/codes with all fail-closed assertions intact.

### Fresh verification / scope

| Check | Local result | Qualification |
| --- | --- | --- |
| Full offline backend | PASS:425tests +10subtests | Denied networking, synthetic fixtures |
| Isolated backend | PASS:57tests | No live provider/Storage |
| Gateway | PASS:269tests, no skips | Unchanged executable gateway, freshly rerun |
| Script tests | PASS:68tests | Checkpoint/source fixtures |
| Foundation and ledger validator | PASS validation; closure false | Not release acceptance |
| First new full-suite run | FAILED:1new fixture /424passes | Required confirmation was wrong; corrected to existing DELETE WORKSPACE contract, not loosened |
| New frontend/install/build/browser/PostgreSQL/live role/Storage/provider/image checks | NOT RUN locally | Do not inherit prior passes |
| New-head remote CI | Requires independent exact-head result | Prior37 image job was pending at observation; no scan success asserted |
| Final full ZIP/recovery | Must verify before handoff | Exported receipts record hashes/modes and freshly reexecuted targeted tests, not full recovered product acceptance |

After saving/publishing source, repeat selected checks against that exact clean commit before export. Logs contain command exits, commit identity and checksums. Initial and final logs remain distinguishable; if repeats differ, report failure rather than exporting a green claim.

### Unfinished work / next bounded batch

- Ledger246rows:234OPEN_ENGINEERING,8IN_PROGRESS,1FAILED,2BLOCKED_EXTERNAL,1narrow VERIFIED. All accepted product families remain open at their real scope.
- Inspect/remediate the actual maintained-runtime image gate without suppression, lowered thresholds or unstable runtime substitution. Read exact-head completed logs, not a historical scan.
- Continue private-error surfaces in ingestion/API/retrieval; this fix covers only lifecycle/scheduler handled paths. Complete legal hold, retention/erasure receipts, retry-persistence recovery and distributed lease authority remain unfinished.
- Full ten-product workflows, research/quality, accurate extraction/progressive execution, lawful connectors and real-role/Storage/pipeline acceptance remain engineering work, not external blockers.
- Hosted040 migration/exact isolated candidate rollout needs scoped approval and fresh parity checks. Production authorization and processing-rights decisions remain separate. No hosted deletion/retention was performed.
- Production-connected shared Preview, PR3 recovery, queues/DLQs, provider data and contributor attribution remain untouched. Destructive shared cleanup and contributor operations retain their separate approval/history boundaries.

## Exact continuation commands

First obtain the latest exported ZIP and its trusted SHA256 from the handoff/checksum receipt. Do not use an earlier checkpoint merely because its filename looks familiar. Set `ZIP` and `SHA256` to those exact supplied values, not guesses.

```bash
# Run from the currently trusted source checkout, before changing code.
cd /data/NexusRAG-current
python3 scripts/checkpoint_source.py verify --archive "$ZIP" --expected-sha256 "$SHA256"
git rev-parse HEAD
git status --porcelain
```

Compare the ZIP manifest commit and file hashes with the checkout. If the checkout reset or differs, restore **the ZIP's bytes**, not conversational code descriptions:

```bash
# Use a new directory; never overwrite unrelated work.
python3 /data/NexusRAG-current/scripts/checkpoint_source.py recover \
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
cd /data/NexusRAG-current
python3 scripts/checkpoint_source.py export \
  --archive /data/nexusrag-checkpoints/lifecycle-privacy-002.zip \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/results.json \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/scripts-final.log \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/gateway-final.log \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/backend-final.log \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/isolated-final.log \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/foundation-final.log \
  --log /data/nexusrag-checkpoints/lifecycle-privacy-002-logs/ledger-final.json
sha256sum /data/nexusrag-checkpoints/lifecycle-privacy-002.zip
```

Export the ZIP and final verification/checksum receipts as session files. Preserve each prior checkpoint until the newer checkpoint is verified and durably exported. Logs inside a recovered ZIP are historical evidence only. The next batch must rerun its acceptance checks against its saved/recovered source.
