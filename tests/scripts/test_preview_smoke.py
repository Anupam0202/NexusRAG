"""The live smoke test's workspace-deletion journey, run against an in-memory gateway: it must pass when the
service behaves, and name the first thing that does not."""
import io
import json
import os
import unittest
from unittest import mock
from urllib import parse

from scripts import preview_smoke as smoke

GATEWAY = "https://nexusrag-v6-candidate-gateway.example.workers.dev"
SUPABASE = "https://rehearsal.example.supabase.co"
ENV = {"SMOKE_GATEWAY_URL": GATEWAY, "SMOKE_SUPABASE_URL": SUPABASE, "SMOKE_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_synthetic",
       "SMOKE_USER_A_EMAIL": "a@example.test", "SMOKE_USER_A_PASSWORD": "synthetic-password-a",
       "SMOKE_USER_B_EMAIL": "b@example.test", "SMOKE_USER_B_PASSWORD": "synthetic-password-b"}


class Clock:
    """Time that passes only while the journey sleeps, so a wait for a deadline takes no real time."""

    def __init__(self):
        self.now = 1_000.0

    def time(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class Preview:
    """The parts of the candidate gateway and Supabase Auth the journey uses. `faults` names what it gets wrong."""

    def __init__(self, *faults: str, service: str = "nexusrag-v6-candidate-gateway", job: str = "failed"):
        self.faults, self.service, self.job = set(faults), service, job
        self.owners = {"home-a": "user-a", "home-b": "user-b"}  # workspace -> owner; no other members exist
        self.documents = {}                                      # document -> workspace
        self.stored = set()                                      # originals in file storage, by document
        self.approved = set()
        self.calls = []

    def call(self, method, url, *, headers=None, body=None, timeout=90):
        headers = {name.lower(): value for name, value in (headers or {}).items()}
        path = parse.urlsplit(url).path
        self.calls.append((method, path, headers.get("x-nexus-workspace-id")))
        if url.startswith(SUPABASE):
            for label in "ab":
                if body == {"email": f"{label}@example.test", "password": f"synthetic-password-{label}"}:
                    return 200, {"access_token": f"token-{label}", "user": {"id": f"user-{label}"}}
            return 400, {"error_code": "invalid_credentials"}
        if path == "/health":
            return 200, {"service": self.service, "source_commit": "0" * 40, "gemini_models": {}}
        if path == "/ready":
            return 200, {"readiness": "READY", "dependencies": {"database": {"state": "READY"}, "search_index": {"state": "READY"}}}
        user = {"Bearer token-a": "user-a", "Bearer token-b": "user-b"}.get(headers.get("authorization"))
        if not user:
            return 401, {"error": {"code": "AUTH_REQUIRED"}}
        mine = [workspace for workspace, owner in self.owners.items() if owner == user]
        if path == "/api/v1/workspaces" and method == "GET":
            return 200, {"workspaces": [{"workspace_id": workspace} for workspace in sorted(mine, key=lambda name: not name.startswith("home"))]}
        if path == "/api/v1/workspaces" and method == "POST":
            self.owners["throwaway"] = user
            return 201, {"workspace_id": "throwaway", "role": "owner"}
        workspace = headers.get("x-nexus-workspace-id")
        member = workspace in mine or ("member-leak" in self.faults and workspace in self.owners)
        if not member:
            return 403, {"error": {"code": "FORBIDDEN"}}
        if path == "/api/v1/privacy/processing-policy":
            if method == "PATCH":
                self.approved.add(workspace)
            return 200, {"operator_rights_current": True, "owner_can_manage": True, "terms_hash": "t", "policy_version": 1,
                         "state": "APPROVED" if workspace in self.approved else "REQUIRED"}
        if path == "/api/v1/documents/upload":
            self.documents["document-1"] = workspace
            self.stored.add("document-1")
            return 202, {"job_id": "job-1", "document": {"document_id": "document-1"}}
        if path == "/api/v1/documents":
            return 200, {"documents": [{"document_id": document} for document, home in self.documents.items() if home == workspace]}
        if path.startswith("/api/v1/documents/") and path.endswith("/status"):
            document = path.split("/")[4]
            reachable = self.documents.get(document) == workspace or ("document-leak" in self.faults and document in self.documents)
            return (200, {"status": self.job, "stage": "embedding"}) if reachable else (404, {"error": {"code": "NOT_FOUND"}})
        if path == "/api/v1/workspaces/current/delete":
            if self.owners.get(workspace) != user:
                return 403, {"error": {"code": "FORBIDDEN"}}
            if body.get("confirmation") != "DELETE WORKSPACE" and "any-confirmation" not in self.faults:
                return 422, {"error": {"code": "INVALID_SCOPE"}}
            if "still-listed" not in self.faults:
                del self.owners[workspace]
            pending = self.job == "processing"
            if not pending and "document-leak" not in self.faults:
                removed = [document for document, home in self.documents.items() if home == workspace]
                for document in removed:
                    del self.documents[document]
                    self.stored.discard(document)
            return (202 if pending else 200), {"workspace_deleted": True, "state": "PENDING" if pending else "DELETED", "operation_id": "operation-1",
                                               "documents_deleted": 0 if pending else 1, "receipts": 0 if pending else (2 if "missing-receipt" in self.faults else 3)}
        raise AssertionError(f"unexpected request: {method} {path}")

    def run(self, *argv, env=None):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, ENV if env is None else env, clear=True), mock.patch.object(smoke, "call", self.call), \
             mock.patch.object(smoke, "time", Clock()), mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
            code = smoke.main(list(argv))
        return code, out.getvalue(), err.getvalue()


class WorkspaceDeletionJourneyTests(unittest.TestCase):
    def test_a_service_that_behaves_passes_and_nothing_of_the_workspace_is_left(self):
        preview = Preview()
        code, out, _ = preview.run("--journey", "workspace-deletion")
        self.assertEqual(code, 0, out)
        self.assertIn("PREVIEW_SMOKE_PASS: 19/19 checks passed", out)
        self.assertNotIn("FAIL", out)
        self.assertEqual((preview.owners, preview.documents, preview.stored), ({"home-a": "user-a", "home-b": "user-b"}, {}, set()))
        # The model is never asked: no chat request is part of this journey.
        self.assertFalse([call for call in preview.calls if call[1] == "/api/v1/chat"])
        for secret in ("synthetic-password", "token-a", "token-b"):
            self.assertNotIn(secret, out)

    def test_each_fault_fails_at_its_own_check_and_the_run_cleans_up(self):
        for fault, check in (("member-leak", "account B cannot open the workspace"),
                             ("any-confirmation", "deleting needs the confirmation typed exactly"),
                             ("still-listed", "the workspace is gone from its owner's list at once"),
                             ("document-leak", "its document cannot be reached through another workspace"),
                             ("missing-receipt", "every stored copy is verified gone")):
            with self.subTest(fault=fault):
                preview = Preview(fault)
                code, out, _ = preview.run("--journey", "workspace-deletion")
                self.assertEqual(code, 1)
                failed = [line for line in out.splitlines() if line.startswith("FAIL")]
                self.assertEqual(len(failed), 1, out)
                self.assertTrue(failed[0].startswith(f"FAIL  {check}"), failed[0])
                self.assertIn("PREVIEW_SMOKE_FAIL", out)
                if fault == "member-leak":
                    # The run stopped before deleting, so it removes the workspace it created.
                    self.assertIn("clean-up: deleting the throwaway workspace returned HTTP 200 DELETED", out)
                    self.assertNotIn("throwaway", preview.owners)

    def test_an_erasure_that_waits_for_a_running_job_is_reported_as_left_to_the_cron(self):
        preview = Preview(job="processing")
        code, out, _ = preview.run("--journey", "workspace-deletion")
        self.assertEqual(code, 0, out)
        self.assertIn("PASS  the erasure waits for a running job and is left to the cron — operation operation-1", out)
        self.assertNotIn("every stored copy is verified gone", out)
        self.assertNotIn("throwaway", preview.owners, "hidden at once all the same")

    def test_only_the_candidate_gateway_is_touched_and_settings_are_required(self):
        production = Preview(service="nexusrag-v6-preview-gateway")
        code, out, _ = production.run("--journey", "workspace-deletion")
        self.assertEqual(code, 1)
        self.assertIn("FAIL  gateway is the candidate preview", out)
        self.assertEqual([call[1] for call in production.calls], ["/health"])
        code, _, err = Preview().run("--journey", "workspace-deletion", env={"SMOKE_GATEWAY_URL": GATEWAY})
        self.assertEqual(code, 2)
        self.assertIn("Missing environment", err)

    def test_the_report_names_the_journey(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / "report.json"
            Preview().run("--journey", "workspace-deletion", "--report", str(report))
            written = json.loads(report.read_text())
        self.assertEqual((written["passed"], written["journey"], len(written["checks"])), (True, "workspace-deletion", 19))


if __name__ == "__main__":
    unittest.main()
