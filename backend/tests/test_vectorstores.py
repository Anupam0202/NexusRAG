"""Tests for workspace-scoped vector store adapters."""

from __future__ import annotations

from uuid import UUID

from src.vectorstores import QdrantVectorStore, VectorChunk


def test_qdrant_point_payload_contains_workspace_and_document_ids() -> None:
    chunk = VectorChunk(
        chunk_id="chunk-1",
        content="RAG content",
        embedding=[0.1, 0.2],
        filename="guide.pdf",
        page_number=2,
        chunk_index=0,
        content_hash="hash-1",
        metadata={"section": "Intro"},
    )

    point = QdrantVectorStore.point(
        workspace_id="workspace-1",
        document_id="document-1",
        chunk=chunk,
    )

    assert str(UUID(point["id"])) == point["id"]
    assert point["payload"]["workspace_id"] == "workspace-1"
    assert point["payload"]["document_id"] == "document-1"
    assert point["payload"]["chunk_id"] == "chunk-1"
    assert point["payload"]["metadata"] == {"section": "Intro"}


def test_qdrant_search_payload_always_filters_workspace() -> None:
    payload = QdrantVectorStore.search_payload(
        workspace_id="workspace-a",
        query_embedding=[0.1, 0.2],
        top_k=5,
        filters={"document_id": "doc-a", "file_type": "pdf"},
    )

    must = payload["filter"]["must"]
    assert {"key": "workspace_id", "match": {"value": "workspace-a"}} in must
    assert {"key": "document_id", "match": {"value": "doc-a"}} in must
    assert {"key": "file_type", "match": {"value": "pdf"}} in must
    assert payload["limit"] == 5


def test_qdrant_collection_payload_declares_vector_size() -> None:
    payload = QdrantVectorStore.collection_payload(vector_size=384)

    assert payload == {"vectors": {"size": 384, "distance": "Cosine"}}


def test_qdrant_payload_index_payload_declares_keyword_field() -> None:
    payload = QdrantVectorStore.payload_index_payload("workspace_id")

    assert payload == {"field_name": "workspace_id", "field_schema": "keyword"}


def test_qdrant_search_response_maps_payload_to_result() -> None:
    results = QdrantVectorStore._results_from_search_response(
        {
            "result": [
                {
                    "id": "point-1",
                    "score": 0.91,
                    "payload": {
                        "chunk_id": "chunk-1",
                        "document_id": "doc-1",
                        "content": "hello",
                        "workspace_id": "workspace-a",
                    },
                }
            ]
        }
    )

    assert len(results) == 1
    assert results[0].chunk_id == "chunk-1"
    assert results[0].document_id == "doc-1"
    assert results[0].content == "hello"
    assert results[0].score == 0.91


def test_qdrant_delete_payload_cannot_delete_without_workspace_filter() -> None:
    payload = QdrantVectorStore.delete_payload(
        workspace_id="workspace-a",
        document_id="doc-a",
    )

    must = payload["filter"]["must"]
    assert {"key": "workspace_id", "match": {"value": "workspace-a"}} in must
    assert {"key": "document_id", "match": {"value": "doc-a"}} in must
