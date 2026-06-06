"""Durable daily usage reconciliation for workspace billing posture."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter, first_row


class BillingRepository(SupabaseRepository):
    async def reconcile_day(
        self,
        *,
        workspace_id: str,
        usage_date: str | None = None,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.rpc(
            "reconcile_workspace_usage",
            {
                "p_workspace_id": workspace_id,
                "p_usage_date": usage_date,
            },
        )
        return first_row(rows if isinstance(rows, list) else [rows])

    async def list_daily(
        self,
        *,
        workspace_id: str,
        limit: int = 30,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "workspace_usage_daily",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                "order=usage_date.desc",
                f"limit={max(1, min(limit, 366))}",
            ),
        )
