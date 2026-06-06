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
        job_id: str | None = None,
        stage: str = "queued",
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "workspace_id": workspace_id,
            "document_id": document_id,
            "status": "queued",
            "progress": 0,
            "stage": stage,
        }
        if job_id:
            payload["id"] = job_id
        rows = await self._supabase.table_insert("ingestion_jobs", payload)
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

    async def claim_next_queued(
        self,
        *,
        worker_id: str,
        lease_seconds: int = 300,
        workspace_id: str | None = None,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.rpc(
            "claim_ingestion_job",
            {
                "p_worker_id": worker_id,
                "p_lease_seconds": max(30, min(int(lease_seconds), 3600)),
                "p_workspace_id": workspace_id,
            },
        )
        return first_row(rows if isinstance(rows, list) else [rows])

    async def requeue_claimed_job(
        self,
        *,
        job_id: str,
        worker_id: str,
        error_message: str,
        retry_seconds: int = 30,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.rpc(
            "requeue_ingestion_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_error_message": error_message[:2000],
                "p_retry_seconds": max(1, min(int(retry_seconds), 86400)),
            },
        )
        return first_row(rows if isinstance(rows, list) else [rows])
