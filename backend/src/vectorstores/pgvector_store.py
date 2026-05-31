"""Supabase pgvector adapter placeholder.

The schema currently stores chunk metadata in ``document_chunks``. A production
pgvector fallback also needs a vector column and a match RPC migration; this
adapter keeps that boundary explicit until the migration lands.
"""

from __future__ import annotations

from typing import Any

from src.infrastructure.supabase_client import SupabaseClient, get_supabase_client
from src.repositories.base import and_query, eq_filter
from src.vectorstores.base import VectorChunk, VectorSearchResult


class PgVectorStore:
    def __init__(self, supabase: SupabaseClient | None = None) -> None:
        self._supabase = supabase or get_supabase_client()

    async def upsert_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[VectorChunk],
    ) -> int:
        raise NotImplementedError(
            "PgVectorStore requires a pgvector migration with embedding columns first."
        )

    async def search(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        raise NotImplementedError(
            "PgVectorStore search requires a workspace-scoped match RPC first."
        )

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
