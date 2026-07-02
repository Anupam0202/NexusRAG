"""Durable provider health snapshots for workspace operations."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ProviderHealthRepository(SupabaseRepository):
    async def upsert_snapshot(
        self,
        *,
        workspace_id: str,
        snapshot: list[dict[str, Any]],
    ) -> int:
        payload = [
            {
                "workspace_id": workspace_id,
                "provider": str(item.get("provider") or "unknown"),
                "model": str(item.get("model") or "unknown"),
                "mode": str(item.get("mode") or "server_default_key"),
                "consecutive_failures": int(item.get("consecutive_failures") or 0),
                "quota_exhausted": bool(item.get("quota_exhausted")),
                "last_error_code": item.get("last_error_code"),
                "circuit_open_until": item.get("circuit_open_until"),
            }
            for item in snapshot
            if item.get("provider") and item.get("model")
        ]
        if not payload:
            return 0
        rows = await self._supabase.table_upsert(
            "provider_health_state",
            payload,
            on_conflict="workspace_id,provider,model,mode",
        )
        return len(rows) if rows else len(payload)

    async def list_for_workspace(self, *, workspace_id: str) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "provider_health_state",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                "order=updated_at.desc",
            ),
        )

    async def delete_workspace_state(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_delete(
            "provider_health_state",
            query=eq_filter("workspace_id", workspace_id),
        )
        return len(rows)


async def persist_provider_health_snapshot(
    chain: Any,
    *,
    workspace_id: str,
    persist: bool,
) -> int:
    if not persist:
        return 0
    try:
        router = getattr(chain.llm, "_router", None)
        snapshot = router.health_snapshot() if router is not None else []
        return await ProviderHealthRepository().upsert_snapshot(
            workspace_id=workspace_id,
            snapshot=snapshot,
        )
    except Exception as exc:
        logger.warning(
            "provider_health_snapshot_persist_failed",
            workspace_id=workspace_id,
            error=str(exc)[:300],
        )
        return 0
