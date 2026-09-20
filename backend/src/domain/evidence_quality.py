"""Deterministic evidence-quality rules shared by every NexusRAG vertical."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import StrEnum
from typing import Iterable


class ClaimStatus(StrEnum):
    SUPPORTED = "SUPPORTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    INFERRED = "INFERRED"
    UNSUPPORTED = "UNSUPPORTED"
    STALE = "STALE"
    SOURCE_UNAVAILABLE = "SOURCE_UNAVAILABLE"


@dataclass(frozen=True, slots=True)
class Citation:
    source_version_id: str
    locator: str
    content_hash: str
    captured_at: datetime
    supports: bool = True

    def __post_init__(self) -> None:
        if not self.source_version_id or not self.locator:
            raise ValueError("Citation identity is incomplete")
        if len(self.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in self.content_hash.lower()
        ):
            raise ValueError("Citation content_hash must be SHA-256 hex")
        if self.captured_at.tzinfo is None:
            raise ValueError("captured_at must be timezone-aware")


@dataclass(frozen=True, slots=True)
class EvidenceClaim:
    claim_id: str
    text: str
    status: ClaimStatus
    citations: tuple[Citation, ...]
    confidence: float
    rationale: str = ""

    def __post_init__(self) -> None:
        if not self.claim_id or not self.text.strip():
            raise ValueError("Claim identity is incomplete")
        if not 0 <= self.confidence <= 1:
            raise ValueError("Confidence must be between zero and one")
        supporting = any(citation.supports for citation in self.citations)
        opposing = any(not citation.supports for citation in self.citations)
        if self.status in {
            ClaimStatus.SUPPORTED,
            ClaimStatus.PARTIALLY_SUPPORTED,
            ClaimStatus.CONTRADICTED,
            ClaimStatus.STALE,
        } and not self.citations:
            raise ValueError(f"{self.status.value} claims require citations")
        if self.status is ClaimStatus.SUPPORTED and (not supporting or opposing):
            raise ValueError("SUPPORTED claims require only supporting evidence")
        if self.status is ClaimStatus.CONTRADICTED and not opposing:
            raise ValueError("CONTRADICTED claims require opposing evidence")
        if self.status is ClaimStatus.UNSUPPORTED and self.citations:
            raise ValueError("UNSUPPORTED claims cannot imply evidence")


def assess_claim(
    *,
    claim_id: str,
    text: str,
    citations: Iterable[Citation],
    confidence: float,
    inferred: bool = False,
    source_available: bool = True,
    stale_after_days: int | None = None,
    now: datetime | None = None,
) -> EvidenceClaim:
    """Assign an honest status without invoking a model or fabricating support."""
    evidence = tuple(citations)
    clock = now or datetime.now(timezone.utc)
    if not source_available:
        status = ClaimStatus.SOURCE_UNAVAILABLE
    elif inferred:
        status = ClaimStatus.INFERRED
    elif not evidence:
        status = ClaimStatus.UNSUPPORTED
    elif any(not citation.supports for citation in evidence):
        status = ClaimStatus.CONTRADICTED
    elif stale_after_days is not None and any(
        (clock - citation.captured_at).days > stale_after_days for citation in evidence
    ):
        status = ClaimStatus.STALE
    elif confidence >= 0.8:
        status = ClaimStatus.SUPPORTED
    else:
        status = ClaimStatus.PARTIALLY_SUPPORTED
    return EvidenceClaim(claim_id, text, status, evidence, confidence)


def citation_coverage(claims: Iterable[EvidenceClaim]) -> float:
    material = tuple(claims)
    if not material:
        return 1.0
    cited = sum(bool(claim.citations) for claim in material)
    return cited / len(material)