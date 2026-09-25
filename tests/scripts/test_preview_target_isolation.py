import unittest
from pathlib import Path

from scripts.preview_target import PREVIEW_TARGETS, resolve_target, validate_targets


class PreviewTargetIsolationTests(unittest.TestCase):
    def test_each_supported_branch_uses_distinct_worker_queue_and_collection(self):
        validate_targets()
        pr2 = resolve_target("refs/heads/v6-zero-cost-foundations-clean")
        pr3 = resolve_target("refs/heads/critical-gaps/v8-remote-validation")
        for key in (
            "GATEWAY_WORKER",
            "INGESTION_QUEUE",
            "INGESTION_DLQ",
            "FRONTEND_WORKER",
            "QDRANT_COLLECTION",
        ):
            with self.subTest(resource=key):
                self.assertNotEqual(pr2[key], pr3[key])

    def test_unsupported_refs_fail_closed(self):
        for ref in ("refs/heads/main", "refs/heads/feature", "refs/pull/3/merge"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                resolve_target(ref)

    def test_exactly_two_explicit_preview_targets_exist(self):
        self.assertEqual(
            set(PREVIEW_TARGETS),
            {
                "refs/heads/v6-zero-cost-foundations-clean",
                "refs/heads/critical-gaps/v8-remote-validation",
            },
        )

    def test_queue_creation_uses_free_plan_retention_limit(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/cloudflare-preview-deploy.yml").read_text()
        self.assertIn("--message-retention-period-secs 86400", workflow)


if __name__ == "__main__":
    unittest.main()
