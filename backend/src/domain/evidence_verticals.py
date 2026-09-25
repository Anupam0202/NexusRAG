"""Review-safe normalization contracts for evidence verticals."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from src.domain.temporal_graph import EvidenceRef, ResolutionStatus


class ReviewDisposition(StrEnum):
    CANDIDATE = "CANDIDATE"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@dataclass(frozen=True, slots=True)
class ProcurementRecord:
    record_id: str
    provider_id: str
    buyer_id: str
    supplier_id: str | None
    notice_type: str
    classification_codes: tuple[str, ...]
    deadline: datetime | None
    value: Decimal | None
    currency: str | None
    evidence: tuple[EvidenceRef, ...]
    selectively_materialized: bool = True

    def __post_init__(self) -> None:
        if not all((self.record_id, self.provider_id, self.buyer_id, self.notice_type)):
            raise ValueError("Procurement identity is incomplete")
        if not self.evidence:
            raise ValueError("Procurement records require source evidence")
        if self.deadline and self.deadline.tzinfo is None:
            raise ValueError("Procurement deadlines must be timezone-aware")
        if self.value is not None and (self.value < 0 or not self.currency):
            raise ValueError("Procurement values require a non-negative amount and currency")
        if not self.selectively_materialized:
            raise ValueError("Global procurement mirroring is not supported")


@dataclass(frozen=True, slots=True)
class CounterpartyMatch:
    subject_id: str
    candidate_id: str
    identifier_type: str
    confidence: Decimal
    status: ResolutionStatus
    evidence: tuple[EvidenceRef, ...]
    adverse_match: bool = False
    reviewer_id: str | None = None

    def __post_init__(self) -> None:
        if self.subject_id == self.candidate_id:
            raise ValueError("Counterparty match must link distinct records")
        if not Decimal(0) <= self.confidence <= Decimal(1) or not self.evidence:
            raise ValueError("Counterparty matches require bounded confidence and evidence")
        if self.adverse_match and not self.reviewer_id:
            raise ValueError("Adverse matches require human review")
        if self.status is ResolutionStatus.VERIFIED and self.confidence < Decimal("0.98"):
            raise ValueError("Verified identity links require at least 0.98 confidence")

    @property
    def may_drive_decision(self) -> bool:
        return (
            not self.adverse_match
            and self.status is ResolutionStatus.VERIFIED
            and self.reviewer_id is not None
        )


@dataclass(frozen=True, slots=True)
class ScientificStudy:
    study_id: str
    identifier: str
    design: str
    population: str
    intervention: str | None
    comparator: str | None
    outcomes: tuple[str, ...]
    limitations: tuple[str, ...]
    funding: tuple[str, ...]
    corrected_or_retracted: bool
    evidence: tuple[EvidenceRef, ...]

    def __post_init__(self) -> None:
        if not all((self.study_id, self.identifier, self.design, self.population)):
            raise ValueError("Study identity and design are required")
        if not self.outcomes or not self.evidence:
            raise ValueError("Studies require outcomes and evidence")

    def safety_state(self) -> str:
        return "REVIEW_REQUIRED" if self.corrected_or_retracted else "EVIDENCE_ONLY"


@dataclass(frozen=True, slots=True)
class SoftwareAssuranceFinding:
    package: str
    version: str
    vulnerability_id: str | None
    licence_expression: str | None
    exploitability: str
    reachability: str
    provenance_reference: str | None
    evidence: tuple[EvidenceRef, ...]

    def __post_init__(self) -> None:
        if not self.package or not self.version or not self.evidence:
            raise ValueError("Software findings require package identity and evidence")
        if self.reachability not in {"REACHABLE", "NOT_REACHABLE", "UNKNOWN"}:
            raise ValueError("Reachability must be deterministic or UNKNOWN")
        if self.exploitability not in {"KNOWN_EXPLOITED", "NOT_KNOWN_EXPLOITED", "UNKNOWN"}:
            raise ValueError("Exploitability must not infer maliciousness")


@dataclass(frozen=True, slots=True)
class PublicRiskWatch:
    watch_id: str
    facility_or_location_id: str
    provider_id: str
    hazard_types: tuple[str, ...]
    area_reference: str
    last_checked: datetime | None = None
    expires_on: date | None = None

    def __post_init__(self) -> None:
        if not all((self.watch_id, self.facility_or_location_id, self.provider_id, self.area_reference)):
            raise ValueError("Watch identity and bounded area are required")
        if not self.hazard_types:
            raise ValueError("At least one watched hazard is required")
        if self.last_checked and self.last_checked.tzinfo is None:
            raise ValueError("last_checked must be timezone-aware")