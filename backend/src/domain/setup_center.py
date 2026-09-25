"""Actionable Setup Center checks with cost and permission disclosures."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class SetupState(StrEnum):
    READY = "READY"
    DEGRADED = "DEGRADED"
    BLOCKED = "BLOCKED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    NOT_APPLICABLE = "NOT_APPLICABLE"


@dataclass(frozen=True, slots=True)
class SetupCheck:
    check_id: str
    state: SetupState
    explanation: str
    safe_verification: str
    remediation: str
    required_permission: str
    can_incur_cost: bool

    def __post_init__(self) -> None:
        if not all((
            self.check_id,
            self.explanation,
            self.safe_verification,
            self.remediation,
            self.required_permission,
        )):
            raise ValueError("Setup checks must be actionable")


CHECK_IDS = (
    "CLOUDFLARE_FRONTEND", "CLOUDFLARE_GATEWAY", "SUPABASE_PROJECT",
    "SUPABASE_AUTH", "SUPABASE_RLS", "SUPABASE_STORAGE", "QDRANT", "GEMINI",
    "QUEUE", "WORKFLOW", "BROWSER_RUN", "OAUTH_CALLBACKS", "CONNECTOR_RIGHTS",
    "INDEX_GENERATION", "DOMAIN", "OBSERVABILITY", "FREE_BUDGETS", "EXPORT",
    "DELETION",
)


def validate_setup(checks: tuple[SetupCheck, ...]) -> None:
    ids = tuple(check.check_id for check in checks)
    if len(ids) != len(set(ids)):
        raise ValueError("Setup checks must be unique")
    unknown = set(ids) - set(CHECK_IDS)
    if unknown:
        raise ValueError(f"Unknown setup checks: {sorted(unknown)}")