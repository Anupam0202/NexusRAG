# NexusRAG execution checkpoint

## Batch: checkpoint-protocol-001

**Application: PARTIAL_NOT_COMPLETE. Batch: locally tested checkpoint tooling; no hosted deployment or production verification.**

Full accepted implementation/cleanup scope remains in force. The normative requirement register and `docs/implementation/execution-ledger.json` remain authoritative for product closure. This file is the current execution/recovery handoff, not another claim that the product is complete.

### Source identity and start inspection

- Started from clean published `019fa7cd541721a0b6ff63e6461afec34a684488`, PR8 review branch `release/production-candidate-redaction`.
- Before edits, inspected the saved publication manifest and independently matched its four file hashes against that checkout. No workspace reset or summary-based reconstruction was needed.
- Protected main remains `85b14f131f5eacb07082a32c7173f20be472772f`; do not force-push or bypass checks.
- The exported ZIP's `.checkpoint/manifest.json` records the exact final commit and SHA256/size/mode of **every tracked source file**, including this file and all tracked lockfiles. The only tracked dependency lockfile at this checkpoint is `frontend/package-lock.json`; backend dependency specifications are retained, not mislabeled as a lockfile.
- Publish/save the batch source before export. Export refuses dirty/untracked work rather than silently omitting it. Ignored files, installed dependencies, `.git`, credentials and caches are not included.

### Completed changes in this batch

- Added `scripts/checkpoint_source.py`: clean-source ZIP export, per-file/log integrity verification, duplicate/missing/unexpected/unsafe entry rejection, bounded archive sizes, executable mode preservation and explicit log selection.
- Recovery requires the trusted external ZIP SHA256 and a **new** destination. Internal manifest hashes alone do not authenticate a self-consistent forged ZIP. No existing source is overwritten; no downloaded code is executed by recovery.
- Added nine isolated checkpoint tests, including complete source/lock/log round trip, ignored-file exclusion, dirty/untracked refusal, symlink/path denial, tampering and trusted-checksum enforcement.
- Added this run-state protocol. No application/runtime/provider/schema/security setting was changed in this batch.

### Verification status

These are fresh batch checks, not inherited browser/build passes. After publication the same commands are rerun against the clean saved source before the final ZIP is exported. Exact exits, source identity and log hashes are exported with the checkpoint; if a rerun differs, do not report this batch as passed.

| Check | Fresh local result | Scope |
| --- | --- | --- |
| `python3 -m unittest discover -s tests/scripts` | PASS: 68 tests, including nine new checkpoint cases | Offline script/source fixtures |
| `npm run test:cloudflare` | PASS: 269 tests, no skips | Offline gateway fixtures |
| `python backend/scripts/run_full_tests.py` | PASS: 409 tests plus 10 subtests | Denied-network offline backend |
| `python scripts/run_isolated.py` from backend | PASS: 57 tests | Isolated backend |
| Frontend `npm test` | PASS: 283 tests / 48 files | Unit/component fixtures |
| Frontend lint and TypeScript | PASS | Current source and installed dependencies |
| `npm run check:cloudflare` and ledger validator | PASS validation; release closure remains false | Static foundation/traceability, not deployment |
| New clean installs/builds/browser/PostgreSQL/live OAuth/role/Storage/provider pipelines | NOT RUN in this checkpoint-tooling batch | Prior results remain historical, not new acceptance |
| Mandatory actual-image security | Latest completed prior gate FAILED on exact2ef; exact019 image job still pending at observation | Never inherit a previous scan as a new-head result |
| Final ZIP verify/full-source recovery round trip | Must pass before exported checkpoint is handed off | Recorded in exported verification logs; not a product test |

No known failing local test is concealed. No scanner suppression, weakened threshold/baseline or branch-protection bypass.

### Unfinished work and boundaries

- Ledger remains 245 entries:234 OPEN_ENGINEERING,7 IN_PROGRESS,1 FAILED,2 BLOCKED_EXTERNAL,1 narrowly VERIFIED. Do not close requirements merely because code or a checkpoint exists.
- Next bounded engineering batch: independently inspect exact-head image/security logs and actual maintained runtime remediation; retain unsuppressed native/neural/image gates. CPython CNA/scanner/tagged-source discrepancies need reconciliation, not automatic waivers.
- Complete products/research/retrieval quality, accurate extraction, progressive execution, lifecycle/retention/legal hold, lawful connectors and real-role/Storage/pipeline acceptance remain unfinished engineering.
- Hosted migration040 and exact candidate frontend/gateway rollout require specific scoped approval and fresh binding/schema/source checks; production authorization and processing rights remain separate. Last qualified candidate/rehearsal are older source/schema039, not this commit.
- Shared production-connected Preview, reversible PR3 recovery, queues/DLQs and provider data remain untouched. Platform resource cleanup must follow inventory, dependencies, recovery and explicit destructive approval.
- Contributor cleanup remains deferred until the broader implementation is completed, with honest attribution/history handling.

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
# Use the documented backend test environment; do not activate provider secrets.
python backend/scripts/run_full_tests.py
(cd backend && python scripts/run_isolated.py)
(cd frontend && npm ci --ignore-scripts && npm run lint && npm test \
  && npm exec tsc -- --noEmit && npm run build && npm run cf:build)
```

For next remote inspection use GitHub MCP `pull_request_read` methods `get` and `get_check_runs`, owner `Anupam0202`, repo `NexusRAG`, pullNumber8. Capture the actual head SHA; inspect completed image logs on that SHA, not an older job. Never use this document to authorize a hosted/deletion operation.

## End-of-batch export

Update this file with the actual completed/unfinished work and passed/failed/not-run checks. Save source and dependency specifications/locks, verify the clean saved tree, then export outside the repository. Select only sanitized verification logs, never private tokens, signed log URLs, customer data or credential-bearing command payloads.

```bash
cd /data/NexusRAG-current
python3 scripts/checkpoint_source.py export \
  --archive /data/nexusrag-checkpoints/checkpoint-protocol-001.zip \
  --log /data/nexusrag-checkpoints/protocol-001-logs/results.json \
  --log /data/nexusrag-checkpoints/protocol-001-logs/scripts-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/gateway-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/backend-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/isolated-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/frontend-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/lint-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/types-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/foundation-final.log \
  --log /data/nexusrag-checkpoints/protocol-001-logs/ledger-final.json
sha256sum /data/nexusrag-checkpoints/checkpoint-protocol-001.zip
```

Export the ZIP and final verification/checksum receipts as session files. Preserve each prior checkpoint until the newer checkpoint is verified and durably exported. Logs inside a recovered ZIP are historical evidence only. The next batch must rerun its acceptance checks against its saved/recovered source.
