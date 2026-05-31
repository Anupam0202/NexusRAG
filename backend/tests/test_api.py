"""
Integration tests for FastAPI endpoints.

These tests use the TestClient and mock heavy components where needed.
"""

from __future__ import annotations

import os

from fastapi.testclient import TestClient

from config.settings import get_settings
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
        api_key = "AIzaSyDtestworkspacekeymaterial123456789"
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
        api_key = "AIzaSyDsecondworkspacekeymaterial123456"
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


class TestAnalytics:
    def test_analytics_summary(self, test_client: TestClient):
        resp = test_client.get("/api/v1/analytics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_documents" in data
        assert "total_chunks" in data


class TestSystemStatus:
    def test_system_status(self, test_client: TestClient):
        resp = test_client.get("/api/v1/status")
        assert resp.status_code == 200
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
