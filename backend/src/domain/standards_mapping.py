"""Versioned standards mappings with conservative conformance language."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class StandardsMapping:
    standard: str
    version: str
    internal_type: str
    external_type: str
    required_fields: tuple[str, ...]
    fixture_validated: bool
    conformance_claimed: bool = False

    def __post_init__(self) -> None:
        if not all((self.standard, self.version, self.internal_type, self.external_type)):
            raise ValueError("Standards mapping identity is required")
        if not self.required_fields:
            raise ValueError("Standards mappings require field-level evidence")
        if self.conformance_claimed and not self.fixture_validated:
            raise ValueError("Conformance cannot be claimed without fixtures")


MAPPINGS = (
    StandardsMapping("W3C PROV", "2013", "EvidenceItem", "prov:Entity", ("id", "source_version_id", "captured_at"), True),
    StandardsMapping("DCAT", "3", "EvidenceSource", "dcat:Dataset", ("title", "provider", "rights"), True),
    StandardsMapping("ODRL", "2.2", "RightsDecision", "odrl:Policy", ("action", "decision", "duties"), True),
    StandardsMapping("OpenLineage", "1-0-5", "TransformationEvent", "RunEvent", ("job", "run", "inputs", "outputs"), True),
    StandardsMapping("RO-Crate", "1.1", "EvidencePackage", "Dataset", ("@context", "@graph"), True),
    StandardsMapping("OCDS", "1.1.5", "ProcurementRecord", "Release", ("ocid", "buyer", "tender"), True),
    StandardsMapping("BODS", "0.4", "CounterpartyMatch", "Statement", ("statementID", "subject", "interest"), False),
    StandardsMapping("SPDX", "3.0", "SoftwareAssuranceFinding", "software_Package", ("spdxId", "name", "version"), True),
    StandardsMapping("CycloneDX", "1.6", "SoftwareAssuranceFinding", "component", ("bom-ref", "name", "version"), True),
    StandardsMapping("VEX", "1.0", "SoftwareAssuranceFinding", "vulnerability", ("id", "analysis.state"), True),
    StandardsMapping("SLSA", "1.0", "ProvenanceReference", "provenance", ("builder", "buildType", "subject"), True),
    StandardsMapping("in-toto", "1.0", "ProvenanceReference", "Statement", ("_type", "subject", "predicateType"), True),
    StandardsMapping("Sigstore", "bundle-0.3", "SignatureEvidence", "Bundle", ("mediaType", "verificationMaterial"), False),
    StandardsMapping("C2PA", "2.1", "MediaEvidence", "Claim", ("claim_generator", "assertions"), False),
    StandardsMapping("STAC", "1.1", "PublicRiskWatch", "Item", ("id", "geometry", "properties.datetime"), True),
    StandardsMapping("CAP", "1.2", "PublicAlert", "alert", ("identifier", "sender", "sent", "status"), True),
)


def mapping_report() -> dict[str, object]:
    return {
        "namespace": "https://nexusrag.dev/ns/evidence/v1",
        "mappings": [
            {
                "standard": item.standard,
                "version": item.version,
                "internal_type": item.internal_type,
                "external_type": item.external_type,
                "fixture_validated": item.fixture_validated,
                "conformance_claimed": item.conformance_claimed,
            }
            for item in MAPPINGS
        ],
        "claim": "MAPPINGS_VALIDATED_NOT_FULL_CONFORMANCE",
    }