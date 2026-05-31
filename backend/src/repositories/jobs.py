"""Ingestion job persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter, first_row


class IngestionJobRepository(SupabaseRepository):
    async def create_job(
        self,
        *,
        workspace_id: str,
        document_id: str,
        stage: str = "queued",
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "ingestion_jobs",
            {
                "workspace_id": workspace_id,
                "document_id": document_id,
                "status": "queued",
                "progress": 0,
                "stage": stage,
            },
        )
        return rows[0]

    async def get_job(self, *, workspace_id: str, job_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "ingestion_jobs",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("id", job_id),
                "limit=1",
            ),
        )
        return first_row(rows)

    async def list_for_document(
        self,
        *,
        workspace_id: str,
        document_id: str,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "ingestion_jobs",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("document_id", document_id),
                "order=created_at.desc",
            ),
        )

    async def update_job(
        self,
        *,
        workspace_id: str,
        job_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_update(
            "ingestion_jobs",
            values,
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("id", job_id)),
        )
        return first_row(rows)

    async def claim_next_queued(self, *, workspace_id: str | None = None) -> dict[str, Any] | None:
        filters = ["select=*", "status=eq.queued", "order=created_at.asc", "limit=1"]
        if workspace_id:
            filters.insert(1, eq_filter("workspace_id", workspace_id))
        rows = await self._supabase.table_select("ingestion_jobs", query=and_query(*filters))
        job = first_row(rows)
        if not job:
            return None
        return await self.update_job(
            workspace_id=str(job["workspace_id"]),
            job_id=str(job["id"]),
            values={"status": "processing", "stage": "claimed", "progress": 1},
        )
