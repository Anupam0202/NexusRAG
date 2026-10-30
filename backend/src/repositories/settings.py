"""Workspace-scoped runtime settings persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, eq_filter, first_row


class WorkspaceSettingsRepository(SupabaseRepository):
    async def claim_workspace_retention(
        self, *, workspace_id: str, actor_id: str, worker_id: str,
        lease_seconds: int = 900,
    ) -> dict[str, Any] | None:
        result = await self._supabase.rpc(
            "claim_workspace_retention",
            {"p_workspace": workspace_id, "p_actor": actor_id,
             "p_worker_id": worker_id, "p_lease_seconds": lease_seconds},
        )
        if result is not None and type(result) is not dict:
            raise RuntimeError("Invalid manual retention claim response")
        return result

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

    async def finish_retention_claim(
        self,
        *,
        workspace_id: str,
        worker_id: str,
        lease_expires_at: str,
        retention_days: int,
        succeeded: bool,
    ) -> bool:
        """Database-clock, exact-claim completion; no unfenced write fallback."""
        result = await self._supabase.rpc(
            "finish_retention_claim",
            {
                "p_workspace": workspace_id,
                "p_worker_id": worker_id,
                "p_lease_expires_at": lease_expires_at,
                "p_retention_days": retention_days,
                "p_succeeded": succeeded,
            },
        )
        if type(result) is not bool:
            raise RuntimeError("Invalid retention completion response")
        return result

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
