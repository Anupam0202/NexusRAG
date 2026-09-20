from __future__ import annotations

import json
from pathlib import Path
import unittest


class ProviderRightsRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        root = Path(__file__).resolve().parents[3]
        cls.registry = json.loads(
            (root / "config/provider-registry.zero-cost.json").read_text()
        )

    def test_recurring_connectors_are_fail_closed(self) -> None:
        providers = self.registry["providers"]
        self.assertEqual(len(providers), 10)
        self.assertEqual(self.registry["policy"]["enabledRecurringProviders"], 0)
        self.assertTrue(all(provider["enabled"] is False for provider in providers))
        self.assertTrue(
            all(
                provider["status"]
                in {
                    "APPROVED_WITH_DUTIES",
                    "REVIEW_REQUIRED",
                    "LEGAL_REVIEW",
                }
                for provider in providers
            )
        )

    def test_every_provider_has_a_reviewable_quota_and_rights_record(self) -> None:
        for provider in self.registry["providers"]:
            with self.subTest(provider=provider["id"]):
                self.assertTrue(provider["rights"])
                self.assertIsInstance(provider["quota"], dict)
                self.assertTrue(provider["duties"])
                if provider["status"] == "LEGAL_REVIEW":
                    self.assertEqual(provider["quota"].get("daily_cap"), 0)
                else:
                    self.assertTrue(provider["evidence_url"])

    def test_review_window_and_no_paid_fallback_are_explicit(self) -> None:
        policy = self.registry["policy"]
        self.assertFalse(policy["paidFallback"])
        self.assertEqual(policy["undocumentedQuota"], "DENY")
        self.assertLess(policy["rightsReviewDate"], policy["reviewAfter"])


if __name__ == "__main__":
    unittest.main()