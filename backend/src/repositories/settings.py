"""Workspace-scoped runtime settings persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, eq_filter, first_row


class WorkspaceSettingsRepository(SupabaseRepository):
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
