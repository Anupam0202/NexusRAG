import os
import unittest
from unittest import mock

from scripts import live_provider_validation as validation


class GeminiValidationContractTests(unittest.TestCase):
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
                        },
                    }
                ]
            }
        }
        with mock.patch.object(
            validation, "_json_request", return_value=(200, query_response)
        ) as request:
            result = validation.validate_qdrant()

        self.assertEqual(result["state"], "READY")
        self.assertTrue(result["temporary_collection_deleted"])
        self.assertEqual(request.call_count, 7)
        delete_method, delete_url = request.call_args_list[-1].args
        self.assertEqual(delete_method, "DELETE")
        self.assertIn("/collections/nexusrag-ci-123456-1", delete_url)
        self.assertEqual(request.call_args_list[-1].kwargs["timeout"], 5)

    def test_collection_cleanup_runs_after_probe_failure(self):
        def fail_after_create(method, url, **kwargs):
            if method == "PUT" and url.endswith("/index?wait=true"):
                raise validation.ProviderHttpError(503)
            return 200, {}

        with mock.patch.object(
            validation, "_json_request", side_effect=fail_after_create
        ) as request:
            with self.assertRaisesRegex(RuntimeError, "QDRANT_VALIDATION_FAILED"):
                validation.validate_qdrant()

        self.assertEqual(request.call_count, 3)
        self.assertEqual(request.call_args_list[-1].args[0], "DELETE")
        self.assertIn("/collections/nexusrag-ci-123456-1", request.call_args_list[-1].args[1])

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
                            {"payload": {"workspace_id": "ci-workspace-a", "version_id": "v1"}}
                        ]
                    }
                }
            return 200, {}

        with mock.patch.object(validation, "_json_request", side_effect=fail_cleanup) as request:
            with self.assertRaises(validation.ProviderHttpError) as raised:
                validation.validate_qdrant()

        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(request.call_args_list[-1].args[0], "DELETE")


if __name__ == "__main__":
    unittest.main()