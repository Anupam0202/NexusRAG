import unittest
import json
import tempfile
import shutil
from unittest.mock import patch
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

    def test_sensitive_query_redaction_is_required_on_both_candidate_workers(self):
        repository = Path(__file__).resolve().parents[2]
        target = resolve_target("refs/heads/main")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            gateway = root / target["GATEWAY_CONFIG"]
            frontend = root / "frontend" / target["FRONTEND_CONFIG"]
            gateway.parent.mkdir(parents=True)
            frontend.parent.mkdir(parents=True)
            shutil.copyfile(repository / target["GATEWAY_CONFIG"], gateway)
            shutil.copyfile(repository / "frontend" / target["FRONTEND_CONFIG"], frontend)
            with patch("scripts.preview_target.ROOT", root):
                validate_targets()
                config = json.loads(gateway.read_text())
                config["observability"].pop("redact_query_string")
                gateway.write_text(json.dumps(config))
                with self.assertRaisesRegex(ValueError, "gateway must redact"):
                    validate_targets()
                config["observability"]["redact_query_string"] = True
                gateway.write_text(json.dumps(config))
                frontend.write_text(frontend.read_text().replace('"redact_query_string": true', '"redact_query_string": false'))
                with self.assertRaisesRegex(ValueError, "frontend must redact"):
                    validate_targets()

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

    def test_database_required_summary_fails_closed(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/v6-database-rehearsal.yml").read_text()
        self.assertIn("  required-clean-supabase-summary:\n    if: always()", workflow)
        self.assertIn("REHEARSAL_RESULT: ${{ needs.clean-baseline-rehearsal.result }}", workflow)
        self.assertIn('test "$REHEARSAL_RESULT" = success', workflow)
        self.assertEqual(workflow.count("name: Clean Supabase baseline rehearsal"), 1)

    def test_queue_creation_uses_free_plan_retention_limit(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/cloudflare-preview-deploy.yml").read_text()
        self.assertIn("--message-retention-period-secs 86400", workflow)


if __name__ == "__main__":
    unittest.main()
