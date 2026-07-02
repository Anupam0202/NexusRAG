"""Workspace-scoped runtime settings persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, eq_filter, first_row


class WorkspaceSettingsRepository(SupabaseRepository):
    async def claim_due_retention(
        self,
        *,
        worker_id: str,
        limit: int = 100,
        lease_seconds: int = 900,
    ) -> list[dict[str, Any]]:
        rows = await self._supabase.rpc(
            "claim_retention_schedules",
            {
                "p_worker_id": worker_id,
                "p_limit": max(1, min(limit, 500)),
                "p_lease_seconds": max(60, min(lease_seconds, 3600)),
            },
        )
        return rows if isinstance(rows, list) else [rows]

    async def get_settings(self, *, workspace_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "workspace_settings",
            query=f"select=*&{eq_filter('workspace_id', workspace_id)}&limit=1",
        )
        return first_row(rows)

    async def upsert_settings(
        self,
        *,
        workspace_id: str,
        values: dict[str, Any],
    ) -> dict[str, Any]:
        payload = {**values, "workspace_id": workspace_id}
        rows = await self._supabase.table_upsert(
            "workspace_settings",
            payload,
            on_conflict="workspace_id",
        )
        return rows[0]

    async def delete_settings(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_delete(
            "workspace_settings",
            query=eq_filter("workspace_id", workspace_id),
        )
        return len(rows)
