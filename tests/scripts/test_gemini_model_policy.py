"""The scripts follow the gateway's Gemini model policy (D24) and the weekly check fails on a retirement."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib import error

import yaml

from scripts import check_gemini_models as check
from scripts import gemini_model_policy as policy

ROOT = Path(__file__).resolve().parents[2]


def page(names, token=None):
    response = mock.MagicMock()
    body = {"models": [{"name": f"models/{name}"} for name in names], **({"nextPageToken": token} if token else {})}
    response.read.return_value = json.dumps(body).encode()
    response.__enter__.return_value = response
    return response


class ModelPolicyTests(unittest.TestCase):
    def test_defaults_come_from_the_gateway_module(self):
        self.assertEqual(policy.default_generation_models(),
                         ("gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"))
        self.assertEqual(policy.default_embedding_model(), "gemini-embedding-001")
        source = policy.GATEWAY_POLICY.read_text(encoding="utf-8")
        for model in policy.default_generation_models():
            self.assertIn(f'"{model}"', source)

    def test_overrides_are_validated_like_the_gateway(self):
        self.assertEqual(policy.generation_models(None), policy.default_generation_models())
        self.assertEqual(policy.generation_models(" gemini-3.6-flash , gemini-3.6-flash,x/../y "), ("gemini-3.6-flash",))
        self.assertEqual(policy.generation_models("../models"), policy.default_generation_models())
        self.assertEqual(policy.embedding_model("gemini-embedding-2"), "gemini-embedding-2")
        self.assertEqual(policy.embedding_model("bad/model"), "gemini-embedding-001")

    def test_thinking_settings_mirror_the_gateway(self):
        cases = {
            "gemini-2.5-flash": {"thinkingBudget": 0},
            "gemini-3.5-flash-lite": None,
            "gemini-3.1-flash-lite": None,
            "gemini-flash-latest": None,
            "gemini-3.6-flash": {"thinkingLevel": "low"},
            "gemini-4-flash": {"thinkingLevel": "low"},
            "gemini-10.1-pro": {"thinkingLevel": "low"},
            "gemma-3-27b-it": None,
        }
        for model, expected in cases.items():
            with self.subTest(model=model):
                self.assertEqual(policy.thinking_config(model), expected)


class WeeklyCheckTests(unittest.TestCase):
    def run_check(self, pages, environment=None):
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            env = {"GOOGLE_API_KEY": "synthetic-google-key-do-not-log", "GITHUB_STEP_SUMMARY": str(summary), **(environment or {})}
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(check.request, "urlopen", side_effect=pages) as urlopen, \
                 mock.patch("sys.stdout", output):
                code = check.main()
            written = summary.read_text() if summary.exists() else ""
        return code, output.getvalue(), written, urlopen

    def test_all_configured_models_listed_passes_across_pages(self):
        code, printed, written, urlopen = self.run_check([
            page(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], token="next"),
            page(["gemini-flash-latest", "gemini-embedding-001"]),
        ])
        self.assertEqual(code, 0)
        self.assertEqual(urlopen.call_count, 2)
        first, second = (call.args[0] for call in urlopen.call_args_list)
        self.assertIn("pageSize=1000", first.full_url)
        self.assertIn("pageToken=next", second.full_url)
        self.assertEqual(first.get_header("X-goog-api-key"), "synthetic-google-key-do-not-log")
        self.assertNotIn("synthetic-google-key", first.full_url)
        self.assertIn("Answers and extraction currently use `gemini-3.5-flash-lite`.", written)
        self.assertNotIn("::error::", printed)

    def test_a_retired_model_fails_and_names_it(self):
        code, printed, written, _ = self.run_check([page(["gemini-3.1-flash-lite", "gemini-flash-latest"])])
        self.assertEqual(code, 1)
        self.assertIn("::error::Google no longer lists `gemini-3.5-flash-lite`", printed)
        self.assertIn("::error::Google no longer lists `gemini-embedding-001`", printed)
        self.assertIn("currently use `gemini-3.1-flash-lite`", written)

    def test_overrides_are_checked_instead_of_defaults(self):
        code, _, written, _ = self.run_check([page(["gemini-3.6-flash", "gemini-embedding-2"])],
                                             {"GEMINI_MODEL": "gemini-3.6-flash", "GEMINI_EMBEDDING_MODEL": "gemini-embedding-2"})
        self.assertEqual(code, 0)
        self.assertIn("`gemini-3.6-flash`", written)

    def test_missing_key_and_http_errors_fail_without_echoing_secrets(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("sys.stdout", io.StringIO()) as out:
            self.assertEqual(check.main(), 1)
        self.assertIn("GOOGLE_API_KEY is missing", out.getvalue())
        denied = error.HTTPError("https://generativelanguage.googleapis.com", 403, "Forbidden", {}, io.BytesIO(b"key synthetic-google-key-do-not-log"))
        code, printed, _, _ = self.run_check(denied)
        self.assertEqual(code, 1)
        self.assertIn("HTTP 403", printed)
        self.assertNotIn("synthetic-google-key", printed)

    def test_workflow_runs_weekly_with_read_only_permissions(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/gemini-model-check.yml").read_text())
        triggers = workflow.get(True) or workflow.get("on")
        self.assertIn("schedule", triggers)
        self.assertIn("workflow_dispatch", triggers)
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        job = workflow["jobs"]["models"]
        self.assertEqual(job["environment"], "Preview")
        self.assertIn("python3 scripts/check_gemini_models.py", [step.get("run") for step in job["steps"]])


if __name__ == "__main__":
    unittest.main()
