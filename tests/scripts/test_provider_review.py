"""The operator's provider review: fingerprints of the terms text, nothing recorded on a failed read."""
import io
import json
import os
from pathlib import Path
import unittest
from unittest import mock

import yaml

from scripts import provider_review as review

ROOT = Path(__file__).resolve().parents[2]
TERMS = "<html><head><style>.a{}</style><script>var t = Date.now()</script></head><body><h1>Terms</h1><p>" + ("You may use the service. " * 40) + "</p></body></html>"
ENV = {"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "synthetic-service-key-do-not-log"}


class FingerprintTests(unittest.TestCase):
    def test_fingerprint_ignores_markup_scripts_and_whitespace_but_not_wording(self):
        first, length = review.terms_fingerprint(TERMS.encode())
        reformatted = TERMS.replace("<p>", "<div class='x'>\n\n   ").replace("</p>", "</div>").replace("Date.now()", "12345")
        self.assertEqual(review.terms_fingerprint(reformatted.encode())[0], first)
        self.assertNotEqual(review.terms_fingerprint(TERMS.replace("may use", "may not use").encode())[0], first)
        self.assertRegex(first, r"^[0-9a-f]{64}$")
        self.assertGreater(length, 500)

    def test_a_page_without_real_text_is_refused(self):
        with self.assertRaisesRegex(review.ReviewError, "too little text"):
            review.terms_fingerprint(b"<html><script>" + b"x" * 5000 + b"</script><body>Sign in</body></html>")
        with self.assertRaisesRegex(review.ReviewError, "HTTPS"):
            review.fetch_terms("http://example.com/terms")


class ServiceKeyTests(unittest.TestCase):
    def test_a_secret_key_is_never_sent_as_a_bearer_token(self):
        secret = review.Database("https://example.supabase.co", "sb_secret_test").headers
        self.assertEqual(secret["apikey"], "sb_secret_test")
        self.assertNotIn("Authorization", secret)
        legacy = review.Database("https://example.supabase.co", "eyJsynthetic.legacy.jwt").headers
        self.assertEqual(legacy["Authorization"], "Bearer eyJsynthetic.legacy.jwt")


class CommandTests(unittest.TestCase):
    def run_cli(self, argv, database, fetch=None):
        calls = []

        def call(self_, method, path, body=None):
            calls.append((method, path, body))
            return database(method, path, body)

        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(review.Database, "call", call), \
             mock.patch.object(review, "fetch_terms", side_effect=fetch or (lambda url: TERMS.encode())), \
             mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
            code = review.main(argv)
        return code, out.getvalue(), err.getvalue(), calls

    @staticmethod
    def healthy(method, path, body):
        if path.startswith("provider_registry"):
            return [{"id": p, "terms_url": f"https://terms.example/{p}"} for p in review.PROVIDERS]
        if path.endswith("nexus_record_provider_review"):
            return {"provider": body["p_provider"], "revision": 2, "terms_changed": body["p_provider"] == "gemini"}
        return [{"provider": p, "current": True, "renew_soon": False, "terms_checked_at": "2026-11-12T00:00:00Z",
                 "valid_until": "2027-11-12T00:00:00Z"} for p in review.PROVIDERS]

    def test_record_fingerprints_every_provider_and_names_the_reviewer(self):
        code, out, err, calls = self.run_cli(["record", "--reviewer-email", "owner@example.com", "--i-have-read-the-terms"], self.healthy)
        self.assertEqual(code, 0, err)
        recorded = [body for method, path, body in calls if path.endswith("nexus_record_provider_review")]
        self.assertEqual([body["p_provider"] for body in recorded], list(review.PROVIDERS))
        expected = review.terms_fingerprint(TERMS.encode())[0]
        for body in recorded:
            self.assertEqual(body["p_reviewer_email"], "owner@example.com")
            self.assertEqual(body["p_content_hash"], expected)
            self.assertEqual(body["p_terms_url"], f"https://terms.example/{body['p_provider']}")
        self.assertIn("recorded gemini: revision 2, new terms: workspace owners will be asked to approve again", out)
        self.assertIn("recorded qdrant: revision 2, terms unchanged", out)
        self.assertNotIn("synthetic-service-key", out + err)

    def test_nothing_is_recorded_when_one_terms_page_cannot_be_read(self):
        def fetch(url):
            if url.endswith("qdrant"):
                raise review.ReviewError("The terms page returned HTTP 503")
            return TERMS.encode()
        code, _, err, calls = self.run_cli(["record", "--reviewer-email", "owner@example.com", "--i-have-read-the-terms"], self.healthy, fetch)
        self.assertEqual(code, 1)
        self.assertIn("HTTP 503", err)
        self.assertFalse([path for _, path, _ in calls if path.endswith("nexus_record_provider_review")])

    def test_record_requires_the_reviewer_and_the_confirmation(self):
        for argv in (["record"], ["record", "--reviewer-email", "owner@example.com"], ["record", "--i-have-read-the-terms"]):
            with self.subTest(argv=argv):
                code, _, err, calls = self.run_cli(argv, self.healthy)
                self.assertEqual(code, 1)
                self.assertIn("--reviewer-email and --i-have-read-the-terms", err)
                self.assertEqual(calls, [])

    def test_status_fails_when_a_review_is_missing_or_about_to_lapse(self):
        def lapsing(method, path, body):
            rows = self.healthy(method, path, body)
            rows[1]["renew_soon"] = True
            return rows

        def missing(method, path, body):
            rows = self.healthy(method, path, body)
            rows[2].update(current=False, terms_checked_at=None, valid_until=None)
            return rows
        self.assertEqual(self.run_cli(["status"], self.healthy)[0], 0)
        code, out, err, _ = self.run_cli(["status"], lapsing)
        self.assertEqual(code, 1)
        self.assertIn("renew within 30 days", out)
        code, out, err, _ = self.run_cli(["status"], missing)
        self.assertEqual(code, 1)
        self.assertIn("| `supabase_storage` | **no** | never |", out)

    def test_missing_configuration_and_database_errors_are_reported_without_secrets(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(review.main(["status"]), 2)
        self.assertIn("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required", err.getvalue())

        def refused(method, path, body):
            raise review.ReviewError("The database refused the request (HTTP 400, INVALID_SCOPE): the reviewer must be a confirmed account of this deployment.")
        code, out, err, _ = self.run_cli(["record", "--reviewer-email", "x@example.com", "--i-have-read-the-terms"], refused)
        self.assertEqual(code, 1)
        self.assertIn("confirmed account", err)
        self.assertNotIn("synthetic-service-key", out + err)

    def test_workflow_is_manual_only_and_needs_the_confirmation(self):
        text = (ROOT / ".github/workflows/provider-review.yml").read_text()
        workflow = yaml.safe_load(text)
        triggers = workflow.get(True) or workflow.get("on")
        self.assertEqual(set(triggers), {"workflow_dispatch"})
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        self.assertEqual(triggers["workflow_dispatch"]["inputs"]["action"]["default"], "status")
        self.assertIs(triggers["workflow_dispatch"]["inputs"]["i_have_read_the_terms"]["default"], False)
        self.assertIn('test "$TERMS_READ" = true', text)
        self.assertIn("inputs.target == 'production' && 'Production' || 'NexusRAG-Candidate-Preview'", text)


if __name__ == "__main__":
    unittest.main()
