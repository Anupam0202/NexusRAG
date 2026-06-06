"""
Integration tests for FastAPI endpoints.

These tests use the TestClient and mock heavy components where needed.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

from fastapi.testclient import TestClient
from pydantic import ValidationError

from config.settings import get_settings
from src.api.models import QueryRequest
from src.api.websocket import _stream_retrieval_filters
from src.generation.provider_keys import get_provider_key_manager


def _pdf_bytes(pages: int, *, with_text: bool) -> bytes:
    import fitz

    doc = fitz.open()
    try:
        for index in range(pages):
            page = doc.new_page()
            if with_text:
                page.insert_text((72, 72), f"Test PDF page {index + 1}")
        return doc.tobytes()
    finally:
        doc.close()


class TestHealthEndpoint:
    def test_health(self, test_client: TestClient):
        resp = test_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"


def test_stream_chat_filters_match_rest_date_and_metadata_surface() -> None:
    filters = _stream_retrieval_filters(
        QueryRequest(
            question="Find the finance policy",
            uploaded_after=datetime(2026, 1, 1, tzinfo=UTC),
            uploaded_before=datetime(2026, 6, 1, tzinfo=UTC),
            metadata_filters={"department": "finance"},
        )
    )

    assert filters["uploaded_after_epoch"] < filters["uploaded_before_epoch"]
    assert filters["metadata"] == {"department": "finance"}


def test_chat_request_bounds_history_and_metadata_filter_counts() -> None:
    oversized_history = [{"role": "user", "content": "hello"} for _ in range(51)]
    oversized_metadata = {f"key_{index}": "value" for index in range(21)}

    for payload in (
        {"question": "hello", "conversation_history": oversized_history},
        {"question": "hello", "metadata_filters": oversized_metadata},
    ):
        try:
            QueryRequest.model_validate(payload)
        except ValidationError:
            continue
        raise AssertionError("QueryRequest accepted an oversized collection")


class TestDocumentEndpoints:
    def test_upload_txt(self, test_client: TestClient):
        content = b"This is a test document for upload testing."
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("test_upload.txt", content, "text/plain")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["document"]["filename"] == "test_upload.txt"
        assert data["job_id"]
        assert data["job"]["status"] == "completed"

    def test_upload_job_status_endpoint(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("job_status.txt", b"Track me.", "text/plain")},
        )
        assert resp.status_code == 200
        upload = resp.json()

        job_resp = test_client.get(f"/api/v1/documents/jobs/{upload['job_id']}")
        assert job_resp.status_code == 200
        job = job_resp.json()
        assert job["status"] == "completed"
        assert job["document"]["filename"] == "job_status.txt"

        doc_resp = test_client.get(f"/api/v1/documents/{upload['document']['document_id']}/status")
        assert doc_resp.status_code == 200
        assert doc_resp.json()["job_id"] == upload["job_id"]

    def test_document_chunk_preview_endpoint(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={
                "file": (
                    "chunk_preview.txt",
                    b"First marker paragraph.\n\nSecond searchable marker paragraph.",
                    "text/plain",
                )
            },
        )
        assert resp.status_code == 200
        upload = resp.json()

        chunks_resp = test_client.get(
            f"/api/v1/documents/{upload['document']['document_id']}/chunks?search=searchable"
        )
        data = chunks_resp.json()

        assert chunks_resp.status_code == 200
        assert data["filename"] == "chunk_preview.txt"
        assert data["total"] >= 1
        assert "searchable marker" in data["chunks"][0]["content"]
        assert data["chunks"][0]["metadata"].get("workspace_id") is None

    def test_upload_clears_chat_cache(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("cache_clear.txt", b"Fresh corpus content.", "text/plain")},
        )

        assert resp.status_code == 200
        test_client.mock_chain.clear_cache.assert_called_with(  # type: ignore[attr-defined]
            workspace_id="00000000-0000-0000-0000-000000000000"
        )

    def test_upload_rejects_unsupported(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("bad.xyz", b"content", "application/octet-stream")},
        )
        assert resp.status_code == 400

    def test_upload_rejects_pdf_over_page_limit(self, test_client: TestClient, monkeypatch):
        monkeypatch.setenv("MAX_PDF_PAGES", "1")
        get_settings.cache_clear()
        try:
            resp = test_client.post(
                "/api/v1/documents/upload",
                files={
                    "file": (
                        "too_many_pages.pdf",
                        _pdf_bytes(2, with_text=True),
                        "application/pdf",
                    )
                },
            )
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 413
        assert "accepts up to 1 pages" in resp.json()["detail"]

    def test_upload_rejects_scanned_pdf_over_ocr_limit(
        self, test_client: TestClient, monkeypatch
    ):
        monkeypatch.setenv("MAX_PDF_PAGES", "10")
        monkeypatch.setenv("MAX_PDF_OCR_PAGES", "1")
        get_settings.cache_clear()
        try:
            resp = test_client.post(
                "/api/v1/documents/upload",
                files={
                    "file": (
                        "scanned.pdf",
                        _pdf_bytes(2, with_text=False),
                        "application/pdf",
                    )
                },
            )
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 413
        assert "scanned PDF" in resp.json()["detail"]

    def test_list_documents(self, test_client: TestClient):
        # Upload first
        test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("list_test.txt", b"Some content here.", "text/plain")},
        )
        resp = test_client.get("/api/v1/documents")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    def test_delete_document(self, test_client: TestClient):
        # Upload
        test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("to_delete.txt", b"Delete me.", "text/plain")},
        )
        test_client.mock_chain.clear_cache.reset_mock()  # type: ignore[attr-defined]
        resp = test_client.delete("/api/v1/documents/to_delete.txt")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
        test_client.mock_chain.clear_cache.assert_called_once_with(  # type: ignore[attr-defined]
            workspace_id="00000000-0000-0000-0000-000000000000"
        )

    def test_reindex_endpoint_reports_missing_durable_original_in_demo_mode(
        self,
        test_client: TestClient,
    ):
        upload = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("reindex_demo.txt", b"Reindex me.", "text/plain")},
        ).json()

        resp = test_client.post(
            f"/api/v1/documents/{upload['document']['document_id']}/reindex"
        )

        assert resp.status_code == 409
        assert "stored original" in resp.json()["detail"].lower()


class TestSettingsEndpoints:
    def test_get_settings(self, test_client: TestClient):
        resp = test_client.get("/api/v1/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert "llm_model_name" in data
        assert "retrieval_top_k" in data

    def test_patch_settings(self, test_client: TestClient):
        resp = test_client.patch(
            "/api/v1/settings",
            json={"llm_temperature": 0.5, "retrieval_top_k": 15},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["llm_temperature"] == 0.5
        assert data["retrieval_top_k"] == 15

    def test_constrained_settings_reject_heavy_features(
        self, test_client: TestClient, monkeypatch
    ):
        monkeypatch.setenv("CONSTRAINED_MEMORY", "true")
        get_settings.cache_clear()
        try:
            resp = test_client.patch(
                "/api/v1/settings",
                json={"enable_reranking": True},
            )
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 400
        assert "constrained Render" in resp.json()["detail"]


class TestApiKeyEndpoint:
    def test_api_key_storage_does_not_mutate_global_google_key(
        self,
        test_client: TestClient,
        monkeypatch,
    ):
        api_key = "test-workspace-key-material-123456789"
        original_env_key = os.environ.get("GOOGLE_API_KEY")
        original_settings_key = get_settings().google_api_key
        get_provider_key_manager.cache_clear()
        monkeypatch.setattr("src.api.routes._validate_provider_api_key", lambda *_args: None)

        try:
            resp = test_client.post("/api/v1/apikey", json={"api_key": api_key})
            data = resp.json()

            assert resp.status_code == 200
            assert data["success"] is True
            assert data["workspace_key_configured"] is True
            assert data["key_fingerprint"].startswith("sha256:")
            assert api_key not in str(data)
            assert os.environ.get("GOOGLE_API_KEY") == original_env_key
            assert get_settings().google_api_key == original_settings_key
        finally:
            get_provider_key_manager.cache_clear()

    def test_api_key_status_reports_workspace_key_without_plaintext(
        self,
        test_client: TestClient,
        monkeypatch,
    ):
        api_key = "test-second-workspace-key-material-123456"
        get_provider_key_manager.cache_clear()
        monkeypatch.setattr("src.api.routes._validate_provider_api_key", lambda *_args: None)

        try:
            test_client.post("/api/v1/apikey", json={"api_key": api_key})
            resp = test_client.get("/api/v1/apikey")
            data = resp.json()

            assert resp.status_code == 200
            assert data["workspace_key_configured"] is True
            assert data["key_fingerprint"].startswith("sha256:")
            assert api_key not in str(data)
        finally:
            get_provider_key_manager.cache_clear()

    def test_api_key_delete_deactivates_workspace_key_without_plaintext(
        self,
        test_client: TestClient,
        monkeypatch,
    ):
        api_key = "test-delete-workspace-key-material-123456"
        get_provider_key_manager.cache_clear()
        monkeypatch.setattr("src.api.routes._validate_provider_api_key", lambda *_args: None)

        try:
            test_client.post("/api/v1/apikey", json={"api_key": api_key})
            delete_resp = test_client.delete("/api/v1/apikey")
            delete_data = delete_resp.json()
            status_resp = test_client.get("/api/v1/apikey")
            status_data = status_resp.json()

            assert delete_resp.status_code == 200
            assert delete_data["success"] is True
            assert delete_data["workspace_key_configured"] is False
            assert delete_data["key_fingerprint"] is None
            assert status_resp.status_code == 200
            assert status_data["workspace_key_configured"] is False
            assert api_key not in str(delete_data)
            assert api_key not in str(status_data)
        finally:
            get_provider_key_manager.cache_clear()


class TestAnalytics:
    def test_analytics_summary(self, test_client: TestClient):
        resp = test_client.get("/api/v1/analytics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_documents" in data
        assert "total_chunks" in data
        assert "llm_usage_events" in data
        assert "audit_events" in data
        assert "last_activity_at" in data

    def test_chat_records_workspace_usage_and_audit(self, test_client: TestClient):
        test_client.mock_chain.query.return_value = {  # type: ignore[attr-defined]
            "answer": "Telemetry is being recorded.",
            "sources": [],
            "query_type": "general",
            "confidence": 0.8,
            "response_time_seconds": 0.123,
            "metadata": {
                "model": "gemini-2.5-flash",
                "generation_fallback": False,
            },
        }

        chat_resp = test_client.post(
            "/api/v1/chat",
            json={"question": "Is telemetry working?", "session_id": "session-1"},
        )
        assert chat_resp.status_code == 200
        assert chat_resp.json()["metadata"]["from_cache"] is False

        summary_resp = test_client.get("/api/v1/analytics/summary")
        summary = summary_resp.json()
        assert summary_resp.status_code == 200
        assert summary["llm_usage_events"] == 1
        assert summary["audit_events"] == 1
        assert summary["llm_total_tokens"] > 0
        assert summary["queries_today"] >= 1

    def test_chat_passes_selected_document_filters(self, test_client: TestClient):
        test_client.mock_chain.query.return_value = {  # type: ignore[attr-defined]
            "answer": "Selected document answer.",
            "sources": [],
            "query_type": "specific",
            "confidence": 0.75,
            "response_time_seconds": 0.05,
            "metadata": {"model": "gemini-2.5-flash"},
        }

        resp = test_client.post(
            "/api/v1/chat",
            json={
                "question": "What does this selected file say?",
                "chat_scope": "documents",
                "document_ids": ["doc-alpha"],
                "file_types": ["pdf"],
                "min_page": 2,
                "max_page": 5,
            },
        )

        assert resp.status_code == 200
        kwargs = test_client.mock_chain.query.call_args.kwargs  # type: ignore[attr-defined]
        assert kwargs["retrieval_filters"] == {
            "document_ids": ["doc-alpha"],
            "file_types": ["pdf"],
            "min_page": 2,
            "max_page": 5,
        }

    def test_chat_passes_uploaded_date_and_metadata_filters(self, test_client: TestClient):
        test_client.mock_chain.query.return_value = {  # type: ignore[attr-defined]
            "answer": "Filtered answer.",
            "sources": [],
            "query_type": "specific",
            "confidence": 0.75,
            "response_time_seconds": 0.05,
            "metadata": {"model": "gemini-2.5-flash"},
        }

        resp = test_client.post(
            "/api/v1/chat",
            json={
                "question": "Find the finance policy",
                "uploaded_after": "2026-01-01T00:00:00Z",
                "uploaded_before": "2026-06-01T00:00:00Z",
                "metadata_filters": {"department": "finance"},
            },
        )

        assert resp.status_code == 200
        filters = test_client.mock_chain.query.call_args.kwargs["retrieval_filters"]  # type: ignore[attr-defined]
        assert filters["uploaded_after_epoch"] < filters["uploaded_before_epoch"]
        assert filters["metadata"] == {"department": "finance"}

    def test_chat_rejects_when_daily_query_quota_exhausted(
        self, test_client: TestClient, monkeypatch
    ):
        monkeypatch.setenv("ENFORCE_TENANT_QUOTAS", "true")
        monkeypatch.setenv("QUOTA_DAILY_QUERIES", "0")
        get_settings.cache_clear()
        try:
            resp = test_client.post("/api/v1/chat", json={"question": "quota check"})
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 429
        assert "query quota" in resp.json()["detail"].lower()
        test_client.mock_chain.query.assert_not_called()  # type: ignore[attr-defined]

    def test_audit_endpoint_lists_recent_sanitized_events(self, test_client: TestClient):
        test_client.mock_chain.query.return_value = {  # type: ignore[attr-defined]
            "answer": "Audit trail is visible.",
            "sources": [],
            "query_type": "general",
            "confidence": 0.7,
            "response_time_seconds": 0.1,
            "metadata": {"model": "gemini-2.5-flash"},
        }

        chat_resp = test_client.post(
            "/api/v1/chat",
            json={"question": "Show audit events", "session_id": "session-1"},
        )
        assert chat_resp.status_code == 200

        resp = test_client.get("/api/v1/audit?limit=10")
        data = resp.json()

        assert resp.status_code == 200
        assert data["storage"] == "memory"
        assert data["total"] >= 1
        assert data["events"][0]["action"] == "chat.query"
        assert data["events"][0]["workspace_id"]
        assert "question_chars" in data["events"][0]["metadata"]

    def test_audit_endpoint_redacts_sensitive_metadata(self, test_client: TestClient):
        import asyncio

        from src.telemetry.events import get_telemetry_recorder

        recorder = get_telemetry_recorder()
        asyncio.run(
            recorder.record_audit_event(
                workspace_id=None,
                action="api_key.added",
                resource_type="api_key",
                metadata={
                    "api_key": "test-never-return-this-value",
                    "nested": {"authorization": "Bearer secret"},
                },
            )
        )

        resp = test_client.get("/api/v1/audit?limit=1")
        data = resp.json()

        assert resp.status_code == 200
        metadata = data["events"][0]["metadata"]
        assert metadata["api_key"] == "[redacted]"
        assert metadata["nested"]["authorization"] == "[redacted]"
        assert "test-never-return-this-value" not in str(data)


class TestBillingAndPrivacy:
    def test_billing_usage_has_durable_reconciliation_shape_in_demo_mode(
        self, test_client: TestClient
    ):
        resp = test_client.get("/api/v1/billing/usage")

        assert resp.status_code == 200
        assert resp.json()["storage"] == "memory"
        assert resp.json()["daily"] == []

    def test_demo_mode_cannot_delete_a_durable_workspace(self, test_client: TestClient):
        resp = test_client.request(
            "DELETE",
            "/api/v1/workspaces/current",
            json={"confirmation": "DELETE WORKSPACE"},
        )

        assert resp.status_code == 403
        assert "demo mode" in resp.json()["detail"].lower()


class TestEvaluations:
    def test_sample_evaluation_endpoint_runs_quality_gates(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/evaluations/sample",
            json={"mode": "retrieval", "fail_under_recall": 0.8},
        )
        data = resp.json()

        assert resp.status_code == 200
        assert data["dataset"] == "sample_corpus.json"
        assert data["mode"] == "retrieval"
        assert data["summary"]["total"] == 3
        assert data["summary"]["cross_workspace_leaks"] == 0
        assert data["gates"]["passed"] is True
        assert data["gates"]["checks"]["retrieval_recall"]["passed"] is True
        assert len(data["results"]) == 3

    def test_sample_evaluation_rejects_llm_mode(self, test_client: TestClient):
        resp = test_client.post("/api/v1/evaluations/sample", json={"mode": "rag"})

        assert resp.status_code == 422


class TestChatHistory:
    def test_list_session_messages_uses_in_memory_history_in_demo_mode(
        self,
        test_client: TestClient,
    ):
        test_client.mock_chain.get_session_history.return_value = [  # type: ignore[attr-defined]
            {"role": "user", "content": "hello", "metadata": {"source": "test"}},
            {"role": "assistant", "content": "hi", "metadata": {"confidence": 0.9}},
        ]

        resp = test_client.get(
            "/api/v1/chat/sessions/11111111-1111-1111-1111-111111111111/messages"
        )
        data = resp.json()

        assert resp.status_code == 200
        assert data["total"] == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][1]["metadata"]["confidence"] == 0.9


class TestSystemStatus:
    def test_system_status(self, test_client: TestClient):
        resp = test_client.get("/api/v1/status")
        assert resp.status_code == 200
        assert resp.headers["X-Request-ID"]
        assert resp.headers["Server-Timing"].startswith("app;dur=")
        assert resp.headers["X-RateLimit-Limit"]
        data = resp.json()
        assert data["service"] == "NexusRAG API"
        assert "capabilities" in data
        assert "settings" in data
        assert "memory_constrained" in data["settings"]
        assert "use_lightweight_embeddings" in data["settings"]
        assert "enable_query_expansion" in data["settings"]
        assert data["settings"]["max_pdf_pages"] >= 1
        assert data["settings"]["max_pdf_ocr_pages"] >= 0
        assert "enable_docx_embedded_image_ocr" in data["settings"]
        assert data["settings"]["max_docx_embedded_images"] >= 0
        assert "supabase_configured" in data["settings"]
        assert "supabase_auth_configured" in data["settings"]
        assert "auth_required" in data["settings"]
        assert data["settings"]["auth_required"] is False
        assert "qdrant_configured" in data["settings"]
        assert "qdrant_collection" in data["settings"]
        assert "vector_backend" in data["settings"]
        assert "enable_pgvector_fallback" in data["settings"]
        assert "enable_local_faiss" in data["settings"]
        assert "enable_async_ingestion" in data["settings"]

    def test_system_status_reports_effective_query_expansion(
        self, test_client: TestClient, monkeypatch
    ):
        monkeypatch.setenv("CONSTRAINED_MEMORY", "true")
        monkeypatch.setenv("ENABLE_QUERY_EXPANSION", "true")
        get_settings.cache_clear()
        try:
            resp = test_client.get("/api/v1/status")
        finally:
            get_settings.cache_clear()

        assert resp.status_code == 200
        assert resp.json()["settings"]["enable_query_expansion"] is False
