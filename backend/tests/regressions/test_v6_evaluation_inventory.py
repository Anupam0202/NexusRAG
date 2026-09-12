from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from evals.build_v6_dataset import DOMAINS, TASKS, build_cases, main, validate


class V6EvaluationInventoryTests(unittest.TestCase):
    def test_required_case_counts_and_split_integrity(self) -> None:
        labeled, heldout = build_cases()
        report = validate(labeled, heldout)
        self.assertEqual(report["status"], "FIXTURE_INVENTORY_ONLY")
        self.assertEqual(report["labeled_cases"], 400)
        self.assertEqual(report["heldout_cases"], 125)
        self.assertEqual(set(report["domains"]), set(DOMAINS))
        self.assertEqual(set(report["tasks"]), set(TASKS))
        self.assertEqual(len(report["sha256"]), 64)

    def test_cases_are_tenant_fenced_and_review_labeled(self) -> None:
        labeled, heldout = build_cases()
        for case in labeled + heldout:
            self.assertTrue(case["workspace_id"])
            self.assertTrue(case["expected_sources"])
            self.assertTrue(case["forbidden_sources"])
            self.assertEqual(case["claim_state"], "SUPPORTED")
            self.assertEqual(case["rights_decision"], "ALLOW")
            self.assertTrue(case["synthetic"])


if __name__ == "__main__":
    unittest.main()
