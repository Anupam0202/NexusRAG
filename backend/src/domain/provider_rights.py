"""Rights decisions for acquisition, AI use, storage and distribution."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class RightsAction(StrEnum):
    FETCH = "fetch"
    STORE = "store"
    CACHE = "cache"
    EMBED = "embed"
    AI_PROCESS = "ai_process"
    DISPLAY = "display"
    EXPORT = "export"
    REDISTRIBUTE = "redistribute"
    API_SERVE = "api_serve"
    MCP_SERVE = "mcp_serve"
    MONITOR = "monitor"


class RightsDecision(StrEnum):
    ALLOW = "ALLOW"
    ALLOW_WITH_DUTIES = "ALLOW_WITH_DUTIES"
    DENY = "DENY"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


@dataclass(frozen=True, slots=True)
class ProviderRights:
    provider_id: str
    approved_actions: frozenset[RightsAction] = frozenset()
    prohibited_actions: frozenset[RightsAction] = frozenset()
    review_actions: frozenset[RightsAction] = frozenset()
    attribution: tuple[str, ...] = ()
    terms_hash: str = ""
    terms_checked_at: str = ""
    status: str = "UNKNOWN"
    metadata: dict[str, str] = field(default_factory=dict, compare=False, hash=False)

    def __post_init__(self) -> None:
        overlap = self.approved_actions & self.prohibited_actions
        if overlap:
            raise ValueError(f"Conflicting rights actions: {sorted(overlap)}")
        if self.status.startswith("APPROVED") and (not self.terms_hash or not self.terms_checked_at):
            raise ValueError("Approved providers require dated terms evidence")


@dataclass(frozen=True, slots=True)
class RightsResult:
    decision: RightsDecision
    duties: tuple[str, ...]
    reason: str


def decide(policy: ProviderRights, action: RightsAction) -> RightsResult:
    if policy.status in {"DISABLED", "DEPRECATED"}:
        return RightsResult(RightsDecision.DENY, (), f"Provider status is {policy.status}")
    if policy.status in {"UNKNOWN", "LEGAL_REVIEW", "PRIVACY_REVIEW", "SECURITY_REVIEW"}:
        return RightsResult(RightsDecision.REVIEW_REQUIRED, (), f"Provider status is {policy.status}")
    if action in policy.prohibited_actions:
        return RightsResult(RightsDecision.DENY, (), f"{action.value} is explicitly prohibited")
    if action in policy.review_actions or action not in policy.approved_actions:
        return RightsResult(RightsDecision.REVIEW_REQUIRED, (), f"{action.value} requires review")
    duties = tuple(dict.fromkeys(policy.attribution))
    if duties:
        return RightsResult(RightsDecision.ALLOW_WITH_DUTIES, duties, "Action permitted with duties")
    return RightsResult(RightsDecision.ALLOW, (), "Action explicitly permitted")


def require_allowed(policy: ProviderRights, *actions: RightsAction) -> tuple[str, ...]:
    duties: list[str] = []
    for action in actions:
        result = decide(policy, action)
        if result.decision not in {RightsDecision.ALLOW, RightsDecision.ALLOW_WITH_DUTIES}:
            raise PermissionError(f"{policy.provider_id}:{action.value}:{result.decision.value}")
        duties.extend(result.duties)
    return tuple(dict.fromkeys(duties))
