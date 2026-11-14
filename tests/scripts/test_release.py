"""Release targets stay isolated, and a Worker whose smoke test fails is rolled back."""
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

import yaml

from scripts import release

ROOT = Path(__file__).resolve().parents[2]
SHA = "a" * 40
PREVIOUS = "11111111-2222-4333-8444-555555555555"
GATEWAY = "https://nexusrag-v6-candidate-gateway.example.workers.dev"
SITE = "https://nexusrag-v6-candidate-frontend.example.workers.dev"
MODELS = ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest")
CONFIGS = [
    "apps/gateway/wrangler.preview.jsonc", "apps/gateway/wrangler.production.jsonc",
    "frontend/wrangler.jsonc", "frontend/wrangler.production.jsonc", "frontend/worker.js",
]


def copied_repository(folder: str) -> Path:
    root = Path(folder)
    for name in CONFIGS:
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, destination)
    return root


def rewrite_json(path: Path, change) -> None:
    config = json.loads(release.strip_jsonc(path.read_text()))
    change(config)
    path.write_text(json.dumps(config))


def ready_report(database="REACHABLE", index="READY", populated=True, collection="nexusrag-v6-candidate"):
    """What the gateway's /ready endpoint answers after probing its database and search index."""
    usable = database == "REACHABLE" and index in ("READY", "EMPTY")
    return {"readiness": "READY" if usable else "DEGRADED", "dependencies": {
        "database": {"state": database, "http_status": 200},
        "search_index": {"state": index, "collection": collection, "populated": populated, "http_status": 200},
    }}


def healthy_gateway(sha=SHA, model="gemini-3.5-flash-lite", capabilities=401, ready=None):
    health = {
        "service": "nexusrag-v6-candidate-gateway", "source_commit": sha, "status": "CONFIGURED",
        "authenticated_api": True, "paid_fallback": False,
        "providers": {"qdrant": "CONFIGURED", "gemini": "CONFIGURED"},
        "gemini_models": {"generation": model, "embedding": "gemini-embedding-001"},
    }
    report = ready_report() if ready is None else ready

    def fetch(url):
        if url.endswith("/health"):
            return 200, json.dumps(health)
        if url.endswith("/ready"):
            return (200 if report["readiness"] == "READY" else 503), json.dumps(report)
        return capabilities, ""
    return fetch


SUPABASE = "https://ukgjygzfhyvnrsecdcuu.supabase.co"
PAGE_POLICY = ("frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; "
               "script-src 'self' 'sha256-teusDh2Hj0ZqbNia6tjQI1tFnalIUtE5EzYbJWecdcY='; "
               f"connect-src 'self' {GATEWAY} {SUPABASE}")


def healthy_frontend(sha=SHA, unknown=404, research=200):
    def fetch(url):
        if url == f"{SITE}/":
            return 200, "<title>NexusRAG</title>"
        if url.endswith("/_nexus-build.json"):
            return 200, json.dumps({"source_commit": sha})
        if "/release-smoke-missing-" in url:
            return unknown, ""
        return research, ""
    return fetch


class TargetIsolationTests(unittest.TestCase):
    def test_targets_never_share_resources_and_match_their_configs(self):
        release.validate_targets()
        candidate, production = release.TARGETS["candidate"], release.TARGETS["production"]
        for key in ("gateway_worker", "frontend_worker", "queue", "dlq", "qdrant_collection"):
            with self.subTest(resource=key):
                self.assertIn("candidate", candidate[key])
                self.assertNotIn("candidate", production[key])
                self.assertNotIn("pr3", candidate[key] + production[key])
        self.assertEqual(release.supabase_url(candidate), "https://ukgjygzfhyvnrsecdcuu.supabase.co")
        self.assertEqual(release.supabase_url(production), "https://fcjaomiceajcdownarel.supabase.co")
        self.assertEqual(release.other_refs("candidate"), ["fcjaomiceajcdownarel"])

    def test_a_config_that_names_another_resource_is_refused(self):
        changes = {
            "apps/gateway/wrangler.preview.jsonc": lambda c: c.update(name="nexusrag-v6-preview-gateway"),
            "apps/gateway/wrangler.production.jsonc": lambda c: c["queues"]["consumers"][0].update(queue="nexusrag-v6-candidate-ingestion"),
            "frontend/wrangler.jsonc": lambda c: c["services"][0].update(service="nexusrag-v6-frontend-preview"),
        }
        for name, change in changes.items():
            with self.subTest(config=name), tempfile.TemporaryDirectory() as folder:
                root = copied_repository(folder)
                release.validate_targets(root)
                rewrite_json(root / name, change)
                with self.assertRaisesRegex(release.ReleaseError, "does not match"):
                    release.validate_targets(root)

    def test_retired_pr_configs_cannot_be_reintroduced(self):
        for retired in release.RETIRED_CONFIGS:
            with self.subTest(config=retired), tempfile.TemporaryDirectory() as folder:
                root = copied_repository(folder)
                (root / retired).write_text("{}")
                with self.assertRaisesRegex(release.ReleaseError, "Retired PR preview configuration"):
                    release.validate_targets(root)

    def test_query_redaction_and_asset_routing_are_required(self):
        cases = [
            ("apps/gateway/wrangler.preview.jsonc", lambda c: c["observability"].pop("redact_query_string"), "must redact"),
            ("frontend/wrangler.production.jsonc", lambda c: c["observability"].update(redact_query_string=False), "must redact"),
            ("frontend/wrangler.jsonc", lambda c: c["assets"].update(html_handling="auto-trailing-slash"), "asset routing"),
            ("frontend/wrangler.jsonc", lambda c: c["assets"].update(not_found_handling="single-page-application"), "asset routing"),
            ("frontend/wrangler.production.jsonc", lambda c: c["assets"].update(run_worker_first=False), "asset routing"),
            ("frontend/wrangler.jsonc", lambda c: c.update(main=".open-next/worker.js"), "asset routing"),
        ]
        for name, change, message in cases:
            with self.subTest(config=name, message=message), tempfile.TemporaryDirectory() as folder:
                root = copied_repository(folder)
                rewrite_json(root / name, change)
                with self.assertRaisesRegex(release.ReleaseError, message):
                    release.validate_targets(root)

    def test_the_document_wrapper_is_required(self):
        with tempfile.TemporaryDirectory() as folder:
            root = copied_repository(folder)
            wrapper = root / "frontend/worker.js"
            original = wrapper.read_text()
            for fragment in release.FRONTEND_WRAPPER:
                with self.subTest(fragment=fragment):
                    wrapper.write_text(original.replace(fragment, ""))
                    with self.assertRaisesRegex(release.ReleaseError, "does not preserve"):
                        release.validate_targets(root)
            wrapper.unlink()
            with self.assertRaisesRegex(release.ReleaseError, "wrapper frontend/worker.js is missing"):
                release.validate_targets(root)

    def test_versioned_preview_urls_are_disabled_everywhere(self):
        for name in CONFIGS[:4]:
            with self.subTest(config=name):
                self.assertIs(json.loads(release.strip_jsonc((ROOT / name).read_text()))["preview_urls"], False)


class SmokeTests(unittest.TestCase):
    target = release.TARGETS["candidate"]

    def gateway(self, fetch):
        with mock.patch.object(release, "fetch", side_effect=fetch):
            return release.gateway_failures(GATEWAY, self.target, SHA, MODELS, "gemini-embedding-001")

    def test_a_healthy_gateway_passes_and_any_fallback_model_is_accepted(self):
        self.assertEqual(self.gateway(healthy_gateway()), [])
        self.assertEqual(self.gateway(healthy_gateway(model="gemini-3.1-flash-lite")), [])

    def test_gateway_problems_are_named(self):
        self.assertIn("source_commit", " ".join(self.gateway(healthy_gateway(sha="b" * 40))))
        self.assertIn("models", " ".join(self.gateway(healthy_gateway(model="gemini-2.5-flash"))))
        self.assertIn("expected 401", " ".join(self.gateway(healthy_gateway(capabilities=200))))
        self.assertIn("/health returned HTTP 500", self.gateway(lambda url: (500, "error")))
        self.assertIn("/health returned HTTP 0", self.gateway(lambda url: (0, "URLError")))

    def readiness(self, report, status=None, allow_index_down=False):
        code = status if status is not None else (200 if report.get("readiness") == "READY" else 503)
        with mock.patch.object(release, "fetch", side_effect=lambda url: (code, json.dumps(report))) as fetch:
            result = release.readiness_check(GATEWAY, self.target, allow_index_down)
        fetch.assert_called_once_with(f"{GATEWAY}/ready")
        return result

    def test_a_ready_gateway_passes_and_reports_whether_its_index_holds_documents(self):
        failures, notes = self.readiness(ready_report())
        self.assertEqual(failures, [])
        self.assertEqual(notes, ["Search index: ready; `nexusrag-v6-candidate` holds indexed documents"])
        # An index that answers but holds nothing is worth knowing about: it may have been reset.
        self.assertEqual(self.readiness(ready_report(populated=False))[1], ["Search index: ready; `nexusrag-v6-candidate` is empty"])
        # A new environment has no collection until the first upload creates it.
        failures, notes = self.readiness(ready_report(index="EMPTY", populated=None))
        self.assertEqual(failures, [])
        self.assertIn("created by the first upload", " ".join(notes))

    def test_a_gateway_that_cannot_use_a_dependency_is_named(self):
        cases = [
            (ready_report(database="KEY_REJECTED"), "SUPABASE_SERVICE_ROLE_KEY"),
            (ready_report(database="SCHEMA_MISSING"), "migrations"),
            (ready_report(database="NOT_CONFIGURED"), "SUPABASE_URL"),
            (ready_report(database="UNAVAILABLE"), "database did not answer"),
            (ready_report(index="KEY_REJECTED"), "QDRANT_API_KEY"),
            (ready_report(index="NOT_CONFIGURED"), "QDRANT_URL"),
            (ready_report(index="NOT_ANSWERING"), "reactivate it in Qdrant Cloud"),
            (ready_report(index="RATE_LIMITED"), "RATE_LIMITED"),
            (ready_report(collection="nexusrag-v6-preview"), "expected 'nexusrag-v6-candidate'"),
        ]
        for report, expected in cases:
            with self.subTest(expected=expected):
                failures, _ = self.readiness(report)
                self.assertIn(expected, " ".join(failures))
        # A gateway older than /ready asks for a login; a dead one does not answer at all.
        self.assertEqual(self.readiness({"error": {"code": "AUTH_REQUIRED"}}, status=401)[0], ["/ready returned HTTP 401 without a readiness report"])
        self.assertEqual(self.readiness({}, status=0)[0], ["/ready returned HTTP 0 without a readiness report"])
        self.assertEqual(self.readiness({"readiness": "READY"}, status=200)[0], ["/ready returned HTTP 200 without a readiness report"])

    def test_only_an_index_that_does_not_answer_can_be_waived(self):
        failures, notes = self.readiness(ready_report(index="NOT_ANSWERING"), allow_index_down=True)
        self.assertEqual(failures, [])
        self.assertIn("did not answer", " ".join(notes))
        for report in (ready_report(index="KEY_REJECTED"), ready_report(index="NOT_CONFIGURED"),
                       ready_report(database="UNAVAILABLE"), ready_report(collection="nexusrag-v6-preview")):
            with self.subTest(report=report):
                self.assertTrue(self.readiness(report, allow_index_down=True)[0])

    def test_frontend_checks_identity_real_routes_and_unknown_paths(self):
        def run(fetch, policy=PAGE_POLICY):
            with mock.patch.object(release, "fetch", side_effect=fetch), \
                 mock.patch.object(release, "page_policy", return_value=policy) as page_policy:
                failures = release.frontend_failures(SITE, SHA, (GATEWAY, SUPABASE))
            page_policy.assert_called_once_with(f"{SITE}/")
            return failures
        self.assertEqual(run(healthy_frontend()), [])
        self.assertIn("build identity", " ".join(run(healthy_frontend(sha="b" * 40))))
        self.assertIn("unknown path returned HTTP 500", " ".join(run(healthy_frontend(unknown=500))))
        self.assertIn("/research returned HTTP 500", " ".join(run(healthy_frontend(research=500))))
        # A page without its own hashes means the deploy bypassed the Worker's entry point.
        connect = f"; connect-src 'self' {GATEWAY} {SUPABASE}"
        for policy in ("", "frame-ancestors 'none'; script-src 'self'" + connect,
                       "script-src 'self' 'unsafe-inline' 'sha256-teusDh2Hj0ZqbNia6tjQI1tFnalIUtE5EzYbJWecdcY='" + connect):
            with self.subTest(policy=policy):
                self.assertIn("without its script policy", " ".join(run(healthy_frontend(), policy)))
        # A build made for another gateway or Supabase project, or one that may connect anywhere, is refused.
        scripts = "script-src 'self' 'sha256-teusDh2Hj0ZqbNia6tjQI1tFnalIUtE5EzYbJWecdcY='"
        for policy in (scripts, f"{scripts}; connect-src 'self' {GATEWAY}",
                       f"{scripts}; connect-src 'self' {GATEWAY} https://fcjaomiceajcdownarel.supabase.co",
                       f"{scripts}; connect-src 'self' {GATEWAY} {SUPABASE} https://elsewhere.example"):
            with self.subTest(policy=policy):
                self.assertIn("may connect to", " ".join(run(healthy_frontend(), policy)))

    def test_smoke_checks_retry_while_a_deployment_propagates(self):
        results = iter([["not yet"], ["not yet"], []])
        with mock.patch.object(release.time, "sleep") as sleep:
            self.assertEqual(release.until_clean(lambda: next(results)), [])
        self.assertEqual(sleep.call_count, 2)
        with mock.patch.object(release.time, "sleep"):
            self.assertEqual(release.until_clean(lambda: ["still failing"], attempts=3), ["still failing"])


class ReleaseFlowTests(unittest.TestCase):
    env = {
        "CLOUDFLARE_API_TOKEN": "synthetic-token-do-not-log", "CLOUDFLARE_ACCOUNT_ID": "account",
        "SUPABASE_URL": "https://ukgjygzfhyvnrsecdcuu.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_synthetic",
    }

    def run_gateway(self, fetch, previous=PREVIOUS, extra_env=None, secrets=True, arguments=()):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / "output"
            secrets_file = Path(folder) / "secrets.json"
            secrets_file.write_text("{}")
            env = {**self.env, "GITHUB_OUTPUT": str(output), **(extra_env or {})}
            completed = mock.Mock(returncode=0)
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(release, "origins", return_value={"gateway": GATEWAY, "frontend": SITE}), \
                 mock.patch.object(release, "active_version", return_value=previous), \
                 mock.patch.object(release, "wrangler", return_value=completed) as wrangler, \
                 mock.patch.object(release, "fetch", side_effect=fetch), \
                 mock.patch.object(release.time, "sleep"), \
                 mock.patch("sys.stdout", io.StringIO()) as out, mock.patch("sys.stderr", out):
                code = release.main(["gateway", "--target", "candidate", "--sha", SHA, *arguments,
                                     *(["--secrets-file", str(secrets_file)] if secrets else [])])
            written = output.read_text() if output.exists() else ""
        return code, out.getvalue(), wrangler, written

    def test_a_good_release_ships_secrets_and_states_every_variable(self):
        code, printed, wrangler, written = self.run_gateway(healthy_gateway())
        self.assertEqual(code, 0)
        deploy = next(call.args for call in wrangler.call_args_list if call.args[0] == "deploy")
        self.assertIn("--keep-vars", deploy)
        self.assertIn("--secrets-file", deploy)
        self.assertEqual(deploy[deploy.index("--config") + 1], "apps/gateway/wrangler.preview.jsonc")
        variables = {item.split(":", 1)[0]: item.split(":", 1)[1] for item in deploy if ":" in item and not item.startswith("release")}
        self.assertEqual(variables["SOURCE_COMMIT"], SHA)
        self.assertEqual(variables["QDRANT_COLLECTION"], "nexusrag-v6-candidate")
        self.assertEqual(variables["GEMINI_MODEL"], ",".join(MODELS))
        self.assertEqual(variables["GEMINI_EMBEDDING_MODEL"], "gemini-embedding-001")
        self.assertEqual(variables["FRONTEND_ORIGIN"], SITE)
        self.assertEqual(variables["SUPABASE_URL"], "https://ukgjygzfhyvnrsecdcuu.supabase.co")
        self.assertFalse([call for call in wrangler.call_args_list if call.args[0] == "rollback"])
        self.assertIn("Smoke test: passed", printed)
        self.assertIn("Search index: ready; `nexusrag-v6-candidate` holds indexed documents", printed)
        self.assertEqual(written, f"previous_version={PREVIOUS}\n")
        self.assertNotIn("synthetic-token", printed)

    def test_a_gateway_that_cannot_reach_its_index_is_rolled_back_unless_that_is_accepted(self):
        code, printed, wrangler, _ = self.run_gateway(healthy_gateway(ready=ready_report(index="KEY_REJECTED")))
        self.assertEqual(code, 1)
        self.assertTrue([call for call in wrangler.call_args_list if call.args[0] == "rollback"])
        self.assertIn("QDRANT_API_KEY", printed)

        asleep = healthy_gateway(ready=ready_report(index="NOT_ANSWERING"))
        code, printed, wrangler, _ = self.run_gateway(asleep)
        self.assertEqual(code, 1)
        self.assertIn("reactivate it in Qdrant Cloud", printed)
        code, printed, wrangler, _ = self.run_gateway(asleep, arguments=["--allow-index-down"])
        self.assertEqual(code, 0)
        self.assertFalse([call for call in wrangler.call_args_list if call.args[0] == "rollback"])
        self.assertIn("released anyway because --allow-index-down was given", printed)

    def test_a_failed_smoke_test_rolls_back_to_the_previous_version(self):
        code, printed, wrangler, _ = self.run_gateway(healthy_gateway(sha="b" * 40))
        self.assertEqual(code, 1)
        rollback = next(call.args for call in wrangler.call_args_list if call.args[0] == "rollback")
        self.assertEqual(rollback[1], PREVIOUS)
        self.assertEqual(rollback[rollback.index("--name") + 1], "nexusrag-v6-candidate-gateway")
        self.assertIn("--yes", rollback)
        self.assertIn(f"rolled back to {PREVIOUS}", printed)

    def test_a_first_deployment_that_fails_has_nothing_to_roll_back_to(self):
        code, printed, wrangler, _ = self.run_gateway(healthy_gateway(capabilities=200), previous=None)
        self.assertEqual(code, 1)
        self.assertFalse([call for call in wrangler.call_args_list if call.args[0] == "rollback"])
        self.assertIn("no earlier version exists", printed)

    def test_a_target_refuses_another_environments_database(self):
        code, printed, wrangler, _ = self.run_gateway(
            healthy_gateway(), extra_env={"SUPABASE_URL": "https://fcjaomiceajcdownarel.supabase.co"})
        self.assertEqual(code, 1)
        self.assertIn("may only use the Supabase project ukgjygzfhyvnrsecdcuu", printed)
        wrangler.assert_not_called()

    def test_missing_queues_are_created_with_the_free_plan_retention(self):
        results = [mock.Mock(returncode=1), mock.Mock(returncode=0), mock.Mock(returncode=0)]
        with mock.patch.object(release, "wrangler", side_effect=results) as wrangler:
            release.ensure_queues(release.TARGETS["candidate"])
        create = wrangler.call_args_list[1].args
        self.assertEqual(create[:3], ("queues", "create", "nexusrag-v6-candidate-ingestion"))
        self.assertEqual(create[-2:], ("--message-retention-period-secs", "86400"))

    def test_frontend_build_must_be_for_this_commit_and_this_environment(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / "frontend/.open-next/assets"
            assets.mkdir(parents=True)
            env = {"CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ACCOUNT_ID": "account"}
            with mock.patch.object(release, "ROOT", root), mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(release.subprocess, "run") as run:
                with self.assertRaisesRegex(release.ReleaseError, "Build the frontend for this commit first"):
                    release.release_frontend("candidate", SHA)
                (assets / "_nexus-build.json").write_text(json.dumps({"source_commit": SHA}))
                (root / "frontend/.open-next/worker.js").write_text('const url = "https://fcjaomiceajcdownarel.supabase.co";')
                with self.assertRaisesRegex(release.ReleaseError, "another environment's Supabase project"):
                    release.release_frontend("candidate", SHA)
                run.assert_not_called()

    def test_frontend_release_deploys_then_rolls_back_on_a_failed_smoke_test(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            assets = root / "frontend/.open-next/assets"
            assets.mkdir(parents=True)
            (assets / "_nexus-build.json").write_text(json.dumps({"source_commit": SHA}))
            env = {"CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ACCOUNT_ID": "account"}
            for fetch, expected in [(healthy_frontend(), 0), (healthy_frontend(unknown=500), 1)]:
                with self.subTest(expected=expected), mock.patch.object(release, "ROOT", root), \
                     mock.patch.dict(os.environ, env, clear=True), \
                     mock.patch.object(release, "origins", return_value={"gateway": GATEWAY, "frontend": SITE}), \
                     mock.patch.object(release, "active_version", return_value=PREVIOUS), \
                     mock.patch.object(release.subprocess, "run", return_value=mock.Mock(returncode=0)) as run, \
                     mock.patch.object(release, "wrangler", return_value=mock.Mock(returncode=0)) as wrangler, \
                     mock.patch.object(release, "fetch", side_effect=fetch), mock.patch.object(release.time, "sleep"), \
                     mock.patch.object(release, "page_policy", return_value=PAGE_POLICY), \
                     mock.patch("sys.stdout", io.StringIO()):
                    self.assertEqual(release.release_frontend("candidate", SHA), expected)
                    self.assertEqual(run.call_args.args[0], ["npm", "run", "cf:deploy", "--", "--config", "wrangler.jsonc"])
                    self.assertEqual(bool(wrangler.call_args_list), expected == 1)

    def test_active_version_reads_the_deployment_taking_traffic(self):
        body = {"result": {"deployments": [{"versions": [{"version_id": "old", "percentage": 10}, {"version_id": PREVIOUS, "percentage": 90}]}]}}
        with mock.patch.object(release, "cloudflare", return_value=body):
            self.assertEqual(release.active_version("worker", "account", "token"), PREVIOUS)
        with mock.patch.object(release, "cloudflare", return_value={"result": {"deployments": []}}):
            self.assertIsNone(release.active_version("worker", "account", "token"))
        with mock.patch.object(release, "cloudflare", side_effect=release.ReleaseError("Cloudflare API returned HTTP 404 for /x")):
            self.assertIsNone(release.active_version("worker", "account", "token"))
        with mock.patch.object(release, "cloudflare", side_effect=release.ReleaseError("Cloudflare API returned HTTP 403 for /x")):
            with self.assertRaises(release.ReleaseError):
                release.active_version("worker", "account", "token")

    def test_command_line_rejects_bad_input_without_side_effects(self):
        env = {"CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ACCOUNT_ID": "account"}
        cases = [
            (["gateway", "--target", "candidate", "--sha", "abc"], "full 40-character commit SHA"),
            (["rollback", "--target", "production", "--component", "gateway", "--version", "latest"], "Worker version ID"),
            (["rollback", "--target", "production", "--version", PREVIOUS], "needs --component"),
            (["gateway", "--target", "candidate", "--sha", SHA], "Missing environment: SUPABASE_URL"),
        ]
        for argv, message in cases:
            with self.subTest(argv=argv), mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(release, "wrangler") as wrangler, mock.patch("sys.stdout", io.StringIO()) as stdout, \
                 mock.patch("sys.stderr", io.StringIO()) as out:
                self.assertEqual(release.main(argv), 1)
                self.assertEqual(stdout.getvalue(), "", "errors must not reach redirected stdout")
                self.assertIn(message, out.getvalue())
                wrangler.assert_not_called()

    def test_rollback_command_restores_the_named_version(self):
        env = {"CLOUDFLARE_API_TOKEN": "token", "CLOUDFLARE_ACCOUNT_ID": "account"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch("sys.stdout", io.StringIO()), \
             mock.patch.object(release, "wrangler", return_value=mock.Mock(returncode=0)) as wrangler:
            self.assertEqual(release.main(["rollback", "--target", "production", "--component", "gateway", "--version", PREVIOUS]), 0)
        arguments = wrangler.call_args.args
        self.assertEqual(arguments[:2], ("rollback", PREVIOUS))
        self.assertEqual(arguments[arguments.index("--name") + 1], "nexusrag-v6-preview-gateway")


class WorkflowTests(unittest.TestCase):
    @staticmethod
    def load(name):
        text = (ROOT / ".github/workflows" / name).read_text()
        workflow = yaml.safe_load(text)
        return text, workflow, workflow.get(True) or workflow.get("on")

    @staticmethod
    def steps(job):
        return [step.get("name") or step.get("run") or step.get("uses") for step in job["steps"]]

    def test_preview_deploys_only_on_request_and_only_to_the_candidate(self):
        text, workflow, triggers = self.load("cloudflare-preview-deploy.yml")
        self.assertEqual(set(triggers), {"workflow_dispatch", "pull_request"})
        self.assertEqual(triggers["pull_request"]["branches"], ["main"])
        jobs = workflow["jobs"]
        # Required check names; on pull requests both jobs are skipped.
        self.assertEqual(jobs["gateway"]["name"], "Deploy authenticated Evidence API gateway")
        self.assertEqual(jobs["frontend"]["name"], "Build and deploy OpenNext frontend")
        for job in jobs.values():
            self.assertEqual(job["if"], "${{ github.event_name == 'workflow_dispatch' && inputs.deploy_candidate_preview }}")
        self.assertEqual(text.count("--target candidate"), 4)
        self.assertNotIn("--target production", text)
        self.assertNotIn("preview_target.py", text)
        self.assertIn("--secrets-file", text)
        for probe in ("nexus_management_version", "nexus_authorize_byok_processing", "nexus_processing_policy_version"):
            self.assertIn(probe, text)
        self.assertEqual(workflow["permissions"], {"contents": "read"})

    def test_production_releases_only_main_on_request_in_a_safe_order(self):
        text, workflow, triggers = self.load("production-deploy.yml")
        self.assertEqual(set(triggers), {"workflow_dispatch"})
        self.assertNotIn("deploy-production", text)
        self.assertNotIn("check_execution_ledger", text)
        self.assertEqual(text.count("--target production"), 6)
        self.assertNotIn("--target candidate", text)
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        gateway = self.steps(workflow["jobs"]["gateway"])
        order = [
            "Verify the release is the current main commit", "Check required configuration",
            "Snapshot and apply pending migrations", "Deploy the gateway, smoke-test and roll back on failure",
        ]
        self.assertEqual([step for step in gateway if step in order], order)
        configuration = next(step["run"] for step in workflow["jobs"]["gateway"]["steps"] if step.get("name") == "Check required configuration")
        for secret in ("SUPABASE_DB_URL", "GEMINI_USER_KEY_ENCRYPTION_SECRET", "QDRANT_API_KEY"):
            self.assertIn(secret, configuration)
        self.assertIn("migration_status.py apply --snapshot-label", text)
        self.assertIn("--secrets-file", text)
        frontend = workflow["jobs"]["frontend"]
        self.assertEqual(frontend["needs"], "gateway")
        self.assertIn("Roll the frontend back if a later check failed", self.steps(frontend))
        restore = workflow["jobs"]["restore-gateway"]
        self.assertEqual(restore["needs"], ["gateway", "frontend"])
        self.assertIn("needs.frontend.result != 'success'", restore["if"])
        for job in workflow["jobs"].values():
            self.assertEqual(job["environment"], "Production")


if __name__ == "__main__":
    unittest.main()
