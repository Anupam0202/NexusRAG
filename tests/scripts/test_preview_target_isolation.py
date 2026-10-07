import unittest
from pathlib import Path

from scripts.preview_target import PREVIEW_TARGETS, resolve_target, validate_targets


class PreviewTargetIsolationTests(unittest.TestCase):
    def test_main_uses_only_dedicated_candidate_resources(self):
        validate_targets()
        target = resolve_target("refs/heads/main")
        for key in ("GATEWAY_WORKER", "INGESTION_QUEUE", "INGESTION_DLQ", "FRONTEND_WORKER", "QDRANT_COLLECTION"):
            with self.subTest(resource=key):
                self.assertIn("candidate", target[key])
                self.assertNotIn("pr3", target[key])

    def test_unsupported_refs_fail_closed(self):
        for ref in ("refs/heads/v6-zero-cost-foundations-clean", "refs/heads/critical-gaps/v8-remote-validation", "refs/heads/feature", "refs/pull/3/merge"):
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                resolve_target(ref)

    def test_only_main_can_deploy_the_candidate(self):
        self.assertEqual(set(PREVIEW_TARGETS), {"refs/heads/main"})
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/cloudflare-preview-deploy.yml").read_text()
        self.assertNotIn("  push:", workflow)
        self.assertIn("  pull_request:\n    branches: [main]", workflow)
        self.assertEqual(workflow.count("inputs.deploy_candidate_preview && github.ref == 'refs/heads/main'"), 2)

    def test_queue_creation_uses_free_plan_retention_limit(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/cloudflare-preview-deploy.yml").read_text()
        self.assertIn("--message-retention-period-secs 86400", workflow)


if __name__ == "__main__":
    unittest.main()
