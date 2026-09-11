#!/usr/bin/env python3
"""Offline integrity checks for the Cloudflare source foundation."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "apps/gateway/src/index.ts",
    "apps/run-coordinator/src/reducer.ts",
    "packages/contracts/src/index.ts",
    "packages/data/migrations/0001_control_plane.sql",
    "packages/retrieval/src/point-identity.ts",
    "packages/cloudflare/wrangler.preview.jsonc",
    "tests/cloudflare/foundation.test.mjs",
]

missing = [path for path in REQUIRED if not (ROOT / path).is_file()]

historical = []
for path in sorted((ROOT / "supabase/migrations").glob("*.sql"))[:13]:
    historical.append(
        {
            "file": str(path.relative_to(ROOT)),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        }
    )

passed = not missing
result = {
    "status": "PASS_SOURCE_FOUNDATION" if passed else "FAIL",
    "missing": missing,
    "verified_source_files": len(REQUIRED),
    "historical_migrations": historical,
    "limitations": [
        "This is an offline source-integrity check, not a live deployment verification.",
        "CI does not receive production credentials or perform DNS cutover.",
        "Queue, Workflow, Browser, and paid-resource availability require separate live checks.",
    ],
}
print(json.dumps(result, indent=2))
sys.exit(0 if passed else 1)
