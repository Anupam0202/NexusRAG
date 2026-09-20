"""Capability-scoped API/MCP operation manifest and admission checks."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Capability(StrEnum):
    EVIDENCE_READ = "evidence:read"
    RESEARCH_RUN = "research:run"
    FINDING_READ = "finding:read"
    FINDING_WRITE = "finding:write"
    MONITOR_READ = "monitor:read"
    MONITOR_WRITE = "monitor:write"
    OBLIGATION_READ = "obligation:read"
    OBLIGATION_REVIEW = "obligation:review"
    PROCUREMENT_READ = "procurement:read"
    COUNTERPARTY_READ = "counterparty:read"
    PASSPORT_READ = "passport:read"
    PASSPORT_WRITE = "passport:write"
    EXPORT_CREATE = "export:create"
    ADMIN_USAGE = "admin:usage"


@dataclass(frozen=True, slots=True)
class OperationContract:
    name: str
    capability: Capability
    max_results: int
    deadline_ms: int
    rate_limit_per_minute: int
    idempotent: bool
    rights_action: str
    audit_event: str
    destructive: bool = False

    def __post_init__(self) -> None:
        if not self.name or self.max_results < 1 or self.max_results > 200:
            raise ValueError("Operations require a bounded result limit")
        if not 100 <= self.deadline_ms <= 120_000:
            raise ValueError("Operation deadline is outside the low-traffic contract")
        if self.rate_limit_per_minute < 1:
            raise ValueError("Operation rate limit is required")
        if self.destructive:
            raise ValueError("Autonomous destructive MCP operations are prohibited")


OPERATIONS = (
    OperationContract("evidence.search", Capability.EVIDENCE_READ, 50, 30_000, 30, True, "api_serve", "evidence.search"),
    OperationContract("claim.get", Capability.EVIDENCE_READ, 50, 10_000, 60, True, "api_serve", "claim.get"),
    OperationContract("citation.get", Capability.EVIDENCE_READ, 50, 10_000, 60, True, "api_serve", "citation.get"),
    OperationContract("entity.lookup", Capability.COUNTERPARTY_READ, 50, 20_000, 30, True, "mcp_serve", "entity.lookup"),
    OperationContract("relationship.lookup", Capability.COUNTERPARTY_READ, 100, 20_000, 30, True, "mcp_serve", "relationship.lookup"),
    OperationContract("obligation.lookup", Capability.OBLIGATION_READ, 50, 20_000, 30, True, "mcp_serve", "obligation.lookup"),
    OperationContract("procurement.lookup", Capability.PROCUREMENT_READ, 50, 30_000, 20, True, "mcp_serve", "procurement.lookup"),
    OperationContract("passport.get", Capability.PASSPORT_READ, 20, 20_000, 30, True, "mcp_serve", "passport.get"),
    OperationContract("finding.get", Capability.FINDING_READ, 50, 10_000, 60, True, "mcp_serve", "finding.get"),
    OperationContract("monitor.status", Capability.MONITOR_READ, 50, 10_000, 60, True, "mcp_serve", "monitor.status"),
    OperationContract("evidence_package.create", Capability.EXPORT_CREATE, 20, 60_000, 10, True, "export", "export.create"),
    OperationContract("research.execute", Capability.RESEARCH_RUN, 20, 120_000, 5, True, "ai_process", "research.execute"),
)


def authorize_operation(
    operation_name: str,
    *,
    workspace_id: str,
    granted_capabilities: frozenset[Capability],
    requested_results: int,
    deadline_ms: int,
    idempotency_key: str | None,
) -> OperationContract:
    if not workspace_id:
        raise PermissionError("Workspace binding is required")
    contract = next((item for item in OPERATIONS if item.name == operation_name), None)
    if contract is None:
        raise LookupError("Unknown operation")
    if contract.capability not in granted_capabilities:
        raise PermissionError("Capability denied")
    if requested_results < 1 or requested_results > contract.max_results:
        raise ValueError("Result limit exceeded")
    if deadline_ms > contract.deadline_ms:
        raise ValueError("Deadline exceeds operation contract")
    if contract.idempotent and not idempotency_key:
        raise ValueError("Idempotency key is required")
    return contract