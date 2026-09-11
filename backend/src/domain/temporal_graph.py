"""Small temporal evidence-graph primitives with review-safe identity rules."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

class ResolutionStatus(StrEnum):
    VERIFIED="VERIFIED"; ASSERTED="ASSERTED"; INFERRED="INFERRED"; CONTRADICTED="CONTRADICTED"; REJECTED="REJECTED"

@dataclass(frozen=True, slots=True)
class TemporalInterval:
    valid_from: datetime|None=None
    valid_to: datetime|None=None
    recorded_at: datetime|None=None
    def __post_init__(self)->None:
        for value in (self.valid_from,self.valid_to,self.recorded_at):
            if value is not None and value.tzinfo is None: raise ValueError("Temporal values must be timezone-aware")
        if self.valid_from and self.valid_to and self.valid_to < self.valid_from: raise ValueError("valid_to precedes valid_from")

@dataclass(frozen=True, slots=True)
class EvidenceRef:
    source_version_id:str
    citation_id:str
    content_hash:str
    def __post_init__(self)->None:
        if not self.source_version_id or not self.citation_id or len(self.content_hash)<16: raise ValueError("Evidence reference is incomplete")

@dataclass(frozen=True, slots=True)
class EntityLink:
    source_entity_id:str; target_entity_id:str; relationship:str; confidence:Decimal; status:ResolutionStatus; interval:TemporalInterval; evidence:tuple[EvidenceRef,...]; reviewed_by:str|None=None
    def __post_init__(self)->None:
        if self.source_entity_id==self.target_entity_id: raise ValueError("Self-links are not allowed")
        if not Decimal("0")<=self.confidence<=Decimal("1"): raise ValueError("Confidence must be between zero and one")
        if not self.evidence: raise ValueError("Relationships require evidence")
        if self.status is ResolutionStatus.VERIFIED and not self.reviewed_by: raise ValueError("Verified relationships require a reviewer")
    @property
    def may_drive_automated_join(self)->bool: return self.status is ResolutionStatus.VERIFIED and self.confidence>=Decimal("0.98")
