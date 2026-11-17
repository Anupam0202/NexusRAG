"""The front door gets its project, binding and code from the Cloudflare API, and refuses an address it would not own."""
import io
import json
import os
import unittest
from unittest import mock

from scripts import front_door
from scripts.release import ReleaseError

ENV = {"CLOUDFLARE_API_TOKEN": "synthetic-token-do-not-log", "CLOUDFLARE_ACCOUNT_ID": "account"}
PROJECT = "/accounts/account/pages/projects/nexusrag"


class Cloudflare:
    """The parts of the Cloudflare API the front door uses. `subdomain` is the address a new project gets."""

    def __init__(self, exists=False, subdomain="nexusrag.pages.dev", stages=("queued", "deploy:success"), project=PROJECT):
        self.exists, self.subdomain, self.stages, self.calls = exists, subdomain, list(stages), []
        self.project = project

    def __call__(self, method, path, token, *, body=None, form=None):
        assert token == ENV["CLOUDFLARE_API_TOKEN"]
        self.calls.append((method, path, body, form))
        if path == "/accounts/account/workers/subdomain":
            return {"success": True, "result": {"subdomain": "example"}}
        if (method, path) == ("GET", self.project):
            return {"success": True, "result": {"name": "nexusrag", "subdomain": self.subdomain}} if self.exists else {"success": False, "status": 404}
        if (method, path) == ("POST", "/accounts/account/pages/projects"):
            self.exists = True
            return {"success": True, "result": {"name": body["name"], "subdomain": self.subdomain}}
        if (method, path) == ("PATCH", self.project):
            return {"success": True, "result": {}}
        if (method, path) == ("POST", f"{self.project}/deployments"):
            return {"success": True, "result": {"id": "deployment-1"}}
        if (method, path) == ("GET", f"{self.project}/deployments/deployment-1"):
            stage = self.stages.pop(0) if len(self.stages) > 1 else self.stages[0]
            name, _, status = stage.partition(":")
            return {"success": True, "result": {"latest_stage": {"name": name, "status": status or "active"}}}
        raise AssertionError(f"unexpected call {method} {path}")

    def run(self, *argv):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, ENV, clear=True), mock.patch.object(front_door, "api", self), \
             mock.patch.object(front_door.time, "sleep"), mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
            code = front_door.main(list(argv))
        return code, out.getvalue(), err.getvalue()


class FrontDoorTests(unittest.TestCase):
    def test_a_missing_front_door_is_created_bound_to_the_frontend_worker_and_deployed(self):
        cloudflare = Cloudflare()
        code, out, err = cloudflare.run("deploy", "--target", "production")
        self.assertEqual(code, 0, err)
        methods = [(method, path) for method, path, _, _ in cloudflare.calls]
        self.assertIn(("POST", "/accounts/account/pages/projects"), methods)
        patch = next(body for method, path, body, _ in cloudflare.calls if method == "PATCH")
        config = patch["deployment_configs"]["production"]
        self.assertEqual(config["services"], {"APP": {"service": "nexusrag-v6-frontend-preview", "environment": "production"}})
        self.assertEqual(config["env_vars"]["FALLBACK_ORIGIN"],
                         {"type": "plain_text", "value": "https://nexusrag-v6-frontend-preview.example.workers.dev"})
        self.assertLess(methods.index(("PATCH", PROJECT)), methods.index(("POST", f"{PROJECT}/deployments")),
                        "bindings are set before the deployment that reads them")
        form = next(form for method, path, _, form in cloudflare.calls if path.endswith("/deployments") and method == "POST")
        fields = {field[0]: field for field in form}
        self.assertEqual(fields["manifest"][1], "{}", "no static files are uploaded")
        self.assertEqual(fields["_worker.js"][2], front_door.FRONT_DOOR.read_bytes())
        self.assertIn("https://nexusrag.pages.dev serves nexusrag-v6-frontend-preview", out)
        self.assertNotIn("synthetic-token", out + err)

    def test_an_existing_front_door_is_updated_without_being_created_again(self):
        cloudflare = Cloudflare(exists=True)
        self.assertEqual(cloudflare.run("deploy", "--target", "production")[0], 0)
        self.assertNotIn(("POST", "/accounts/account/pages/projects"), [(m, p) for m, p, _, _ in cloudflare.calls])

    def test_an_address_cloudflare_gave_differently_is_refused_before_anything_is_deployed(self):
        cloudflare = Cloudflare(exists=True, subdomain="nexusrag-4kd.pages.dev")
        code, _, err = cloudflare.run("deploy", "--target", "production")
        self.assertEqual(code, 1)
        self.assertIn("the name is taken", err)
        self.assertFalse([call for call in cloudflare.calls if call[0] in {"PATCH", "POST"}])

    def test_the_preview_front_door_binds_only_the_preview_worker(self):
        cloudflare = Cloudflare(subdomain="nexusrag-preview.pages.dev", project="/accounts/account/pages/projects/nexusrag-preview")
        self.assertEqual(cloudflare.run("deploy", "--target", "candidate")[0], 0)
        patch = next(body for method, _, body, _ in cloudflare.calls if method == "PATCH")
        self.assertEqual(patch["deployment_configs"]["production"]["services"]["APP"]["service"], "nexusrag-v6-candidate-frontend")

    def test_a_deployment_that_fails_is_reported(self):
        code, _, err = Cloudflare(stages=("deploy:failure",)).run("deploy", "--target", "production")
        self.assertEqual(code, 1)
        self.assertIn("stopped at deploy: failure", err)

    def test_plan_names_the_address_and_binding_without_calling_cloudflare(self):
        cloudflare = Cloudflare()
        code, out, _ = cloudflare.run("plan", "--target", "production")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["binding"], {"APP": "nexusrag-v6-frontend-preview"})
        self.assertEqual(cloudflare.calls, [])

    def test_settings_are_required(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(front_door.main(["deploy", "--target", "production"]), 1)
        self.assertIn("Missing environment", err.getvalue())

    def test_multipart_carries_text_fields_and_the_code_file(self):
        body, kind = front_door.multipart([("manifest", "{}"), ("_worker.js", "_worker.js", b"export default {}", "application/javascript")])
        boundary = kind.split("boundary=")[1]
        self.assertTrue(body.startswith(f"--{boundary}\r\n".encode()) and body.endswith(f"--{boundary}--\r\n".encode()))
        self.assertIn(b'name="manifest"\r\n\r\n{}\r\n', body)
        self.assertIn(b'name="_worker.js"; filename="_worker.js"\r\nContent-Type: application/javascript\r\n\r\nexport default {}\r\n', body)

    def test_cloudflare_errors_are_named_without_raising_on_a_missing_project(self):
        self.assertEqual(front_door.api_errors(json.dumps({"errors": [{"code": 8000000, "message": "Name is invalid."}]}).encode()),
                         "Name is invalid.")
        self.assertEqual(front_door.api_errors(b"not json"), "no details")
        missing = front_door.error.HTTPError("https://api.invalid", 404, "Not Found", {}, io.BytesIO(b"{}"))
        with mock.patch.object(front_door.request, "urlopen", side_effect=missing):
            self.assertEqual(front_door.api("GET", PROJECT, "token"), {"success": False, "status": 404})
        refused = front_door.error.HTTPError("https://api.invalid", 403, "Forbidden", {},
                                             io.BytesIO(json.dumps({"errors": [{"message": "Authentication error"}]}).encode()))
        with mock.patch.object(front_door.request, "urlopen", side_effect=refused):
            with self.assertRaisesRegex(ReleaseError, "HTTP 403 .*Authentication error"):
                front_door.api("POST", PROJECT, "token", body={})


if __name__ == "__main__":
    unittest.main()
