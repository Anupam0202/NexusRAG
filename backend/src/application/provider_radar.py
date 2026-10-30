"""Deterministic change detection for provider terms, quota and schema pages."""
from __future__ import annotations
from dataclasses import dataclass
from collections import Counter
from enum import StrEnum
import hashlib,json,re,unicodedata
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
OPERATIONAL_SIGNALS=("quota","rate limit","request per","token","pricing","deprecated","sunset","model","schema")
SECURITY_SIGNALS=("security","authentication","oauth","api key","breach","vulnerability")
def normalize_text(text:str)->str:return re.sub(r"\s+"," ",text).strip()

_TOKENS=re.compile(r"[+-]?(?:[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?%?|[^\W_]+(?:_[^\W_]+)*|[^\w\s]")
_NUMBER=re.compile(r"([+-]?)([0-9][0-9,]*)?(?:\.([0-9]+))?([eE][+-]?[0-9]+)?(%)?\Z")

def _canonical_token(token:str)->str:
    number=_NUMBER.fullmatch(token)
    if not number:return token
    sign,integer,fraction,exponent,percent=number.groups()
    if integer is None and fraction is None:return token
    integer=(integer or "0").replace(",","").lstrip("0") or "0"
    fraction=(fraction or "").rstrip("0")
    # Compare exact decimal strings, never binary floats or rounded quotas.
    if exponent:
        negative=exponent[1:2]=="-"
        power=exponent[1:].lstrip("+-").lstrip("0") or "0"
        exponent="e"+("-" if negative else "")+power if power!="0" else ""
    return ("-" if sign=="-" and (integer!="0" or fraction) else "")+integer+("."+fraction if fraction else "")+(exponent or "")+(percent or "")

def _context_token(token:str)->bool:
    # Preserve every currency/math symbol, including non-ASCII price units and
    # inequality operators. Ordinary punctuation alone stays editorial.
    return len(token)>1 or token.isalnum() or token in "+-%" or unicodedata.category(token) in {"Sc","Sm"}

def _operational_contexts(text:str)->dict[str,Counter[tuple[str,...]]]:
    """Linear scans of clauses, not quadratic whole-document alignment.

    Keep context local: a footer counter cannot change an unchanged quota.
    Punctuation/case and ordinary decimal formatting alone are editorial.
    This yields review candidates, not semantic/legal certification.
    """
    contexts={signal:Counter() for signal in OPERATIONAL_SIGNALS}
    # The input is normalized: only ASCII spaces represent whitespace. BOM is
    # retained source text, and must not become a JS-only clause separator.
    for clause in re.split(r"(?<=[.!?;]) +",text):
        signals=[signal for signal in OPERATIONAL_SIGNALS if signal in clause]
        if not signals:continue
        signature=tuple(_canonical_token(token) for token in _TOKENS.findall(clause) if _context_token(token))
        for signal in signals:contexts[signal][signature]+=1
    # Multisets ignore clause reordering without whole-document alignment/sorts.
    return contexts

def classify_change(previous:Snapshot,current:Snapshot)->Change:
    if previous.provider_id!=current.provider_id or previous.source_url!=current.source_url:raise ValueError("Snapshots do not describe the same provider source")
    if previous.content_hash==current.content_hash:return Change(False,ChangeMateriality.NONE,previous.content_hash,current.content_hash,())
    before,after=previous.normalized_text.lower(),current.normalized_text.lower()
    before_contexts,after_contexts=_operational_contexts(before),_operational_contexts(after)
    signals=tuple(sorted({s for s in RIGHTS_SIGNALS+OPERATIONAL_SIGNALS+SECURITY_SIGNALS if (s in before)!=(s in after)}
        |{s for s in OPERATIONAL_SIGNALS if before_contexts[s]!=after_contexts[s]}))
    materiality=ChangeMateriality.RIGHTS_REVIEW if any(s in signals for s in RIGHTS_SIGNALS) else ChangeMateriality.SECURITY_REVIEW if any(s in signals for s in SECURITY_SIGNALS) else ChangeMateriality.OPERATIONAL if any(s in signals for s in OPERATIONAL_SIGNALS) else ChangeMateriality.EDITORIAL
    return Change(True,materiality,previous.content_hash,current.content_hash,signals)
def stable_openapi_hash(document:dict)->str:return hashlib.sha256(json.dumps(document,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()
