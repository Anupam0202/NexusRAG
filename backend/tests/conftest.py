"""
Shared pytest fixtures for the entire test suite.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from langchain_core.documents import Document


@pytest.fixture(autouse=True)
def _set_test_env(monkeypatch):
    """Ensure tests never hit real APIs unless explicitly enabled."""
    from config.settings import get_settings
    from src.infrastructure.supabase_client import get_supabase_client
    from src.telemetry.events import get_telemetry_recorder

    get_settings.cache_clear()
    get_supabase_client.cache_clear()
    get_telemetry_recorder.cache_clear()
    monkeypatch.setenv("GOOGLE_API_KEY", os.getenv("GOOGLE_API_KEY", "test-key-placeholder"))
    monkeypatch.setenv("LOG_FORMAT", "console")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    monkeypatch.setenv("ENABLE_CACHE", "false")
    monkeypatch.setenv("ENABLE_ANONYMOUS_DEMO", "true")
    monkeypatch.setenv("ENABLE_CONTEXTUAL_ENRICHMENT", "false")
    monkeypatch.setenv("ENABLE_RERANKING", "false")
    monkeypatch.setenv("VECTOR_STORE_PATH", "data/test_vector_store")
    yield
    get_settings.cache_clear()
    get_supabase_client.cache_clear()
    get_telemetry_recorder.cache_clear()


@pytest.fixture
def sample_documents() -> list[Document]:
    """A small set of LangChain Documents for unit tests."""
    return [
        Document(
            page_content="The company reported revenue of $10M in Q1 2024.",
            metadata={
                "filename": "report.pdf",
                "file_type": "pdf",
                "document_type": "page",
                "page_number": 1,
            },
        ),
        Document(
            page_content="Employee John Smith works in the Engineering department in Mumbai.",
            metadata={
                "filename": "employees.xlsx",
                "file_type": "excel",
                "document_type": "rows",
                "sheet_name": "Sheet1",
            },
        ),
        Document(
            page_content="The product roadmap includes AI features for Q3 2024.",
            metadata={
                "filename": "roadmap.pdf",
                "file_type": "pdf",
                "document_type": "page",
                "page_number": 3,
            },
        ),
    ]


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    """Minimal valid PDF bytes."""
    return (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n0\n%%EOF"
    )


@pytest.fixture
def test_client() -> TestClient:
    """FastAPI test client with mocked RAG chain (no real LLM calls)."""
    from main import app
    from src.api.dependencies import get_rag_chain

    # Create a mock RAG chain that satisfies the dependency
    mock_chain = MagicMock()
    mock_chain.cache_stats = {"entries": 0, "hits": 0, "misses": 0, "hit_rate": 0.0}
    mock_chain.query_metrics = {
        "avg_response_time": 0.0,
        "avg_confidence": 0.0,
        "total_queries": 0,
        "queries_today": 0,
    }

    app.dependency_overrides[get_rag_chain] = lambda: mock_chain

    client = TestClient(app)
    client.mock_chain = mock_chain  # type: ignore[attr-defined]
    yield client

    app.dependency_overrides.clear()
