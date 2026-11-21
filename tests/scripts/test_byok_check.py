"""The BYOK live check: what it refuses, that it always removes the key and restores the count, and that it never
prints the key, its fingerprint or a token (workflow logs are public)."""
import io
import os
from pathlib import Path
import unittest
from unittest import mock

import yaml

from scripts import byok_check as check

ROOT = Path(__file__).resolve().parents[2]
GATEWAY, SUPABASE = "https://nexusrag-preview.pages.dev", "https://rehearsal.supabase.co"
KEY, TOKEN, FINGERPRINT = "synthetic-user-gemini-key-do-not-print", "synthetic-access-token-do-not-print", "...wxyz-fingerprint"
ENV = {"SUPABASE_URL": SUPABASE, "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_synthetic", "BYOK_TEST_KEY": KEY}
ARGS = ["--gateway", GATEWAY, "--email", "nexus-e2e-b@nexusrag.test", "--question", "What pressure did the test reach?"]


class Fake:
    """The preview gateway and Supabase, as far as the check uses them."""

    def __init__(self, service=check.PREVIEW_GATEWAY, key=False, answer=None, usage=None):
        self.service, self.key, self.answer = service, key, answer
        self.usage = usage if usage is not None else [{"free_chat_queries": 2, "lifetime_documents": 1}]
        self.calls, self.usage_writes = [], []

    def __call__(self, method, url, headers, body=None):
        self.calls.append((method, url, headers, body))
        path = url.split("?")[0]
        if url == f"{GATEWAY}/health":
            return 200, {"service": self.service}
        if path == f"{SUPABASE}/auth/v1/admin/generate_link":
            assert headers == {"apikey": "sb_secret_synthetic"}, "a secret key is never a Bearer token"
            return 200, {"hashed_token": "hashed"}
        if path == f"{SUPABASE}/auth/v1/verify":
            return 200, {"access_token": TOKEN, "user": {"id": "user-1"}}
        if path == f"{SUPABASE}/rest/v1/nexus_account_usage":
            if method == "GET":
                return 200, self.usage
            self.usage_writes.append(body["free_chat_queries"])
            return 201, None
        assert headers.get("Authorization") == f"Bearer {TOKEN}", url
        if path == f"{GATEWAY}/api/v1/workspaces":
            return 200, {"workspaces": [{"workspace_id": "workspace-1"}]}
        assert headers.get("X-Nexus-Workspace-Id") == "workspace-1", url
        if path == f"{GATEWAY}/api/v1/documents":
            return 200, {"documents": [{"status": "ready"}]}
        if path == f"{GATEWAY}/api/v1/apikey":
            if method == "POST":
                assert body == {"api_key": KEY, "cost_consent": True}
                self.key = True
                return 200, {"workspace_key_configured": True, "key_fingerprint": FINGERPRINT}
            if method == "DELETE":
                self.key = False
                return 200, {"workspace_key_configured": False, "key_fingerprint": None}
            return 200, {"workspace_key_configured": self.key, "key_fingerprint": FINGERPRINT if self.key else None}
        if path == f"{GATEWAY}/api/v1/chat":
            if not self.key:
                return 402, {"error": {"code": "BYOK_REQUIRED", "message": "Your 5 free chat queries are used."}}
            return self.answer or (200, {"answer": "The test reached 4.7 bar [S1].", "sources": [{"id": "s"}],
                                         "metadata": {"provider_cost_owner": "USER_GOOGLE_PROJECT", "abstained": False}})
        raise AssertionError(f"unexpected call {method} {url}")


def run(fake, argv=ARGS, env=ENV):
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env, clear=True), mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
        code = check.main(argv, call=fake)
    return code, out.getvalue(), err.getvalue()


class CheckTests(unittest.TestCase):
    def assert_nothing_secret(self, *texts):
        for text in texts:
            for secret in (KEY, TOKEN, FINGERPRINT, "4.7 bar"):
                self.assertNotIn(secret, text)

    def test_the_key_is_stored_used_and_removed_and_the_count_restored(self):
        fake = Fake()
        code, out, err = run(fake)
        self.assertEqual(code, 0, out + err)
        self.assertIn("with the key, the question is answered at the account's own cost", out)
        self.assertIn("without the key, questions are refused again", out)
        self.assertFalse(fake.key)
        self.assertEqual(fake.usage_writes, [check.FREE_CHATS, 2], "free chats used up, then the count it found restored")
        chats = [url for _, url, _, _ in fake.calls if url.endswith("/api/v1/chat")]
        self.assertEqual(len(chats), 3, "refused, answered with the key, refused again")
        self.assert_nothing_secret(out, err)

    def test_only_the_preview_and_test_accounts_are_touched(self):
        for fake, argv in [(Fake(service="nexusrag-v6-preview-gateway"), ARGS),
                           (Fake(), ["--gateway", GATEWAY, "--email", "someone@example.com", "--question", "q"])]:
            with self.subTest(service=fake.service, argv=argv):
                code, out, err = run(fake, argv)
                self.assertEqual(code, 1)
                self.assertFalse([url for _, url, _, _ in fake.calls if url.startswith(SUPABASE)])
                self.assertFalse([url for _, url, _, _ in fake.calls if "/api/" in url])
        self.assertIn("not the preview", run(Fake(service="nexusrag-v6-preview-gateway"))[2])

    def test_a_failure_still_removes_the_key_and_restores_the_count(self):
        fake = Fake(answer=(503, {"error": {"code": "PROVIDER_UNAVAILABLE"}}))
        code, out, err = run(fake)
        self.assertEqual(code, 1)
        self.assertIn("FAIL  with the key, the question is answered at the account's own cost", out)
        self.assertFalse(fake.key, "the key is removed")
        self.assertEqual(fake.usage_writes, [check.FREE_CHATS, 2])
        self.assert_nothing_secret(out, err)

    def test_a_key_left_by_an_earlier_run_is_removed_first_and_a_missing_usage_row_restores_to_zero(self):
        fake = Fake(key=True, usage=[])
        code, out, err = run(fake)
        self.assertEqual(code, 0, out + err)
        self.assertIn("a key left by an earlier run is removed", out)
        self.assertEqual(fake.usage_writes, [check.FREE_CHATS, 0])

    def test_missing_configuration_is_reported_without_calls(self):
        fake = Fake()
        code, _, err = run(fake, env={"SUPABASE_URL": SUPABASE})
        self.assertEqual(code, 2)
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY, BYOK_TEST_KEY", err)
        self.assertEqual(fake.calls, [])


class WorkflowTests(unittest.TestCase):
    def test_workflow_is_manual_read_only_on_the_preview_and_keeps_the_key_out_of_the_script(self):
        text = (ROOT / ".github/workflows/byok-check.yml").read_text()
        workflow = yaml.safe_load(text)
        triggers = workflow.get(True) or workflow.get("on")
        self.assertEqual(set(triggers), {"workflow_dispatch"})
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        job = workflow["jobs"]["byok"]
        self.assertEqual(job["environment"], "NexusRAG-Candidate-Preview")
        self.assertEqual(job["env"]["BYOK_TEST_KEY"], "${{ secrets.GOOGLE_API_KEY }}")
        run_step = job["steps"][-1]["run"]
        self.assertNotIn("${{", run_step, "inputs and secrets reach the script through env, never interpolated")
        self.assertIn("--gateway https://nexusrag-preview.pages.dev", run_step)


if __name__ == "__main__":
    unittest.main()
