"""Retention decisions for irreplaceable, reconstructible and ephemeral data."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum

class DataClass(StrEnum):
    IRREPLACEABLE = "IRREPLACEABLE"
    RECONSTRUCTIBLE = "RECONSTRUCTIBLE"
    EPHEMERAL = "EPHEMERAL"

@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    data_class: DataClass
    retain_for: timedelta | None
    export_before_delete: bool
    requires_deletion_receipt: bool
    reconstruction_recipe_required: bool
    def __post_init__(self) -> None:
        if self.retain_for is not None and self.retain_for.total_seconds() < 0: raise ValueError("Retention cannot be negative")
        if self.data_class is DataClass.IRREPLACEABLE and self.retain_for is not None: raise ValueError("Irreplaceable retention is controlled by workspace policy")
        if self.data_class is DataClass.RECONSTRUCTIBLE and not self.reconstruction_recipe_required: raise ValueError("Reconstructible data requires a reconstruction recipe")

def default_policy(data_class: DataClass) -> RetentionPolicy:
    if data_class is DataClass.IRREPLACEABLE: return RetentionPolicy(data_class, None, True, True, False)
    if data_class is DataClass.RECONSTRUCTIBLE: return RetentionPolicy(data_class, timedelta(days=30), False, True, True)
    return RetentionPolicy(data_class, timedelta(hours=24), False, False, False)

def expires_at(created_at: datetime, policy: RetentionPolicy) -> datetime | None:
    if created_at.tzinfo is None: raise ValueError("created_at must be timezone-aware")
    return None if policy.retain_for is None else created_at + policy.retain_for

def deletion_allowed(policy: RetentionPolicy, *, workspace_authorized: bool, exported: bool, receipt_destination_available: bool) -> bool:
    if not workspace_authorized: return False
    if policy.export_before_delete and not exported: return False
    if policy.requires_deletion_receipt and not receipt_destination_available: return False
    return True
