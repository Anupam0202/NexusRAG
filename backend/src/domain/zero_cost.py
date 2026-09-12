"""Fail-closed admission control for the ZERO_COST_LOW_TRAFFIC profile."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import Mapping

class CapacityState(StrEnum):
    READY = "READY"
    DEGRADED = "DEGRADED"
    QUOTA_NEAR_LIMIT = "QUOTA_NEAR_LIMIT"
    QUOTA_EXHAUSTED = "QUOTA_EXHAUSTED"
    CAPACITY_REACHED = "CAPACITY_REACHED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_PAUSED = "PROVIDER_PAUSED"
    READ_ONLY = "READ_ONLY"
    RIGHTS_BLOCKED = "RIGHTS_BLOCKED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    TRY_AFTER_RESET = "TRY_AFTER_RESET"
    MIGRATION_REQUIRED = "MIGRATION_REQUIRED"

class Priority(StrEnum):
    ESSENTIAL = "essential"
    INTERACTIVE = "interactive"
    BACKGROUND = "background"
    SPECULATIVE = "speculative"

@dataclass(frozen=True, slots=True)
class ResourceBudget:
    name: str
    hard_limit: int | None
    used: int = 0
    reserved: int = 0
    reset_at: datetime | None = None
    provider_available: bool = True
    provider_paused: bool = False
    read_only: bool = False
    def __post_init__(self) -> None:
        if self.used < 0 or self.reserved < 0: raise ValueError("Usage and reservation values must be non-negative")
        if self.hard_limit is not None and self.hard_limit < 0: raise ValueError("Hard limit must be non-negative")
        if self.reset_at is not None and self.reset_at.tzinfo is None: raise ValueError("reset_at must be timezone-aware")
    @property
    def committed(self) -> int: return self.used + self.reserved
    @property
    def utilization(self) -> float | None:
        if self.hard_limit is None: return None
        if self.hard_limit == 0: return 1.0
        return self.committed / self.hard_limit

@dataclass(frozen=True, slots=True)
class AdmissionDecision:
    allowed: bool
    state: CapacityState
    reason: str
    utilization: float | None
    remaining: int | None
    reset_at: datetime | None = None

def admit(budget: ResourceBudget, amount: int, *, priority: Priority = Priority.INTERACTIVE, rights_allowed: bool = True, rights_review_required: bool = False, now: datetime | None = None) -> AdmissionDecision:
    if amount <= 0: raise ValueError("Reservation amount must be positive")
    if rights_review_required: return _deny(budget, CapacityState.REVIEW_REQUIRED, "Rights require review")
    if not rights_allowed: return _deny(budget, CapacityState.RIGHTS_BLOCKED, "Rights policy denies operation")
    if budget.provider_paused: return _deny(budget, CapacityState.PROVIDER_PAUSED, "Provider is paused")
    if not budget.provider_available: return _deny(budget, CapacityState.PROVIDER_UNAVAILABLE, "Provider is unavailable")
    if budget.read_only: return _deny(budget, CapacityState.READ_ONLY, "Resource is read-only")
    if budget.hard_limit is None: return _deny(budget, CapacityState.REVIEW_REQUIRED, "Quota is undocumented")
    projected = budget.committed + amount
    ratio = 1.0 if budget.hard_limit == 0 else projected / budget.hard_limit
    remaining = max(budget.hard_limit - budget.committed, 0)
    clock = now or datetime.now(timezone.utc)
    if projected > budget.hard_limit:
        state = CapacityState.TRY_AFTER_RESET if budget.reset_at and budget.reset_at > clock else CapacityState.QUOTA_EXHAUSTED
        return AdmissionDecision(False, state, "Hard free-tier limit would be exceeded", budget.utilization, remaining, budget.reset_at)
    if ratio >= 0.95 and priority is not Priority.ESSENTIAL: return AdmissionDecision(False, CapacityState.CAPACITY_REACHED, "Capacity reserved for essential export and deletion", ratio, remaining, budget.reset_at)
    if ratio >= 0.85 and priority in {Priority.BACKGROUND, Priority.SPECULATIVE}: return AdmissionDecision(False, CapacityState.DEGRADED, "Nonessential work is delayed above 85% utilization", ratio, remaining, budget.reset_at)
    if ratio >= 0.70 and priority is Priority.SPECULATIVE: return AdmissionDecision(False, CapacityState.DEGRADED, "Speculative work is disabled above 70% utilization", ratio, remaining, budget.reset_at)
    state = CapacityState.QUOTA_NEAR_LIMIT if ratio >= 0.85 else CapacityState.DEGRADED if ratio >= 0.70 else CapacityState.READY
    return AdmissionDecision(True, state, "Admitted within documented free allowance", ratio, max(budget.hard_limit - projected, 0), budget.reset_at)

def admit_all(budgets: Mapping[str, ResourceBudget], requested: Mapping[str, int], *, priority: Priority = Priority.INTERACTIVE) -> dict[str, AdmissionDecision]:
    unknown = set(requested) - set(budgets)
    if unknown: raise ValueError(f"Missing budgets: {sorted(unknown)}")
    return {name: admit(budgets[name], amount, priority=priority) for name, amount in requested.items()}

def _deny(budget: ResourceBudget, state: CapacityState, reason: str) -> AdmissionDecision:
    remaining = None if budget.hard_limit is None else max(budget.hard_limit - budget.committed, 0)
    return AdmissionDecision(False, state, reason, budget.utilization, remaining, budget.reset_at)
