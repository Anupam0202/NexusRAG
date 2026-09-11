"""Low-frequency monitoring strategy that makes browser rendering last resort."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import timedelta
from enum import IntEnum,StrEnum
class MonitorTier(StrEnum):
    CRITICAL_DAILY="CRITICAL_DAILY";IMPORTANT_WEEKLY="IMPORTANT_WEEKLY";STANDARD_MONTHLY="STANDARD_MONTHLY";MANUAL_REVIEW="MANUAL_REVIEW"
class RetrievalMethod(IntEnum):
    STATUS_API=1;CHANGELOG_FEED=2;RSS_ATOM=3;GIT_RELEASES=4;CONDITIONAL_HTTP=5;STATIC_HTML=6;BROWSER=7
@dataclass(frozen=True,slots=True)
class MonitorPolicy:
    tier:MonitorTier;method:RetrievalMethod;interval:timedelta|None;user_refresh:bool=True
    def __post_init__(self)->None:
        if self.tier is MonitorTier.MANUAL_REVIEW and self.interval is not None:raise ValueError("Manual review cannot have automatic cadence")
        if self.tier is not MonitorTier.MANUAL_REVIEW and (self.interval is None or self.interval.total_seconds()<=0):raise ValueError("Automatic monitoring needs a positive interval")
def default_interval(tier:MonitorTier)->timedelta|None:return {MonitorTier.CRITICAL_DAILY:timedelta(days=1),MonitorTier.IMPORTANT_WEEKLY:timedelta(days=7),MonitorTier.STANDARD_MONTHLY:timedelta(days=30),MonitorTier.MANUAL_REVIEW:None}[tier]
def choose_method(available:set[RetrievalMethod],*,static_sufficient:bool)->RetrievalMethod:
    if not available:raise ValueError("No rights-approved retrieval method")
    selected=sorted(available)[0]
    if selected is RetrievalMethod.BROWSER and static_sufficient:raise ValueError("Browser rendering cannot be selected when static retrieval is sufficient")
    return selected
def should_invoke_ai(*,content_changed:bool,rights_allow_ai:bool,material_change:bool)->bool:return content_changed and rights_allow_ai and material_change
