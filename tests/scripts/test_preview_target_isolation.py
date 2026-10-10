import unittest
import json
import tempfile
import shutil
import re
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

    def test_retired_pr_configs_cannot_be_reintroduced(self):
        repository = Path(__file__).resolve().parents[2]
        target = resolve_target("refs/heads/main")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in (target["GATEWAY_CONFIG"], "frontend/" + target["FRONTEND_CONFIG"], "frontend/worker.js"):
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(repository / name, destination)
            with patch("scripts.preview_target.ROOT", root):
                validate_targets()
                for name in ("frontend/wrangler.pr3.jsonc", "apps/gateway/wrangler.pr3-preview.jsonc"):
                    with self.subTest(retired_config=name):
                        destination = root / name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_text("{}")
                        with self.assertRaisesRegex(ValueError, "Retired PR preview configuration"):
                            validate_targets()
                        destination.unlink()
                        validate_targets()

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
            shutil.copyfile(repository / "frontend" / "worker.js", root / "frontend" / "worker.js")
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

    def test_document_wrapper_and_worker_first_routing_are_required(self):
        repository = Path(__file__).resolve().parents[2]
        target = resolve_target("refs/heads/main")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            gateway = root / target["GATEWAY_CONFIG"]
            frontend = root / "frontend" / target["FRONTEND_CONFIG"]
            entrypoint = root / "frontend" / "worker.js"
            gateway.parent.mkdir(parents=True)
            frontend.parent.mkdir(parents=True)
            shutil.copyfile(repository / target["GATEWAY_CONFIG"], gateway)
            shutil.copyfile(repository / "frontend" / target["FRONTEND_CONFIG"], frontend)
            shutil.copyfile(repository / "frontend" / "worker.js", entrypoint)
            original = frontend.read_text()
            wrapper = entrypoint.read_text()
            with patch("scripts.preview_target.ROOT", root):
                validate_targets()
                for fragment in ('"main": "worker.js"', '"binding": "ASSETS"', '"run_worker_first": ["/documents/*"]'):
                    with self.subTest(config=fragment):
                        frontend.write_text(original.replace(fragment, ""))
                        with self.assertRaisesRegex(ValueError, "Frontend config does not bind"):
                            validate_targets()
                frontend.write_text(original)
                entrypoint.unlink()
                with self.assertRaisesRegex(ValueError, "wrapper is missing"):
                    validate_targets()
                for fragment in (
                    'import nextWorker from "./.open-next/worker.js"',
                    'from "./src/lib/static-document-worker"',
                    'export * from "./.open-next/worker.js"',
                    "export default createDocumentStaticWorker(nextWorker)",
                ):
                    with self.subTest(wrapper=fragment):
                        entrypoint.write_text(wrapper.replace(fragment, ""))
                        with self.assertRaisesRegex(ValueError, "wrapper does not preserve"):
                            validate_targets()

    def test_ci_exercises_document_routes_against_the_worker(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/v6-foundation-ci.yml").read_text()
        self.assertIn("npm run cf:build", workflow)
        self.assertIn("npm exec wrangler -- dev --local --port 3003", workflow)
        self.assertIn("E2E_BASE_URL=http://localhost:3003 npm exec playwright -- test worker-routing.spec.ts", workflow)

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
        self.assertIn('/rpc/nexus_authorize_byok_processing', workflow)
        self.assertIn('Candidate BYOK authority migration 037 is not verified', workflow)
        self.assertIn('/rpc/nexus_processing_policy_version', workflow)
        self.assertIn('Candidate canonical processing authority migration 039 is not verified', workflow)

    def test_database_required_summary_fails_closed(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/v6-database-rehearsal.yml").read_text()
        self.assertIn("  required-clean-supabase-summary:\n    if: always()", workflow)
        self.assertIn("REHEARSAL_RESULT: ${{ needs.clean-baseline-rehearsal.result }}", workflow)
        self.assertIn('test "$REHEARSAL_RESULT" = success', workflow)
        self.assertEqual(workflow.count("name: Clean Supabase baseline rehearsal"), 1)

    def test_every_rehearsed_forward_migration_is_packaged_for_ci(self):
        repository = Path(__file__).resolve().parents[2]
        harness = (repository / "tests/postgres/local-rehearsal.sh").read_text()
        workflow = (repository / ".github/workflows/v6-database-rehearsal.yml").read_text()
        migrations = re.findall(r'\$ROOT/(supabase/migrations/[^"]+\.sql)', harness)
        self.assertGreaterEqual(len(migrations), 15)
        for migration in migrations:
            with self.subTest(migration=migration):
                self.assertTrue((repository / migration).is_file())
                self.assertIn(
                    f'cp "$GITHUB_WORKSPACE/{migration}" "$source_dir/supabase/migrations/"',
                    workflow,
                )

    def test_queue_creation_uses_free_plan_retention_limit(self):
        repository = Path(__file__).resolve().parents[2]
        workflow = (repository / ".github/workflows/cloudflare-preview-deploy.yml").read_text()
        self.assertIn("--message-retention-period-secs 86400", workflow)


if __name__ == "__main__":
    unittest.main()
