from pathlib import Path
import unittest


class ProviderQuotaContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = (
            Path(__file__).resolve().parents[3] / "scripts/live_provider_validation.py"
        ).read_text()
        cls.workflow = (
            Path(__file__).resolve().parents[3]
            / ".github/workflows/v6-live-provider-validation.yml"
        ).read_text()

    def test_http_429_returns_typed_state_without_paid_fallback(self) -> None:
        self.assertIn('if exc.status == 429:', self.source)
        self.assertIn('"state": "QUOTA_EXHAUSTED"', self.source)
        self.assertIn('"next_state": "TRY_AFTER_RESET"', self.source)
        self.assertIn('"paid_fallback": False', self.source)

    def test_live_probe_is_not_repeated_for_every_pr_commit(self) -> None:
        self.assertIn("push:", self.workflow)
        self.assertNotIn("pull_request:", self.workflow)
        self.assertIn("workflow_dispatch:", self.workflow)


if __name__ == "__main__":
    unittest.main()