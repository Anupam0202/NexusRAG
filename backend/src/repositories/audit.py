"""Audit event persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter


class AuditRepository(SupabaseRepository):
    async def record_event(
        self,
        *,
        action: str,
        workspace_id: str | None = None,
        user_id: str | None = None,
        resource_type: str | None = None,
        resource_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "audit_events",
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "ip_address": ip_address,
                "user_agent": user_agent,
                "metadata": metadata or {},
            },
        )
        return rows[0]

    async def list_events(
        self,
        *,
        workspace_id: str,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "audit_events",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                "order=created_at.desc",
                f"limit={limit}",
            ),
        )
