"""Deterministic change detection for provider terms, quota and schema pages."""
from __future__ import annotations
from dataclasses import dataclass
from enum import StrEnum
import hashlib,json,re
class ChangeMateriality(StrEnum):
    NONE="NONE";EDITORIAL="EDITORIAL";OPERATIONAL="OPERATIONAL";RIGHTS_REVIEW="RIGHTS_REVIEW";SECURITY_REVIEW="SECURITY_REVIEW"
@dataclass(frozen=True,slots=True)
class Snapshot:
    provider_id:str;source_url:str;normalized_text:str;content_hash:str
    @classmethod
    def from_text(cls,provider_id:str,source_url:str,text:str)->"Snapshot":
        normalized=normalize_text(text);return cls(provider_id,source_url,normalized,hashlib.sha256(normalized.encode()).hexdigest())
@dataclass(frozen=True,slots=True)
class Change:
    changed:bool;materiality:ChangeMateriality;previous_hash:str;current_hash:str;matched_signals:tuple[str,...]
RIGHTS_SIGNALS=("commercial use","redistribution","licen","terms","privacy","training","artificial intelligence")
OPERATIONAL_SIGNALS=("quota","rate limit","request per","token","pricing","deprecated","sunset","model")
SECURITY_SIGNALS=("security","authentication","oauth","api key","breach","vulnerability")
def normalize_text(text:str)->str:return re.sub(r"\s+"," ",text).strip()
def classify_change(previous:Snapshot,current:Snapshot)->Change:
    if previous.provider_id!=current.provider_id or previous.source_url!=current.source_url:raise ValueError("Snapshots do not describe the same provider source")
    if previous.content_hash==current.content_hash:return Change(False,ChangeMateriality.NONE,previous.content_hash,current.content_hash,())
    before,after=previous.normalized_text.lower(),current.normalized_text.lower();signals=tuple(sorted({s for s in RIGHTS_SIGNALS+OPERATIONAL_SIGNALS+SECURITY_SIGNALS if (s in before)!=(s in after)}))
    materiality=ChangeMateriality.RIGHTS_REVIEW if any(s in signals for s in RIGHTS_SIGNALS) else ChangeMateriality.SECURITY_REVIEW if any(s in signals for s in SECURITY_SIGNALS) else ChangeMateriality.OPERATIONAL if any(s in signals for s in OPERATIONAL_SIGNALS) else ChangeMateriality.EDITORIAL
    return Change(True,materiality,previous.content_hash,current.content_hash,signals)
def stable_openapi_hash(document:dict)->str:return hashlib.sha256(json.dumps(document,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
