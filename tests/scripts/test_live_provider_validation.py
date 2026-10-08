import os
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts import live_provider_validation as validation


class GeminiValidationContractTests(unittest.TestCase):
    def test_provider_response_is_bounded_and_object_shaped(self):
        for raw, message in [(b"x" * (2 * 1024 * 1024 + 1), "capacity"),
                             (b"[]", "JSON object")]:
            with self.subTest(message=message):
                response = mock.MagicMock()
                response.status = 200
                response.read.return_value = raw
                response.__enter__.return_value = response
                with mock.patch.object(validation.request, "urlopen", return_value=response):
                    with self.assertRaisesRegex(RuntimeError, message):
                        validation._json_request("GET", "https://provider.example")
                response.read.assert_called_once_with(2 * 1024 * 1024 + 1)

    def test_request_is_single_bounded_and_keeps_key_out_of_url(self):
        api_key = "synthetic-google-key-do-not-log"
        result = {
            "candidates": [
                {"content": {"parts": [{"text": "NEXUSRAG_GEMINI_OK"}]}}
            ],
            "usageMetadata": {"promptTokenCount": 18, "candidatesTokenCount": 4},
        }
        with mock.patch.dict(
            os.environ,
            {"GOOGLE_API_KEY": api_key, "GEMINI_API_KEY": "legacy-decoy"},
            clear=True,
        ):
            with mock.patch.object(
                validation, "_json_request", return_value=(200, result)
            ) as request:
                report = validation.validate_gemini()

        request.assert_called_once()
        method, url = request.call_args.args
        headers = request.call_args.kwargs["headers"]
        body = request.call_args.kwargs["body"]
        self.assertEqual(method, "POST")
        self.assertNotIn(api_key, url)
        self.assertNotIn("?key=", url)
        self.assertEqual(headers, {"x-goog-api-key": api_key})
        self.assertEqual(body["generationConfig"]["maxOutputTokens"], 128)
        self.assertEqual(body["generationConfig"]["candidateCount"], 1)
        self.assertEqual(body["generationConfig"]["temperature"], 0)
        self.assertEqual(body["generationConfig"]["thinkingConfig"]["thinkingBudget"], 0)
        self.assertEqual(report["state"], "READY")
        self.assertFalse(report["customer_data_sent"])
        self.assertFalse(report["paid_fallback"])

    def test_quota_exhaustion_fails_closed_without_paid_fallback(self):
        with mock.patch.dict(
            os.environ, {"GOOGLE_API_KEY": "synthetic-google-key"}, clear=True
        ):
            with mock.patch.object(
                validation,
                "_json_request",
                side_effect=validation.ProviderHttpError(429, "60"),
            ) as request:
                report = validation.validate_gemini()

        request.assert_called_once()
        self.assertEqual(report["state"], "QUOTA_EXHAUSTED")
        self.assertEqual(report["next_state"], "TRY_AFTER_RESET")
        self.assertFalse(report["paid_fallback"])
        self.assertFalse(report["customer_data_sent"])

    def test_missing_key_blocks_before_provider_request(self):
        with mock.patch.dict(os.environ, {"GEMINI_API_KEY": "legacy-only"}, clear=True):
            with mock.patch.object(validation, "_json_request") as request:
                with self.assertRaisesRegex(RuntimeError, "missing protected secret"):
                    validation.validate_gemini()
        request.assert_not_called()

    def test_unavailable_http_is_recorded_without_retry_or_paid_fallback(self):
        for status, reason in [(503, "PROVIDER_HTTP_FAILURE"), (401, "AUTHORIZATION_FAILED"),
                               (403, "AUTHORIZATION_FAILED"), (404, "MODEL_UNAVAILABLE")]:
            with self.subTest(status=status), mock.patch.dict(
                os.environ, {"GOOGLE_API_KEY": "synthetic-google-key"}, clear=True
            ), mock.patch.object(validation, "_json_request",
                side_effect=validation.ProviderHttpError(status, "30")) as request:
                report = validation.validate_gemini()
                request.assert_called_once()
                self.assertEqual(report["state"], "PROVIDER_UNAVAILABLE")
                self.assertEqual(report["reason"], reason)
                self.assertEqual(report["usage_status"], "UNKNOWN")
                self.assertEqual(report["retry_after"], "30")
                self.assertFalse(report["automatic_retry"])
                self.assertFalse(report["paid_fallback"])

    def test_ambiguous_transport_failure_does_not_replay_metered_post(self):
        with mock.patch.dict(os.environ, {"GOOGLE_API_KEY": "synthetic-google-key"}, clear=True), \
             mock.patch.object(validation, "_json_request",
                 side_effect=validation.ProviderConnectionError("synthetic transport failure")) as request:
            report = validation.validate_gemini()
        request.assert_called_once()
        self.assertEqual(report["state"], "PROVIDER_UNAVAILABLE")
        self.assertEqual(report["usage_status"], "UNKNOWN")
        self.assertFalse(report["automatic_retry"])

    def test_socket_failures_are_sanitized_and_not_retried(self):
        for exception in [TimeoutError("do-not-echo-private-details"),
                          ConnectionResetError("do-not-echo-private-details")]:
            with self.subTest(exception=type(exception).__name__), mock.patch.dict(
                os.environ, {"GOOGLE_API_KEY": "synthetic-google-key"}, clear=True
            ), mock.patch.object(validation.request, "urlopen", side_effect=exception) as request:
                report = validation.validate_gemini()
                request.assert_called_once()
                self.assertEqual(report["state"], "PROVIDER_UNAVAILABLE")
                self.assertEqual(report["reason"], "TRANSPORT_FAILURE")
                self.assertNotIn("private-details", json.dumps(report))

    def test_untrusted_retry_metadata_is_not_exposed(self):
        for value in ["sensitive-header-content", "999999999", "-1", "30\nunsafe"]:
            with self.subTest(value=value):
                self.assertIsNone(validation._safe_retry_after(value))

    def test_release_context_fails_unavailable_and_quota_but_preserves_receipt(self):
        for state in ["READY", "QUOTA_EXHAUSTED", "PROVIDER_UNAVAILABLE", "BLOCKED"]:
            with self.subTest(state=state), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "report.json"
                with mock.patch.dict(os.environ, {
                    "LIVE_EXTERNAL_VALIDATION": "true", "PROVIDER_UNDER_TEST": "gemini",
                    "VALIDATION_REPORT": str(path),
                }, clear=True), mock.patch.object(validation.signal, "signal"), mock.patch.object(validation, "validate_gemini",
                    return_value={"state": state}), mock.patch("builtins.print"):
                    code = validation.main()
                self.assertEqual(code, 0 if state == "READY" else 1)
                self.assertEqual(json.loads(path.read_text())["gemini"]["state"], state)


class QdrantCleanupContractTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(
            os.environ,
            {
                "QDRANT_URL": "https://qdrant.example",
                "QDRANT_API_KEY": "synthetic-qdrant-key",
                "GITHUB_RUN_ID": "123456",
                "GITHUB_RUN_ATTEMPT": "1",
            },
            clear=True,
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_temporary_collection_is_deleted_after_success(self):
        query_response = {
            "result": {
                "points": [
                    {
                        "id": 1,
                        "payload": {
                            "workspace_id": "ci-workspace-a",
                            "version_id": "v1",
                            "index_generation": "g1",
                        },
                    }
                ]
            }
        }
        def response(method, _url, **_kwargs):
            if method == "GET":
                raise validation.ProviderHttpError(404)
            return 200, {"result": True} if method == "DELETE" else query_response

        with mock.patch.object(validation, "_json_request", side_effect=response) as request:
            result = validation.validate_qdrant()

        self.assertEqual(result["state"], "READY")
        self.assertTrue(result["temporary_collection_deleted"])
        self.assertEqual(request.call_count, 8)
        self.assertEqual(result["synthetic_points"], 4)
        delete_method, delete_url = request.call_args_list[-2].args
        self.assertEqual(delete_method, "DELETE")
        self.assertIn("/collections/nexusrag-ci-123456-1", delete_url)
        self.assertEqual(request.call_args_list[-2].kwargs["timeout"], 5)
        self.assertEqual(request.call_args_list[-1].args[0], "GET")
        self.assertEqual(request.call_args_list[-1].kwargs["timeout"], 2)
        points = request.call_args_list[4].kwargs["body"]["points"]
        self.assertEqual(len(points), 4)
        self.assertEqual(len(request.call_args_list[5].kwargs["body"]["filter"]["must"]), 3)

    def test_collection_cleanup_runs_after_probe_failure(self):
        def fail_after_create(method, url, **kwargs):
            if method == "PUT" and url.endswith("/index?wait=true"):
                raise validation.ProviderHttpError(503)
            if method == "DELETE":
                return 200, {"result": True}
            if method == "GET":
                raise validation.ProviderHttpError(404)
            return 200, {}

        with mock.patch.object(
            validation, "_json_request", side_effect=fail_after_create
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "QDRANT_VALIDATION_FAILED"):
                validation.validate_qdrant()

        self.assertEqual(request.call_count, 4)
        self.assertEqual(request.call_args_list[-2].args[0], "DELETE")
        self.assertIn("/collections/nexusrag-ci-123456-1", request.call_args_list[-2].args[1])

    def test_cleanup_attempted_if_create_response_is_lost(self):
        def lose_create_response(method, url, **kwargs):
            if method == "PUT" and "/collections/" in url:
                raise RuntimeError("simulated create response timeout")
            if method == "DELETE":
                raise validation.ProviderHttpError(404)
            return 200, {}

        with mock.patch.object(
            validation, "_json_request", side_effect=lose_create_response
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "QDRANT_VALIDATION_FAILED"):
                validation.validate_qdrant()

        self.assertEqual(request.call_count, 2)
        self.assertEqual(request.call_args_list[-1].args[0], "DELETE")


    def test_cleanup_failure_prevents_ready_result(self):
        def fail_cleanup(method, url, **kwargs):
            if method == "DELETE":
                raise validation.ProviderHttpError(503, "2")
            if method == "POST" and url.endswith("/points/query"):
                return 200, {
                    "result": {
                        "points": [
                            {"payload": {"workspace_id": "ci-workspace-a", "version_id": "v1", "index_generation": "g1"}}
                        ]
                    }
                }
            return 200, {}

        with mock.patch.object(validation, "_json_request", side_effect=fail_cleanup) as request:
            with self.assertRaises(validation.ProviderHttpError) as raised:
                validation.validate_qdrant()

        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(request.call_args_list[-1].args[0], "DELETE")

    def test_cleanup_requires_strict_acknowledgement_and_confirmed_absence(self):
        for acknowledgement, get_result, message in [
            (False, {}, "acknowledgement"),
            ("true", {}, "acknowledgement"),
            (True, {"result": {}}, "remains"),
        ]:
            with self.subTest(acknowledgement=acknowledgement, message=message):
                def response(method, _url, **_kwargs):
                    if method == "DELETE":
                        return 200, {"result": acknowledgement}
                    if method == "GET":
                        return 200, get_result
                    return 200, {"result": {"points": [{"payload": {
                        "workspace_id": "ci-workspace-a", "version_id": "v1",
                        "index_generation": "g1",
                    }}]}}
                with mock.patch.object(validation, "_json_request", side_effect=response):
                    with self.assertRaisesRegex(RuntimeError, message):
                        validation.validate_qdrant()

    def test_wrong_version_or_generation_cannot_be_a_ready_probe(self):
        for field in ["version_id", "index_generation"]:
            with self.subTest(field=field):
                def response(method, _url, **_kwargs):
                    if method == "DELETE":
                        return 200, {"result": True}
                    if method == "GET":
                        raise validation.ProviderHttpError(404)
                    payload = {"workspace_id": "ci-workspace-a", "version_id": "v1", "index_generation": "g1"}
                    payload[field] = "foreign"
                    return 200, {"result": {"points": [{"payload": payload}]}}
                with mock.patch.object(validation, "_json_request", side_effect=response):
                    with self.assertRaisesRegex(RuntimeError, "isolation probe failed"):
                        validation.validate_qdrant()

    def test_long_prefix_retains_unique_collection_suffix(self):
        with mock.patch.dict(os.environ, {"QDRANT_COLLECTION_PREFIX": "n" * 400}), \
             mock.patch.object(validation, "_json_request", side_effect=validation.ProviderHttpError(404)) as request:
            with self.assertRaisesRegex(RuntimeError, "QDRANT_VALIDATION_FAILED"):
                validation.validate_qdrant()
        url = request.call_args_list[0].args[1]
        self.assertTrue(url.endswith("-123456-1"))
        self.assertLessEqual(len(url.split("/")[-1]), 180)
        self.assertEqual(request.call_args_list[-1].args[0], "DELETE")

    def test_invalid_fixture_identity_blocks_before_any_provider_request(self):
        for overrides in [{"QDRANT_COLLECTION_PREFIX": "---"},
                          {"GITHUB_RUN_ID": "r" * 41},
                          {"GITHUB_RUN_ATTEMPT": "1" * 11}]:
            with self.subTest(overrides=overrides), mock.patch.dict(os.environ, overrides), \
                 mock.patch.object(validation, "_json_request") as request:
                with self.assertRaisesRegex(RuntimeError, "BLOCKED"):
                    validation.validate_qdrant()
                request.assert_not_called()

if __name__ == "__main__":
    unittest.main()