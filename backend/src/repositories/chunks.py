"""Document chunk metadata persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter


class ChunkRepository(SupabaseRepository):
    async def list_for_document(
        self,
        *,
        workspace_id: str,
        document_id: str,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "document_chunks",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("document_id", document_id),
                "order=chunk_index.asc",
            ),
        )

    async def replace_document_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        await self.delete_document_chunks(workspace_id=workspace_id, document_id=document_id)
        if not chunks:
            return []

        payload = [
            {
                **chunk,
                "workspace_id": workspace_id,
                "document_id": document_id,
                "metadata": chunk.get("metadata") or {},
            }
            for chunk in chunks
        ]
        return await self._supabase.table_upsert(
            "document_chunks",
            payload,
            on_conflict="document_id,chunk_index",
        )

    async def delete_document_chunks(self, *, workspace_id: str, document_id: str) -> int:
        rows = await self._supabase.table_delete(
            "document_chunks",
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                eq_filter("document_id", document_id),
            ),
        )
        return len(rows)

    async def count_for_workspace(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_select(
            "document_chunks",
            query=and_query("select=id", eq_filter("workspace_id", workspace_id)),
        )
        return len(rows)
