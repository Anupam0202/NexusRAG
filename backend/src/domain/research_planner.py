"""Bounded, resumable evidence-research planning contracts."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum


class ResearchMode(StrEnum):
    QUICK_LOOKUP = "QUICK_LOOKUP"
    EVIDENCE_ANSWER = "EVIDENCE_ANSWER"
    DEEP_RESEARCH = "DEEP_RESEARCH"
    COMPARE = "COMPARE"
    TIMELINE = "TIMELINE"
    CONTRADICTION_ANALYSIS = "CONTRADICTION_ANALYSIS"
    CALCULATION = "CALCULATION"
    OBLIGATION_ANALYSIS = "OBLIGATION_ANALYSIS"
    ENTITY_INVESTIGATION = "ENTITY_INVESTIGATION"
    DUE_DILIGENCE = "DUE_DILIGENCE"
    PRODUCT_PASSPORT = "PRODUCT_PASSPORT"
    PROCUREMENT_RESEARCH = "PROCUREMENT_RESEARCH"


@dataclass(frozen=True, slots=True)
class ModeLimit:
    max_subquestions: int
    max_sources: int
    max_variants: int
    max_runtime_seconds: int
    requires_review: bool


MODE_LIMITS = {
    ResearchMode.QUICK_LOOKUP: ModeLimit(1, 8, 2, 30, False),
    ResearchMode.EVIDENCE_ANSWER: ModeLimit(4, 20, 4, 90, False),
    ResearchMode.DEEP_RESEARCH: ModeLimit(12, 60, 8, 600, True),
    ResearchMode.COMPARE: ModeLimit(8, 40, 6, 300, True),
    ResearchMode.TIMELINE: ModeLimit(8, 40, 6, 300, True),
    ResearchMode.CONTRADICTION_ANALYSIS: ModeLimit(10, 50, 8, 420, True),
    ResearchMode.CALCULATION: ModeLimit(6, 30, 4, 180, True),
    ResearchMode.OBLIGATION_ANALYSIS: ModeLimit(10, 50, 8, 420, True),
    ResearchMode.ENTITY_INVESTIGATION: ModeLimit(10, 50, 8, 420, True),
    ResearchMode.DUE_DILIGENCE: ModeLimit(12, 60, 8, 600, True),
    ResearchMode.PRODUCT_PASSPORT: ModeLimit(12, 60, 8, 600, True),
    ResearchMode.PROCUREMENT_RESEARCH: ModeLimit(10, 50, 8, 420, True),
}


@dataclass(frozen=True, slots=True)
class ResearchPlan:
    plan_id: str
    workspace_id: str
    mode: ResearchMode
    question: str
    subquestions: tuple[str, ...]
    private_source_ids: tuple[str, ...]
    public_provider_ids: tuple[str, ...]
    date_from: date | None
    date_to: date | None
    jurisdiction: str | None
    entity_scope: tuple[str, ...]
    rights_constraints: tuple[str, ...]
    expected_calculations: tuple[str, ...]
    completion_criteria: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.plan_id or not self.workspace_id or not self.question.strip():
            raise ValueError("Plan identity, workspace, and question are required")
        limits = MODE_LIMITS[self.mode]
        if len(self.subquestions) > limits.max_subquestions:
            raise ValueError("Subquestion limit exceeded")
        source_count = len(self.private_source_ids) + len(self.public_provider_ids)
        if source_count > limits.max_sources:
            raise ValueError("Source limit exceeded")
        if self.date_from and self.date_to and self.date_to < self.date_from:
            raise ValueError("Invalid date scope")
        if self.public_provider_ids and not self.rights_constraints:
            raise ValueError("Public sources require rights constraints")
        if not self.completion_criteria:
            raise ValueError("Completion criteria are required")


class RunStage(StrEnum):
    PLANNED = "PLANNED"
    AUTHORIZED = "AUTHORIZED"
    RETRIEVING = "RETRIEVING"
    REHYDRATING = "REHYDRATING"
    VALIDATING = "VALIDATING"
    GENERATING = "GENERATING"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    COMPLETE = "COMPLETE"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


@dataclass(frozen=True, slots=True)
class RunEvent:
    sequence: int
    stage: RunStage
    recorded_at: datetime
    source_id: str | None = None
    state: str = "READY"
    detail_code: str = ""

    def __post_init__(self) -> None:
        if self.sequence < 1 or self.recorded_at.tzinfo is None:
            raise ValueError("Run events require a positive sequence and timezone")
        if len(self.detail_code) > 128:
            raise ValueError("Detail codes must be bounded and non-sensitive")


def validate_timeline(events: tuple[RunEvent, ...]) -> None:
    if not events:
        raise ValueError("Run timeline cannot be empty")
    if tuple(event.sequence for event in events) != tuple(range(1, len(events) + 1)):
        raise ValueError("Run event sequence must be contiguous")
    if any(later.recorded_at < earlier.recorded_at for earlier, later in zip(events, events[1:])):
        raise ValueError("Run timeline cannot move backwards")
    terminal = {RunStage.COMPLETE, RunStage.CANCELLED, RunStage.FAILED}
    if any(event.stage in terminal for event in events[:-1]):
        raise ValueError("Terminal events must be last")