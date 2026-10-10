# NexusRAG execution checkpoint

## Batch: retention-resilience-003

**Application: PARTIAL_NOT_COMPLETE. Batch: LOCALLY_TESTED retention failure isolation; no hosted operation or production verification.**

The full accepted scope remains unchanged. Normative registers and `docs/implementation/execution-ledger.json` remain authoritative for product closure.

### Source identity and continuation inspection

- Started from clean published a04a01ce74f15369c583fdc0585720034962e0ab, review branch release/production-candidate-redaction, PR8 unmerged.
- Verified trusted batch002 ZIP SHA25619bb189ea39d5002727f301dd7aa0a9e9afac3b203a188b607e0ad606c134ee2 and all489 checkout hashes before edits. No reset or summary-based source reconstruction.
- Final ZIP manifest records the exact saved commit and every tracked hash/size/mode. Existing dependency specifications and frontend/package-lock.json are unchanged; no invented backend lockfile.
- Protected main85b14f131f5eacb07082a32c7173f20be472772f remains untouched; no force push or protection bypass.

### Completed changes

- Retention claims require plain dict records, explicit boolean enablement, a nonempty whitespace-normalized workspace string and positive integer retention days; malformed records are counted, not coerced, and never reach cleanup/settings mutation. Disabled rows skip safely.
- Each retry-persistence failure is isolated so later claimed workspaces still run. Counters distinguish invalid claims, failed cleanup/completion and failed retry scheduling. Ambiguous writes prove neither retry scheduling nor lease release.
- Lifecycle-reported partial document/chat counts are retained even when cleanup receipts or completion scheduling fail; completed increments only after successful completion scheduling. Counts are service reports, not independent live deletion evidence.
- CLI returns nonzero for failed/invalid runs, including failed retry scheduling; settings/vector/claim failures handled inside main log exception type only and exit without raw private exception text. Cancellation propagates; import-time failures remain outside this wrapper.
- Added32 synthetic regressions covering malformed records, unsafe conversion hooks, disabled rows, retries, partial counts, claim failure, cancellation and CLI success/failure. An existing lifecycle test now requires truthful partial counts; safety/privacy assertions remain.

### Fresh verification / scope

| Check | Local result | Qualification |
| --- | --- | --- |
| Full offline backend | PASS:457tests +10subtests | Denied networking, synthetic transports |
| Isolated backend | PASS:57tests | No live provider/Storage |
| Gateway | PASS:269tests, no skips | Unchanged gateway freshly rerun |
| Script tests | PASS:68tests | Checkpoint/source fixtures |
| Foundation and ledger validator | PASS validation; closure false | Not release acceptance |
| Frontend/install/build/browser/PostgreSQL/live role/Storage/provider/local image | NOT RUN in this batch | No inherited passes |
| Exact parent a04 remote CI | FAILED mandatory image and summary;12successes/2intentional deployment skips | Independently inspected completed full raw job; not new batch scan |
| Saved-source and ZIP recovery repeats | Required before handoff | Exported results identify exact source, commands, exits and hashes; prior logs are not recovered-source passes |

Final repeated checks must bind to the saved clean commit. Restored source must be hash/mode checked and selected checks freshly reexecuted; reuse of the existing declared test environment is not a fresh dependency installation.

### Unfinished work / next bounded batch

- Ledger247rows:234OPEN_ENGINEERING,9IN_PROGRESS,1FAILED,2BLOCKED_EXTERNAL,1narrow VERIFIED. Accepted product requirements remain open at actual scope.
- Exact a04 image job114207864203 still fails:163backend package/version/advisory matches (57High/50Medium/10Low/46Negligible), frontend0. Raw SHA25654f31555ac3e6fee1f62619c2fb823a9ec1af9ff07de0702308171b100621164; original runtime markers passed but do not establish image clearance. No suppression, threshold change, prerelease substitution or merge. New source needs independent exact-head CI.
- Next implement durable retention completion fencing/retry ambiguity recovery and live lifecycle authority tests; legal hold, complete erasure receipts and remaining private-log surfaces remain unfinished. This batch does not establish distributed lease ownership or a durable deployed Python worker.
- Ten complete products, research/quality, accurate extraction/progressive execution, lawful connectors and real-role/Storage/pipeline acceptance remain engineering work, not external blockers.
- Hosted040 migration/exact candidate rollout requires scoped approval and fresh parity checks. Production authorization and processing-rights decisions remain separate. No hosted retention/deletion/migration/deployment occurred.
- Production-connected shared Preview, PR3 recovery, queues/DLQs, provider/customer data, credentials/security/DNS/paid services and contributor attribution remain untouched.

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
  --archive /data/nexusrag-checkpoints/retention-resilience-003.zip \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/results.json \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/scripts-final.log \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/gateway-final.log \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/backend-final.log \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/isolated-final.log \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/foundation-final.log \
  --log /data/nexusrag-checkpoints/retention-resilience-003-logs/ledger-final.json
sha256sum /data/nexusrag-checkpoints/retention-resilience-003.zip
```

Export the ZIP and final verification/checksum receipts as session files. Preserve each prior checkpoint until the newer checkpoint is verified and durably exported. Logs inside a recovered ZIP are historical evidence only. The next batch must rerun its acceptance checks against its saved/recovered source.
