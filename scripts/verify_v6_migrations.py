#!/usr/bin/env python3
"""Deterministic offline integrity checks for the reviewed V6 migration chain.

This verifier intentionally rejects retired 014/015-022 source names and pins
all retained sources by Git blob SHA-1. It validates source integrity; a clean
single-file baseline and destructive production rebuild remain separate gates.
"""
from __future__ import annotations

import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
EXPECTED_BLOBS = {
    "001_core_schema.sql": "02b4c7434b1c6b58f62938761859f867a266115f",
    "002_rls_policies.sql": "da082e5c2dd00bfbc0403b0aaef83e6dc24e3c50",
    "003_indexes.sql": "2e1b7288448f168036e203f43ac5fb47128da74d",
    "004_runtime_settings_telemetry.sql": "d1afc3a636dedd281fda13d4eb99e0f936483559",
    "005_pgvector_fallback.sql": "21bb333007235e50caeb6c5206d648764e19ad92",
    "006_pgvector_retrieval_filters.sql": "7e6f7820bbc0081d44fd85839e0fadd770ef382d",
    "007_security_hardening.sql": "dfb056a879b593aab9d8cef4cff82eb5dd0545dc",
    "008_provider_health_state.sql": "1f37150aba3dc856185761db45cad6237e175bd1",
    "009_supabase_advisor_hardening.sql": "43d3610919a64788de552a2ca6f542aac184e1ee",
    "010_move_vector_extension.sql": "c23442a750520c17c9cbe6e0b6d6e7e9a94ea5e6",
    "011_durable_queue_billing_retention.sql": "587a28572974aa0741c603721fb64175fabae19d",
    "012_backfill_existing_auth_profiles.sql": "c94f7cb35c79eb55fda2af5ccb61338bc9a1841a",
    "013_allow_workspace_member_cascade_delete.sql": "943392d3675c78c78029adec337260eb32c97056",
    "014a_private_conversation_authorizer.sql": "5ece32ee719fea529ac99f42cbebf7b4bba6c73e",
    "023_private_storage_authorization.sql": "9cd7f4550ba185e014d056594388ccf909986044",
    "024_explicit_service_table_denies.sql": "2ba2edd3e9d87be7219d11c23a5f8c2b27018894",
    "025_function_execution_hardening.sql": "644f116430a4a4e662ab77112141fa1a3cfe224a",
}
RETIRED = {
    "014_identity_visibility_policy.sql",
    "015_versions_fenced_jobs.sql",
    "016_credentials_usage_lifecycle.sql",
    "017_workbench_upload_publication.sql",
    "018_durable_query_runs.sql",
    "019_workbench_interfaces.sql",
    "020_workbench_operations.sql",
    "021_v6_evidence_governance_foundations.sql",
    "022_v6_rights_quota_interfaces.sql",
}
EXPECTED_TABLES = {
    "profiles", "workspaces", "workspace_members", "documents", "document_chunks",
    "ingestion_jobs", "chat_sessions", "chat_messages", "llm_usage_events",
    "audit_events", "workspace_settings", "api_keys", "eval_runs", "eval_results",
    "provider_health_state", "workspace_usage_daily", "conversation_participants",
    "workspace_policy_versions", "document_versions", "workbench_outbox",
    "usage_reservations", "usage_ledger", "deletion_operations", "deletion_targets",
    "document_uploads", "query_runs", "query_run_sources", "query_events", "findings",
    "finding_versions", "finding_participants", "finding_reviews", "workbench_mutations",
    "provider_registry", "workspace_provider_policies", "resource_budgets",
    "budget_reservations", "evidence_sources", "evidence_source_versions",
    "evidence_items", "graph_entities", "graph_aliases", "graph_relationships",
    "monitors", "monitor_runs", "cache_entries", "materializations", "evidence_exports",
    "deletion_receipts", "provider_terms_snapshots", "rights_decisions",
}
SECRET_PATTERNS = {
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "google_api_key": re.compile(r"AIza[0-9A-Za-z_-]{30,}"),
    "supabase_secret": re.compile(r"(?:sbp_|sb_secret_)[0-9A-Za-z_-]{20,}"),
    "jwt": re.compile(r"eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}"),
    "credentialed_url": re.compile(r"(?i)https?://[^\s/:]+:[^\s/@]+@"),
    "supabase_project_url": re.compile(r"https://[a-z0-9]{16,}\.supabase\.co", re.I),
    "secret_assignment": re.compile(
        r"(?i)(?:api[_-]?key|token|secret|password)\s*[:=]\s*['\"][^'\"]+['\"]"
    ),
}


def fail(message: str) -> None:
    raise SystemExit(message)


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def require_fragments(name: str, fragments: tuple[str, ...]) -> None:
    text = (MIGRATIONS / name).read_text(encoding="utf-8").casefold()
    for fragment in fragments:
        if fragment not in text:
            fail(f"{name} missing contract fragment: {fragment}")


def main() -> None:
    actual = {p.name for p in MIGRATIONS.glob("*.sql")}
    expected = set(EXPECTED_BLOBS)
    if actual & RETIRED:
        fail(f"retired migration sources present: {', '.join(sorted(actual & RETIRED))}")
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        fail(f"migration inventory mismatch; missing={missing}; unexpected={unexpected}")

    aggregate: list[str] = []
    for name, expected_blob in EXPECTED_BLOBS.items():
        path = MIGRATIONS / name
        raw = path.read_bytes()
        if not raw.strip() or b"\x00" in raw:
            fail(f"empty or invalid migration: {name}")
        actual_blob = git_blob_sha(raw)
        if actual_blob != expected_blob:
            fail(f"content drift in {name}: expected {expected_blob}, got {actual_blob}")
        text = raw.decode("utf-8")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                fail(f"suspected {label} in {name}")
        aggregate.append(text)

    joined = "\n".join(aggregate).casefold()
    created = set(re.findall(r"create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)", joined))
    if created != EXPECTED_TABLES:
        fail(
            "public table contract mismatch; "
            f"missing={sorted(EXPECTED_TABLES-created)}; unexpected={sorted(created-EXPECTED_TABLES)}"
        )

    require_fragments(
        "023_private_storage_authorization.sql",
        (
            "'documents','documents',false,25000000",
            "u.original_key=p_name",
            "v.publication_state='ready'",
            "drop policy if exists \"storage_documents_delete_editors\"",
            "grant execute on function public.claim_expired_document_uploads(integer) to service_role",
        ),
    )
    require_fragments(
        "024_explicit_service_table_denies.sql",
        (
            "as restrictive for all to anon,authenticated using(false) with check(false)",
            "revoke all privileges on table public.%i from anon,authenticated",
            "enable row level security",
        ),
    )
    require_fragments(
        "025_function_execution_hardening.sql",
        (
            "revoke execute on function public.match_document_chunks(extensions.vector, uuid, integer, jsonb)",
            "revoke execute on function public.set_updated_at()",
            "revoke execute on function public.uuid_or_null(text)",
            "has_function_privilege('anon'",
            "has_function_privilege('authenticated'",
        ),
    )
    for fragment in (
        "create schema if not exists nexusrag_private",
        "enable row level security",
        "security definer",
        "set search_path",
        "workbench_turn_order",
        "zero_cost_low_traffic",
        "rights_decisions",
        "provider_terms_snapshots",
    ):
        if fragment not in joined:
            fail(f"migration chain missing foundation contract: {fragment}")

    print(f"verified_migrations={len(EXPECTED_BLOBS)}")
    print(f"verified_public_tables={len(EXPECTED_TABLES)}")
    print("retired_dependencies=0")
    for name, digest in EXPECTED_BLOBS.items():
        print(f"{digest}  {name}")


if __name__ == "__main__":
    main()
