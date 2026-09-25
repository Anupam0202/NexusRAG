"""Review-first regulatory obligation records with temporal evidence."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import date
from enum import StrEnum


class ObligationState(StrEnum):
    CANDIDATE = "CANDIDATE"
    REVIEWED = "REVIEWED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"


@dataclass(frozen=True, slots=True)
class Obligation:
    obligation_id: str
    authority: str
    jurisdiction: str
    actor: str
    action: str
    source_version_id: str
    locator: str
    valid_from: date | None = None
    valid_to: date | None = None
    deadline_rule: str | None = None
    state: ObligationState = ObligationState.CANDIDATE
    reviewer_id: str | None = None
    supersedes: str | None = None

    def __post_init__(self) -> None:
        required = (
            self.obligation_id,
            self.authority,
            self.jurisdiction,
            self.actor,
            self.action,
            self.source_version_id,
            self.locator,
        )
        if not all(value.strip() for value in required):
            raise ValueError("Obligation fields and evidence locator are required")
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("valid_to precedes valid_from")
        if self.state in {ObligationState.REVIEWED, ObligationState.APPROVED} and not self.reviewer_id:
            raise ValueError("Reviewed obligations require a reviewer")
        if self.state is ObligationState.SUPERSEDED and not self.supersedes:
            raise ValueError("Superseded obligations require a predecessor")


def review(
    obligation: Obligation,
    *,
    reviewer_id: str,
    approve: bool,
) -> Obligation:
    if obligation.state is not ObligationState.CANDIDATE:
        raise ValueError("Only candidates can enter review")
    if not reviewer_id:
        raise ValueError("reviewer_id is required")
    return replace(
        obligation,
        state=ObligationState.APPROVED if approve else ObligationState.REJECTED,
        reviewer_id=reviewer_id,
    )