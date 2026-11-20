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

    def __init__(self, exists=False, subdomain="nexusrag.pages.dev", stages=("queued", "deploy:success"), project=PROJECT,
                 health=((200, "nexusrag-v6-preview-gateway"),)):
        self.exists, self.subdomain, self.stages, self.calls = exists, subdomain, list(stages), []
        self.project, self.health, self.asked = project, list(health), []

    def gateway_behind(self, public_url):
        """Who answers /health at the public address, as (HTTP status, service): the last answer repeats."""
        self.asked.append(public_url)
        return self.health.pop(0) if len(self.health) > 1 else self.health[0]

    def __call__(self, method, path, token, *, body=None, form=None, missing_ok=False):
        assert token == ENV["CLOUDFLARE_API_TOKEN"]
        assert missing_ok == ((method, path) == ("GET", self.project)), "only a missing project may be created"
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
             mock.patch.object(front_door, "gateway_behind", self.gateway_behind), \
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
        self.assertEqual(config["services"], {"APP": {"service": "nexusrag-v6-frontend-preview", "environment": "production"},
                                              "GATEWAY": {"service": "nexusrag-v6-preview-gateway", "environment": "production"}})
        self.assertEqual(config["env_vars"]["FALLBACK_ORIGIN"],
                         {"type": "plain_text", "value": "https://nexusrag-v6-frontend-preview.example.workers.dev"})
        self.assertEqual(config["env_vars"]["PUBLIC_ORIGIN"], {"type": "plain_text", "value": "https://nexusrag.pages.dev"},
                         "every other address of the project is sent to the public one")
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
        cloudflare = Cloudflare(subdomain="nexusrag-preview.pages.dev", project="/accounts/account/pages/projects/nexusrag-preview",
                                health=((200, "nexusrag-v6-candidate-gateway"),))
        self.assertEqual(cloudflare.run("deploy", "--target", "candidate")[0], 0)
        self.assertEqual(set(cloudflare.asked), {"https://nexusrag-preview.pages.dev"})
        patch = next(body for method, _, body, _ in cloudflare.calls if method == "PATCH")
        services = patch["deployment_configs"]["production"]["services"]
        self.assertEqual(services["APP"]["service"], "nexusrag-v6-candidate-frontend")
        self.assertEqual(services["GATEWAY"]["service"], "nexusrag-v6-candidate-gateway")
        self.assertEqual(patch["deployment_configs"]["production"]["env_vars"]["PUBLIC_ORIGIN"]["value"],
                         "https://nexusrag-preview.pages.dev")

    def test_the_deploy_waits_until_the_address_answers_as_the_gateway(self):
        # The frontend's own not-found page answers until the new deployment reaches every location.
        cloudflare = Cloudflare(exists=True, health=((404, None), (404, None), (200, "nexusrag-v6-preview-gateway")))
        code, out, err = cloudflare.run("deploy", "--target", "production")
        self.assertEqual(code, 0, err)
        self.assertEqual(cloudflare.asked, ["https://nexusrag.pages.dev"] * 3)
        self.assertIn("its API from nexusrag-v6-preview-gateway", out)

        for answer in ((404, None), (200, "nexusrag-v6-candidate-gateway"), (0, None)):
            with self.subTest(answer=answer):
                code, _, err = Cloudflare(exists=True, health=(answer,)).run("deploy", "--target", "production")
                self.assertEqual(code, 1)
                self.assertIn("https://nexusrag.pages.dev/health is not answered by nexusrag-v6-preview-gateway", err)
                self.assertIn("GATEWAY binding", err)

    def test_a_deployment_that_fails_is_reported(self):
        code, _, err = Cloudflare(stages=("deploy:failure",)).run("deploy", "--target", "production")
        self.assertEqual(code, 1)
        self.assertIn("stopped at deploy: failure", err)

    def test_plan_names_the_address_and_binding_without_calling_cloudflare(self):
        cloudflare = Cloudflare()
        code, out, _ = cloudflare.run("plan", "--target", "production")
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out)["bindings"], {"APP": "nexusrag-v6-frontend-preview", "GATEWAY": "nexusrag-v6-preview-gateway"})
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
            self.assertEqual(front_door.api("GET", PROJECT, "token", missing_ok=True), {"success": False, "status": 404})
        gone = front_door.error.HTTPError("https://api.invalid", 404, "Not Found", {},
                                          io.BytesIO(json.dumps({"errors": [{"message": "Deployment not found"}]}).encode()))
        with mock.patch.object(front_door.request, "urlopen", side_effect=gone):
            with self.assertRaisesRegex(ReleaseError, "HTTP 404 .*Deployment not found"):
                front_door.api("GET", f"{PROJECT}/deployments/unknown", "token")
        refused = front_door.error.HTTPError("https://api.invalid", 403, "Forbidden", {},
                                             io.BytesIO(json.dumps({"errors": [{"message": "Authentication error"}]}).encode()))
        with mock.patch.object(front_door.request, "urlopen", side_effect=refused):
            with self.assertRaisesRegex(ReleaseError, "HTTP 403 .*Authentication error"):
                front_door.api("POST", PROJECT, "token", body={})


if __name__ == "__main__":
    unittest.main()
