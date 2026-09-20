"""Fail-closed recovery decisions for the zero-cost operating profile."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class FailureMode(StrEnum):
    SUPABASE_INACTIVE = "SUPABASE_INACTIVE"
    SUPABASE_READ_ONLY = "SUPABASE_READ_ONLY"
    STORAGE_PARTIAL_UPLOAD = "STORAGE_PARTIAL_UPLOAD"
    STORAGE_DELETION_FAILURE = "STORAGE_DELETION_FAILURE"
    QDRANT_OUTAGE = "QDRANT_OUTAGE"
    QDRANT_CAPACITY = "QDRANT_CAPACITY"
    GEMINI_QUOTA = "GEMINI_QUOTA"
    WORKER_EVICTION = "WORKER_EVICTION"
    DUPLICATE_DELIVERY = "DUPLICATE_DELIVERY"
    PUBLIC_API_429 = "PUBLIC_API_429"
    PROVIDER_SCHEMA_CHANGE = "PROVIDER_SCHEMA_CHANGE"
    RIGHTS_REVOCATION = "RIGHTS_REVOCATION"
    CREDENTIAL_REVOCATION = "CREDENTIAL_REVOCATION"
    MEMBERSHIP_REVOCATION = "MEMBERSHIP_REVOCATION"
    STREAM_DISCONNECT = "STREAM_DISCONNECT"
    EXPORT_INTERRUPTION = "EXPORT_INTERRUPTION"
    WORKSPACE_DELETION = "WORKSPACE_DELETION"
    INDEX_RECONSTRUCTION = "INDEX_RECONSTRUCTION"


@dataclass(frozen=True, slots=True)
class RecoveryDecision:
    state: str
    preserve: tuple[str, ...]
    action: str
    retryable: bool
    requires_review: bool


RECOVERY = {
    FailureMode.SUPABASE_INACTIVE: RecoveryDecision("PROVIDER_UNAVAILABLE", ("authentication", "export", "deletion"), "pause writes and show recovery instructions", True, True),
    FailureMode.SUPABASE_READ_ONLY: RecoveryDecision("READ_ONLY", ("authentication", "customer_evidence", "export", "deletion"), "disable mutations and queue no hidden writes", True, False),
    FailureMode.STORAGE_PARTIAL_UPLOAD: RecoveryDecision("DEGRADED", ("customer_evidence",), "tombstone partial object and retry idempotently", True, False),
    FailureMode.STORAGE_DELETION_FAILURE: RecoveryDecision("REVIEW_REQUIRED", ("deletion", "audit"), "retain deletion target and retry with receipt", True, True),
    FailureMode.QDRANT_OUTAGE: RecoveryDecision("DEGRADED", ("customer_evidence", "authorization"), "use authorized database retrieval or delay", True, False),
    FailureMode.QDRANT_CAPACITY: RecoveryDecision("CAPACITY_REACHED", ("customer_evidence", "export", "deletion"), "expire reconstructible vectors and queue reindex", True, False),
    FailureMode.GEMINI_QUOTA: RecoveryDecision("TRY_AFTER_RESET", ("customer_evidence", "authorization"), "use extractive response or delay", True, False),
    FailureMode.WORKER_EVICTION: RecoveryDecision("DEGRADED", ("customer_evidence",), "resume from durable run events", True, False),
    FailureMode.DUPLICATE_DELIVERY: RecoveryDecision("READY", ("audit",), "deduplicate by idempotency key", False, False),
    FailureMode.PUBLIC_API_429: RecoveryDecision("TRY_AFTER_RESET", ("customer_evidence",), "respect Retry-After", True, False),
    FailureMode.PROVIDER_SCHEMA_CHANGE: RecoveryDecision("PROVIDER_PAUSED", ("customer_evidence",), "quarantine connector and require mapping review", False, True),
    FailureMode.RIGHTS_REVOCATION: RecoveryDecision("RIGHTS_BLOCKED", ("customer_evidence", "audit"), "disable affected operations and invalidate caches", False, True),
    FailureMode.CREDENTIAL_REVOCATION: RecoveryDecision("PROVIDER_PAUSED", ("customer_evidence",), "disable connector until credential rotation", False, True),
    FailureMode.MEMBERSHIP_REVOCATION: RecoveryDecision("READY", ("authorization",), "increment capability revision and deny stale sessions", False, False),
    FailureMode.STREAM_DISCONNECT: RecoveryDecision("DEGRADED", ("customer_evidence",), "resume from last durable sequence", True, False),
    FailureMode.EXPORT_INTERRUPTION: RecoveryDecision("DEGRADED", ("export",), "resume idempotent package generation", True, False),
    FailureMode.WORKSPACE_DELETION: RecoveryDecision("REVIEW_REQUIRED", ("deletion", "audit"), "complete all deletion targets and receipts", True, True),
    FailureMode.INDEX_RECONSTRUCTION: RecoveryDecision("DEGRADED", ("customer_evidence",), "rebuild by workspace/version/generation", True, False),
}


def recovery_decision(mode: FailureMode) -> RecoveryDecision:
    return RECOVERY[mode]