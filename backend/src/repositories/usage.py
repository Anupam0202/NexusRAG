"""LLM usage event persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter


class UsageRepository(SupabaseRepository):
    async def record_event(
        self,
        *,
        workspace_id: str,
        user_id: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        operation: str | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        latency_ms: int | None = None,
        success: bool = True,
        error_code: str | None = None,
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "llm_usage_events",
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "provider": provider,
                "model": model,
                "operation": operation,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "latency_ms": latency_ms,
                "success": success,
                "error_code": error_code,
            },
        )
        return rows[0]

    async def list_events(
        self,
        *,
        workspace_id: str,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "llm_usage_events",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                "order=created_at.desc",
                f"limit={limit}",
            ),
        )
