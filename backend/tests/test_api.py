"""
Integration tests for FastAPI endpoints.

These tests use the TestClient and mock heavy components where needed.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient


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

    def test_upload_rejects_unsupported(self, test_client: TestClient):
        resp = test_client.post(
            "/api/v1/documents/upload",
            files={"file": ("bad.xyz", b"content", "application/octet-stream")},
        )
        assert resp.status_code == 400

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
        resp = test_client.delete("/api/v1/documents/to_delete.txt")
        assert resp.status_code == 200
        assert resp.json()["success"] is True


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


class TestAnalytics:
    def test_analytics_summary(self, test_client: TestClient):
        resp = test_client.get("/api/v1/analytics/summary")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_documents" in data
        assert "total_chunks" in data