"""Tests for workspace-scoped vector store adapters."""

from __future__ import annotations

from typing import Any
from uuid import UUID

import pytest

from src.vectorstores import PgVectorStore, QdrantVectorStore, VectorChunk


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


class FakeSupabase:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    async def table_upsert(self, table: str, payload: Any, **kwargs: Any) -> list[dict]:
        self.calls.append(("upsert", {"table": table, "payload": payload, **kwargs}))
        return payload if isinstance(payload, list) else [payload]

    async def table_delete(self, table: str, *, query: str, **kwargs: Any) -> list[dict]:
        self.calls.append(("delete", {"table": table, "query": query, **kwargs}))
        return [{"id": "deleted"}]

    async def table_select(self, table: str, *, query: str, **kwargs: Any) -> list[dict]:
        self.calls.append(("select", {"table": table, "query": query, **kwargs}))
        return [{"id": "chunk-1"}]

    async def rpc(self, function_name: str, payload: dict[str, Any], **kwargs: Any) -> list[dict]:
        self.calls.append(("rpc", {"function": function_name, "payload": payload, **kwargs}))
        return [
            {
                "id": "11111111-1111-1111-1111-111111111111",
                "workspace_id": "workspace-a",
                "document_id": "doc-a",
                "chunk_id": "chunk-a",
                "content": "Alpha only",
                "score": 0.9,
                "metadata": {"filename": "alpha.txt"},
            },
            {
                "id": "22222222-2222-2222-2222-222222222222",
                "workspace_id": "workspace-b",
                "document_id": "doc-b",
                "chunk_id": "chunk-b",
                "content": "Beta leak",
                "score": 0.99,
                "metadata": {"filename": "beta.txt"},
            },
        ]


@pytest.mark.asyncio
async def test_pgvector_upsert_persists_embedding_and_workspace_scope() -> None:
    fake = FakeSupabase()
    store = PgVectorStore(fake)  # type: ignore[arg-type]
    count = await store.upsert_chunks(
        workspace_id="workspace-a",
        document_id="doc-a",
        chunks=[
            VectorChunk(
                chunk_id="chunk-a",
                content="Alpha content",
                embedding=[0.1, 0.2, 0.3],
                filename="alpha.txt",
                chunk_index=0,
                page_number=1,
                content_hash="hash-a",
                metadata={"token_count": 7},
            )
        ],
    )

    assert count == 1
    call = fake.calls[0][1]
    row = call["payload"][0]
    assert call["table"] == "document_chunks"
    assert call["on_conflict"] == "id"
    assert row["workspace_id"] == "workspace-a"
    assert row["document_id"] == "doc-a"
    assert row["embedding"] == "[0.1,0.2,0.3]"
    assert row["metadata"]["filename"] == "alpha.txt"


@pytest.mark.asyncio
async def test_pgvector_search_calls_workspace_rpc_and_drops_leaked_rows() -> None:
    fake = FakeSupabase()
    store = PgVectorStore(fake)  # type: ignore[arg-type]
    results = await store.search(
        workspace_id="workspace-a",
        query_embedding=[0.1, 0.2],
        top_k=5,
        filters={"document_id": "doc-a"},
    )

    assert len(results) == 1
    assert results[0].chunk_id == "chunk-a"
    call = fake.calls[0][1]
    assert call["function"] == "match_document_chunks"
    assert call["payload"]["match_workspace_id"] == "workspace-a"
    assert call["payload"]["match_filters"] == {"document_id": "doc-a"}
