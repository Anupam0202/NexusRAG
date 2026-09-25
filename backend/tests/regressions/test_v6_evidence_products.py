from datetime import datetime, timezone
from decimal import Decimal
import unittest


class EvidenceProducts(unittest.TestCase):
    def test_claim_status_is_derived_and_citation_bound(self):
        from src.domain.evidence_quality import Citation, ClaimStatus, assess_claim

        citation = Citation("version-1", "page 7", "a" * 64, datetime.now(timezone.utc))
        claim = assess_claim(
            claim_id="claim-1",
            text="The filing reports revenue.",
            citations=[citation],
            confidence=0.93,
        )
        self.assertEqual(claim.status, ClaimStatus.SUPPORTED)

    def test_contradiction_is_not_flattened_into_support(self):
        from src.domain.evidence_quality import Citation, ClaimStatus, assess_claim

        evidence = (
            Citation("v1", "p.1", "a" * 64, datetime.now(timezone.utc)),
            Citation("v2", "p.2", "b" * 64, datetime.now(timezone.utc), supports=False),
        )
        claim = assess_claim(claim_id="c", text="Conflicted fact", citations=evidence, confidence=0.99)
        self.assertEqual(claim.status, ClaimStatus.CONTRADICTED)

    def test_calculation_preserves_formula_units_and_evidence(self):
        from src.domain.deterministic_calculations import (
            CalculationOperation,
            Quantity,
            calculate,
        )

        result = calculate(
            CalculationOperation.PERCENT_CHANGE,
            Quantity(Decimal("80"), "USD", ("e1",)),
            Quantity(Decimal("100"), "USD", ("e2",)),
            precision=2,
        )
        self.assertEqual(result.value, Decimal("25.00"))
        self.assertEqual(result.unit, "%")
        self.assertEqual(result.evidence_ids, ("e1", "e2"))
        self.assertEqual(result.formula, "((100-80)/80)*100")

    def test_obligation_cannot_be_approved_without_review(self):
        from src.domain.obligations import Obligation, ObligationState, review

        candidate = Obligation("o1", "SEC", "US", "issuer", "file report", "v1", "§1")
        approved = review(candidate, reviewer_id="reviewer-1", approve=True)
        self.assertEqual(approved.state, ObligationState.APPROVED)
        self.assertEqual(approved.reviewer_id, "reviewer-1")
        with self.assertRaises(ValueError):
            Obligation(
                "o2",
                "SEC",
                "US",
                "issuer",
                "file report",
                "v1",
                "§1",
                state=ObligationState.APPROVED,
            )

    def test_passport_export_is_deterministic_and_evidence_carrying(self):
        from src.domain.product_passport import (
            PassportClaim,
            PassportClaimStatus,
            ProductPassport,
        )

        claim = PassportClaim(
            "sbom",
            "SPDX-2.3",
            PassportClaimStatus.VERIFIED,
            ("evidence:sbom:sha256",),
            datetime(2026, 9, 20, tzinfo=timezone.utc),
        )
        passport = ProductPassport("p1", "NexusRAG", "6", "NexusRAG", (claim,))
        first = passport.export_jsonld()
        self.assertEqual(first["nexus:claims"][0]["nexus:status"], "VERIFIED")
        self.assertEqual(passport.canonical_receipt(), passport.canonical_receipt())
        self.assertEqual(len(passport.canonical_receipt()), 64)


if __name__ == "__main__":
    unittest.main()