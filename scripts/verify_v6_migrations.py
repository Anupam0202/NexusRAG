#!/usr/bin/env python3
"""Offline migration-source integrity checks for the V6 foundation branch."""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
REQUIRED = [
    "014_identity_visibility_policy.sql",
    "014a_private_conversation_authorizer.sql",
    "015_versions_fenced_jobs.sql",
    "016_credentials_usage_lifecycle.sql",
    "017_workbench_upload_publication.sql",
    "018_durable_query_runs.sql",
    "019_workbench_interfaces.sql",
    "020_workbench_operations.sql",
    "021_v6_evidence_governance_foundations.sql",
    "022_v6_rights_quota_interfaces.sql",
    "023_private_storage_authorization.sql",
]
SECRET_PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "google_api_key": re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
    "supabase_secret": re.compile(r"sbp_[0-9A-Za-z]{20,}"),
    "jwt": re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}"),
    "email_address": re.compile(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"),
    "credentialed_url": re.compile(r"(?i)https?://[^\s/:]+:[^\s/@]+@"),
    "secret_assignment": re.compile(r"(?i)(?:api[_-]?key|token|secret|password)\s*[:=]\s*['\"][^'\"]+['\"]"),
}


def fail(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    missing = [name for name in REQUIRED if not (MIGRATIONS / name).is_file()]
    if missing:
        fail(f"missing required migration sources: {', '.join(missing)}")

    seen: set[str] = set()
    inventory: list[tuple[str, str]] = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        key = path.name.casefold()
        if key in seen:
            fail(f"duplicate migration filename: {path.name}")
        seen.add(key)
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        if not text.strip():
            fail(f"empty migration: {path.name}")
        if "\x00" in text:
            fail(f"NUL byte in migration: {path.name}")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                fail(f"suspected {label} in {path.name}")
        inventory.append((path.name, hashlib.sha256(raw).hexdigest()))

    migration_023 = (MIGRATIONS / REQUIRED[-1]).read_text(encoding="utf-8").casefold()
    required_023 = (
        "'documents','documents',false,25000000",
        "u.original_key=p_name",
        "v.publication_state='ready'",
        "drop policy if exists \"storage_documents_delete_editors\"",
        "grant execute on function public.claim_expired_document_uploads(integer) to service_role",
    )
    for fragment in required_023:
        if fragment not in migration_023:
            fail(f"migration 023 missing contract fragment: {fragment}")

    print(f"verified_migrations={len(inventory)}")
    for name, digest in inventory:
        if name in REQUIRED:
            print(f"{digest}  {name}")


if __name__ == "__main__":
    main()
