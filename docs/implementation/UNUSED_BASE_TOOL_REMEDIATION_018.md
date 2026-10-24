# Unused Base Runtime Tool Remediation

Application PARTIAL_NOT_COMPLETE. Narrow supported dependency-removal candidate,
not actual image acceptance or complete product/security certification.

## Finding And Enforcement Boundary

Actual parent017 image scan116backend matches includes nine Go stdlibgo1.26.7
matches,1Critical/7High/1Unknown, all at/usr/bin/pebble. No application consumer
invokes that launcher; package matches do not prove reachable exploitation.
The other107matches,101Medium/6Low, are independent. Current official Go fixes
exist, but adding a Go toolchain/rebuilding an unused launcher expands scope.
Remove the unused dependency only after inspecting its real image boundary.

The final stage starts from the pinned base again; builder-only removal would
miss the shipped file. Package operations precede the guarded final-stage
removal. Do not strip package metadata or libraries to conceal findings.

## Actual Base Evidence

Pinned Ubuntu26.04 indexf144425ff09be612d6d9ad965196e9cdc23dae1f42110a8a11a3e9a8198759f7
linuxamd64 manifest88a381d5b5eeb2b35d3ad70925a362c37ce569daf43ede89ff818ec20e4d3794;
config6e92c4fd8dfdf7276d56743a65002a91c9eb35dbe7af327e6c85bd204b646156
bytes independently verified; ENTRYPOINTnull,CMDbash. Exact main layer
4e07a0f12b2c009f98326fa391e869bd52fc63728c482400af6cb752bc16744b
contains one regular0755 file9,949,346bytes, SHA256
5e33a1304f207bb275b1b4cc3dc4c05fdd88755f5c705e2fd569924ec72dc061.
No identical copies/named aliases/dpkg-list owner or inspected package/service
hook references found. /bin aliases usr/bin. Exact tail layer
06ad70e463aa4a17833d00d6d5d346c895ebb66fee637eefd67024dc6cdc2f1c
contains only .rock metadata. Nothing was extracted or executed. This pre-build
inspection does not substitute for post-upgrade ownership or merged-image scan.

Fresh independent source/compatibility investigation found no tracked caller,
compose/CI command, ingestion/evaluation/job/retention or accepted optional mode
that invokes Pebble. Scientific/retrieval modes use preserved Python libraries.
Unsupported research-plan execution remains unfinished; this removal neither
implements it nor discards accepted capability. All224definitions/tenproducts
remain. Default Uvicorn startup, shell PORT expansion and Python overrides stay.

## Candidate And Verification

Docker final stage requires a regular nonsymlink file and exact known binary
hash. dpkg-query must report no owner with exit1; a package owner or other error
fails the build. Then remove only/usr/bin/pebble. Current base/builder/dpkg
metadata/native libraries remain untouched. A future binary/base/package change
must be reviewed rather than silently accepted. No wildcard or rm-force bypass.

Actual native probe requires merged/usr/bin and/bin paths to be absent even for
dangling symlinks, and no PATH command. Full unsuppressed scan must prove the
nine affected Go matches absent at every surviving location. Base-layer removal
from the merged runtime does not make the inherited public base/builder patched.
Existing complete OS provenance and Medium+ security rejection remain intact.

Real CI additionally exercises8087PORT default-command startup with no network,
tracks its own extra container in cleanup, and preserves default8000liveness.
Existing exactPython3.14.8/Ubuntu26.04/native Decimal/ormsgpack/CPU Torch/FAISS,
pinned neural, FFmpeg absence, PDF/image, backend suite and frontend checks stay.
Liveness remains NOT_PROBED, never provider readiness or private acceptance.

Two new source guards fail against parent; ten focused and87script tests pass
with the candidate. Bash syntax/Python compile pass. These are source assertions,
not actual binary removal or complete compatibility. Docker is unavailable
locally; exact source image CI, full recovery and fresh checks remain required.

One fresh read-only candidate reviewer failed on account usage limit before
returning findings. No agent retry loop. Parent performed a separate bypass/
regression review and retained that limitation, not independent review clearance.
No concrete source issue found in that separate pass; actual gates still apply.

## Scope And Continued Work

Approved013 rehearsal installation is fulfilled in017 and excludes any other
migration, deployment, production/customer-history operation or provider request.
This batch has no hosted operation. Keep existing draftPR12/canonical branch;
never merge failed required gates to reduce branch count. Preserve all previous
source/evidence failures, real locks/specifications and recovery checkpoints.

Unfixed OS/zlib/image findings, private caller-bound writes/revisions/cache,
lifecycle/legal holds/independent Qdrant erasure, real authorized two-user flows,
full product workflows, rights/budgets/source-schema-origin and release/rollback
acceptance remain unfinished. Finish exact-image/checkpoint evidence and continue
independent engineering. No PRODUCTION_READY or universal defect-free claim.

Official references: [Go releases](https://go.dev/doc/devel/release),
[GO-2026-6612](https://pkg.go.dev/vuln/GO-2026-6612).
