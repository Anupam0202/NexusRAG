"""Production closure must not accept a partial source catalogue."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "execution_ledger", ROOT / "scripts/check_execution_ledger.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExecutionLedgerTests(unittest.TestCase):
    def setUp(self):
        self.ledger = json.loads((ROOT / "docs/implementation/execution-ledger.json").read_text())

    def test_every_accepted_requirement_and_product_is_present(self):
        result = MODULE.validate(self.ledger)
        self.assertGreaterEqual(result["entries"], 234)
        self.assertEqual(len(MODULE.normative_requirements()), 224)
        self.assertFalse(result["closure_passed"])

    def test_open_work_must_fail_release_closure(self):
        result = subprocess.run(
            [sys.executable, str(ROOT / "scripts/check_execution_ledger.py"), "--require-closure"],
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(json.loads(result.stdout)["closure_passed"])

    def test_duplicate_id_cannot_hide_unfinished_work(self):
        self.ledger["entries"].append(deepcopy(self.ledger["entries"][0]))
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_missing_requirement_cannot_close(self):
        self.ledger["entries"] = [
            row for row in self.ledger["entries"] if row["id"] != "R01"
        ]
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_missing_product_cannot_close(self):
        self.ledger["entries"] = [
            row for row in self.ledger["entries"] if row["id"] != "PRODUCT-10"
        ]
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_rewording_normative_requirements_is_rejected(self):
        next(row for row in self.ledger["entries"] if row["id"] == "R01")["requirement"] = "Fake replacement"
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_file_presence_is_not_verified_acceptance(self):
        next(row for row in self.ledger["entries"] if row["id"] == "R01")["status"] = "VERIFIED"
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_unfinished_code_cannot_be_called_external_without_prerequisite(self):
        next(row for row in self.ledger["entries"] if row["id"] == "R01")["status"] = "BLOCKED_EXTERNAL"
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_requirement_validation_is_independent_of_entry_order(self):
        self.ledger["entries"].reverse()
        self.assertFalse(MODULE.validate(self.ledger)["closure_passed"])
        self.ledger["entries"] = [
            row for row in self.ledger["entries"] if row["id"] != "R01"
        ]
        with self.assertRaises(ValueError):
            MODULE.validate(self.ledger)

    def test_both_production_components_check_closure_before_provider_or_deploy(self):
        workflow = (ROOT / ".github/workflows/production-deploy.yml").read_text()
        self.assertEqual(workflow.count("scripts/check_execution_ledger.py --require-closure"), 2)
        for component in workflow.split("Require complete evidence-backed execution closure")[1:]:
            self.assertIn("--require-closure", component)
        self.assertLess(
            workflow.index("--require-closure"), workflow.index("Validate production configuration")
        )


if __name__ == "__main__":
    unittest.main()
