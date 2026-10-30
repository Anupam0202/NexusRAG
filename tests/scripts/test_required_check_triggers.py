"""Required provider contexts cannot be path-filtered off a candidate SHA."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class RequiredProviderTriggerTests(unittest.TestCase):
    def test_backend_private_turn_rehearsal_is_required_not_omitted(self):
        workflow = (ROOT / ".github/workflows/v6-database-rehearsal.yml").read_text()
        harness = (ROOT / "tests/postgres/local-rehearsal.sh").read_text()
        for content in (workflow, harness):
            self.assertIn("20261013195435_backend_private_turn_authority.sql", content)
        self.assertIn("backend-private-turn-assertions.sql", harness)
        self.assertIn("backend-private-turn-concurrency.sh", harness)
        self.assertIn("grep -F 'BACKEND_PRIVATE_TURN_AUTHORITY_PASS'", workflow)
        self.assertIn("grep -F 'BACKEND_PRIVATE_TURN_CONCURRENT_AUTHORITY_PASS'", workflow)

    def test_trusted_candidate_heads_always_report_provider_checks(self):
        workflow = (ROOT / ".github/workflows/v6-live-provider-validation.yml").read_text()
        trigger = workflow.split("permissions:", 1)[0]
        self.assertIn("branches: [main, 'release/production-*']", trigger)
        self.assertIn("workflow_dispatch:", trigger)
        self.assertNotIn("    paths:", trigger)
        self.assertNotIn("    paths-ignore:", trigger)
        self.assertNotIn("  pull_request:", trigger)
        self.assertIn("cancel-in-progress: false", workflow)

if __name__ == "__main__":
    unittest.main()
