"""Portable software Product Evidence Passport exports."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
import hashlib
import json


class PassportClaimStatus(StrEnum):
    VERIFIED = "VERIFIED"
    ASSERTED_BY_SUPPLIER = "ASSERTED_BY_SUPPLIER"
    PUBLIC_SOURCE = "PUBLIC_SOURCE"
    INFERRED = "INFERRED"
    CONTRADICTED = "CONTRADICTED"
    EXPIRED = "EXPIRED"
    REVOKED = "REVOKED"
    MISSING = "MISSING"


@dataclass(frozen=True, slots=True)
class PassportClaim:
    property_name: str
    value: str
    status: PassportClaimStatus
    evidence_ids: tuple[str, ...]
    observed_at: datetime

    def __post_init__(self) -> None:
        if not self.property_name or not self.value:
            raise ValueError("Passport claim is incomplete")
        if self.observed_at.tzinfo is None:
            raise ValueError("observed_at must be timezone-aware")
        if self.status in {
            PassportClaimStatus.VERIFIED,
            PassportClaimStatus.PUBLIC_SOURCE,
            PassportClaimStatus.CONTRADICTED,
        } and not self.evidence_ids:
            raise ValueError(f"{self.status.value} claims require evidence")


@dataclass(frozen=True, slots=True)
class ProductPassport:
    passport_id: str
    product_name: str
    product_version: str
    supplier: str
    claims: tuple[PassportClaim, ...]

    def __post_init__(self) -> None:
        if not all((self.passport_id, self.product_name, self.product_version, self.supplier)):
            raise ValueError("Passport identity is incomplete")
        names = [claim.property_name for claim in self.claims]
        if len(names) != len(set(names)):
            raise ValueError("Passport properties must be unique")

    def export_jsonld(self) -> dict[str, object]:
        return {
            "@context": {
                "@vocab": "https://schema.org/",
                "prov": "http://www.w3.org/ns/prov#",
                "nexus": "https://nexusrag.dev/ns/evidence#",
            },
            "@id": f"urn:nexusrag:passport:{self.passport_id}",
            "@type": "Product",
            "name": self.product_name,
            "version": self.product_version,
            "manufacturer": self.supplier,
            "nexus:claims": [
                {
                    "propertyID": claim.property_name,
                    "value": claim.value,
                    "nexus:status": claim.status.value,
                    "prov:wasDerivedFrom": list(claim.evidence_ids),
                    "dateObserved": claim.observed_at.isoformat(),
                }
                for claim in sorted(self.claims, key=lambda item: item.property_name)
            ],
        }

    def canonical_receipt(self) -> str:
        payload = json.dumps(
            self.export_jsonld(), sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )
        return hashlib.sha256(payload.encode()).hexdigest()