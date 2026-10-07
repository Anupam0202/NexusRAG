"""Required provider contexts cannot be path-filtered off a candidate SHA."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]

class RequiredProviderTriggerTests(unittest.TestCase):
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
