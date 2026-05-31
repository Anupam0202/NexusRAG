"""Vector store interface used by the enterprise ingestion/RAG pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True)
class VectorChunk:
    chunk_id: str
    content: str
    embedding: list[float]
    filename: str
    chunk_index: int
    page_number: int | None = None
    content_hash: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class VectorSearchResult:
    chunk_id: str
    document_id: str
    content: str
    score: float
    payload: dict[str, Any]


class VectorStore(Protocol):
    async def upsert_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[VectorChunk],
    ) -> int:
        """Insert or replace chunk vectors for a workspace document."""

    async def search(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        """Search vectors with a hard workspace filter."""

    async def delete_document(self, *, workspace_id: str, document_id: str) -> int:
        """Delete vectors for one document within one workspace."""

    async def count_chunks(self, *, workspace_id: str) -> int:
        """Count chunks visible to a workspace."""
