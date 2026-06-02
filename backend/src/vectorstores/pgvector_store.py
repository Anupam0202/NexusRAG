"""Supabase pgvector adapter with mandatory workspace filtering."""

from __future__ import annotations

from typing import Any
from uuid import NAMESPACE_URL, uuid5

from src.infrastructure.supabase_client import SupabaseClient, get_supabase_client
from src.repositories.base import and_query, eq_filter
from src.vectorstores.base import VectorChunk, VectorSearchResult


def _vector_literal(values: list[float]) -> str:
    """Format an embedding for PostgREST pgvector input."""
    return "[" + ",".join(f"{float(value):.9g}" for value in values) + "]"


def _chunk_uuid(workspace_id: str, document_id: str, chunk: VectorChunk) -> str:
    """Return a stable UUID for Supabase chunk rows."""
    return str(uuid5(NAMESPACE_URL, f"{workspace_id}:{document_id}:{chunk.chunk_id}"))


class PgVectorStore:
    """VectorStore implementation backed by Supabase Postgres + pgvector.

    Qdrant remains the production primary store for the free Render deployment.
    This adapter gives Supabase-only demos a real fallback once
    ``005_pgvector_fallback.sql`` has been applied.
    """

    RPC_NAME = "match_document_chunks"

    def __init__(self, supabase: SupabaseClient | None = None) -> None:
        self._supabase = supabase or get_supabase_client()

    async def upsert_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[VectorChunk],
    ) -> int:
        if not chunks:
            return 0

        payload = [
            {
                "id": _chunk_uuid(workspace_id, document_id, chunk),
                "workspace_id": workspace_id,
                "document_id": document_id,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "content_hash": chunk.content_hash,
                "page_number": chunk.page_number,
                "section_title": chunk.metadata.get("section_title"),
                "token_count": chunk.metadata.get("token_count") or 0,
                "qdrant_point_id": chunk.chunk_id,
                "embedding": _vector_literal(chunk.embedding),
                "metadata": {
                    **(chunk.metadata or {}),
                    "filename": chunk.filename,
                    "chunk_id": chunk.chunk_id,
                },
            }
            for chunk in chunks
        ]
        rows = await self._supabase.table_upsert(
            "document_chunks",
            payload,
            on_conflict="id",
        )
        return len(rows) if rows else len(payload)

    async def search(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        payload = {
            "query_embedding": _vector_literal(query_embedding),
            "match_workspace_id": workspace_id,
            "match_count": top_k,
            "match_filters": filters or {},
        }
        rows = await self._supabase.rpc(self.RPC_NAME, payload)
        if not isinstance(rows, list):
            return []

        results: list[VectorSearchResult] = []
        for row in rows:
            result_workspace = str(row.get("workspace_id") or "")
            if result_workspace != workspace_id:
                continue
            metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
            payload_row = {
                **metadata,
                "workspace_id": result_workspace,
                "document_id": str(row.get("document_id") or ""),
                "chunk_id": str(row.get("chunk_id") or row.get("id") or ""),
                "filename": metadata.get("filename") or row.get("filename") or "",
                "page_number": row.get("page_number"),
                "chunk_index": row.get("chunk_index"),
                "content_hash": row.get("content_hash"),
            }
            results.append(
                VectorSearchResult(
                    chunk_id=str(payload_row["chunk_id"]),
                    document_id=str(payload_row["document_id"]),
                    content=str(row.get("content") or ""),
                    score=float(row.get("score") or 0.0),
                    payload=payload_row,
                )
            )
        return results

    async def delete_document(self, *, workspace_id: str, document_id: str) -> int:
        rows = await self._supabase.table_delete(
            "document_chunks",
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                eq_filter("document_id", document_id),
            ),
        )
        return len(rows)

    async def count_chunks(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_select(
            "document_chunks",
            query=and_query("select=id", eq_filter("workspace_id", workspace_id)),
        )
        return len(rows)
