# Supported Runtime Remediation Candidate

Application PARTIAL_NOT_COMPLETE. Not deployed or image-security cleared.

## Initial Candidate And Historical Evidence

Exact015 image114710618704 and requiredsummary114717849869 failed163backend
advisory/package matches across40packages/69advisories, including57High/50Medium;
frontend0,ignored0. The full installed-package receipt is preserved in the015
checkpoint. Package matching is not proof of every reachable application exploit.
The unsuppressed medium gate nevertheless remains binding.

Official Ubuntu LTS status offers maintained fixes for some stable-Debian glibc
findings. A reviewed same-LTS builder/runtime avoids copying a Debian interpreter
or ABI-specific venv into Ubuntu. Ubuntu26.04 is digest pinned, not an unstable
release or external PPA. Stable CPython3.15.0 is built from the official release,
whose actual source bytes match the published SHA256. CPU Torch2.14.1 has a
published cp315 Linux wheel; its installation and runtime compatibility still
need actual image execution. Existing project dependency specifications remain.

- [Ubuntu lifecycle](https://ubuntu.com/about/release-cycle)
- [Ubuntu glibc5435](https://ubuntu.com/security/CVE-2026-5435)
- [Debian glibc5435](https://security-tracker.debian.org/tracker/CVE-2026-5435)
- [Stable Python3.15.0](https://www.python.org/downloads/release/python-3150/)
- [Official CPU Torch index](https://download.pytorch.org/whl/cpu/torch/)

zlib85091 remains affected/deferred, including supported Ubuntu and stable Debian.
Neither selecting another distribution, no-dsa status, apparent nonuse nor
runtime success is a waiver. No current claim that this candidate fixes all
findings or passes the image gate; new exact installed-image scan is mandatory.

- [Ubuntu zlib85091](https://ubuntu.com/security/CVE-2026-85091)
- [Debian zlib85091](https://security-tracker.debian.org/tracker/CVE-2026-85091)

## Preserved Contracts And Verification

Parent and independent read-only investigator traced interpreter/venv/native ABI,
OpenMP, TLS/crypto, parser resource guards, SQLite/compression, embedding revision,
FAISS persistence and scientific/image APIs. No safe transitive removal proof for
SQLite/readline/curses; retain their extension dependencies. No original native
test, required gate, package database, private temp or non-root control removed.

New exact image probe exercises selected standard libraries, TLS trust, CPU Torch,
NumPy/FAISS interoperability and real FAISS persistence/reload, exact interpreter/
OS and private-temp UID/mode. It joins original real pinned384 neural embeddings,
PDF/image extraction/rendering, headless/FFmpeg exclusion, full backend tests,
OS/Python inventory, pip audit, liveness and unsuppressed actual-image scans.

Two new source guards fail on015 before implementation; these are missing
candidate/gate-contract assertions, not new exploit reproductions. Five source
container tests pass after changes; local Docker is unavailable. An initial
whole-word-check harness accidentally matched sid inside a normal comment and
was corrected to a word-boundary regex. The intended unstable-release invariant
is unchanged. Binary-only cp315 dependency resolution fails on a missing PyYAML
wheel; the source builder may compile it, but no passing compatibility claim
follows. Source guards/syntax cannot replace exact image execution.

Independent read-only candidate review completed one cycle. Parent confirmed its
native-decimal compatibility finding against the official Python3.15 configure
documentation: no implicit bundled-library fallback remains. System libmpdec-dev,
explicit --with-system-libmpdec and runtime libmpdec4 now preserve the accelerator.
An added guard failed before correction; six container guards pass. The actual
image probe requires decimal.Decimal is _decimal.Decimal and the real auditable
calculation helper's bounded high-precision/evidence result. The review's substitute
benchmark is not an image benchmark or production performance acceptance.

- [Python decimal build contract](https://docs.python.org/3.15/using/configure.html#cmdoption-with-system-libmpdec)
- [Ubuntu mpdecimal package family](https://packages.ubuntu.com/mpd)

Fresh source585backend+10subtests,357frontend/51files,371gateway/zero skips,
57isolated,82scripts,lint/typecheck,Next/OpenNext25assets,actual synthetic local
Worker,migration/ledger/foundation and Bash/Python syntax PASS. These checks use
the existing local test interpreter, not proof of actual native Python3.15 runtime.
Source save, complete recovery and exact CI outcomes belong in later immutable
handoff receipts. Semantic encoders/
cross-encoders, old local volumes and full scientific/research modes are not
certified merely by the one pinned embedding/native smoke. No security finding
will be labeled fixed before applicable real gates pass.

## Boundaries

Initial saved b68c1ed/tree295f9f4 complete532-source ZIP SHA256
ef703a44d4b534bf9f922111a216ac42d2445cdb91c2f4856214170afc86eb4b
was independently recovered with actual hashes/sizes/archive/index modes, fresh
dependencies and full tests/builds. Exact public frontend139checks and synthetic
PostgreSQL concurrency/backuprestore PASS. Actual image114789865462 and required
summary114796844726 FAILED before both scans: OpenCV CMake could not import NumPy,
marked python3 unavailable, then packaging failed on missing config-3.py. No new
image descriptor/findings or native Python3.15 acceptance exists for this head.

The original hash-verified5.0.0.93 pyproject pins NumPy through3.14 but omits3.15.
An explicit one-line vendor build-metadata patch adds NumPy2.5.3 only for3.15;
official cp315 Linux wheel metadata inspected. Original source hash checked before
zero-fuzz, fail-on-mismatch patch application. Normal PEP517 build isolation,
source verification and FFmpeg-disabled/native/security gates remain intact.
Real patch/TOML/PEP508 rehearsal verifies prior3.12/3.13/3.14 constraints unchanged.
New guard fails before correction; seven focused/83script guards pass afterward.
Corrected exact-source image/scan and new full recovery are required, not inferred.

## Supported Dependency ABI Correction

Corrected5f8abc5 actual image114801141761 built OpenCV successfully, then failed
installing ormsgpack1.12.2 through langgraph-checkpoint. Verified upstream source
SHA256944a2233640273bee67521795a73cf1e959538e0dfb7ac635505010455e53b33
requires PyO3^0.27.2 and build-config^0.27.0; real build rejects Python3.15.
Current published wheels/classifiers stop at3.14. No forward-ABI suppression,
unreviewed vendor port or removal of accepted checkpoint capabilities is used.
Both actual scan results are UNAVAILABLE, not zero vulnerabilities. Exact
frontend139public checks/syntheticPG concurrency and new533-source recovery pass.

Current source selects the official supported3.14.8 security maintenance release,
whose actual tar.xz bytes match published SHA256
c2215904f02b175596dc49351585104f4bc20341e1c47378b26a2c274360ce73.
OfficialCPU Torch2.14.1 cp314 Linux wheel metadata inspected. Pinned same-LTS
builder/runtime and native Decimal correction retained. OpenCV's original3.14
metadata requires no vendor patch; the3.15-only patch is obsolete in this source,
but preserved with both failed heads in immutable complete archives. Build
isolation, FFmpeg exclusion, real model/FAISS/native and unsuppressed image gates
remain unchanged. Native probe adds real ormsgpack checkpoint serialization.
The new ABI guard fails before correction, eight focused guards pass after.
Actual build/runtime/scan and full fresh recovery remain required for this source;
no security clearance or production acceptance is inferred from supported wheels.

- [Python3.14.8 security release/source checksum](https://www.python.org/downloads/release/python-3148/)
- [Published ormsgpack releases](https://pypi.org/project/ormsgpack/)
- [PyO3 supported ABI documentation](https://pyo3.rs/main/features)

- [pip build isolation](https://pip.pypa.io/en/stable/reference/build-system/)
- [OpenCV manual source builds](https://github.com/opencv/opencv-python#manual-builds)

No deployment, hosted migration, provider/customer operation, rights/quota
change, paid activation, branch-protection bypass or release gate relaxation.
All224 requirements and ten products remain accepted. Private authority, hosted
rollout, actual two-user workflows, lifecycle/legal holds/erasure receipts,
Qdrant post-delete proof and complete product workflows remain unfinished.
Managed security artifacts preserve investigation and failed preflight evidence;
the next complete checkpoint records source/recovery and final CI separately.
