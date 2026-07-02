"""Encrypted BYOK metadata persistence."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter, first_row


class ApiKeyRepository(SupabaseRepository):
    async def store_encrypted_key(
        self,
        *,
        workspace_id: str,
        user_id: str,
        provider: str,
        encrypted_key: str,
        key_prefix: str | None,
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "api_keys",
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "provider": provider,
                "encrypted_key": encrypted_key,
                "key_prefix": key_prefix,
                "is_active": True,
            },
        )
        return rows[0]

    async def list_active_keys(
        self,
        *,
        workspace_id: str,
        provider: str | None = None,
    ) -> list[dict[str, Any]]:
        filters = [
            "select=id,workspace_id,user_id,provider,key_prefix,is_active,created_at,last_used_at",
            eq_filter("workspace_id", workspace_id),
            "is_active=eq.true",
            "order=created_at.desc",
        ]
        if provider:
            filters.insert(2, eq_filter("provider", provider))
        return await self._supabase.table_select("api_keys", query=and_query(*filters))

    async def get_active_key(
        self,
        *,
        workspace_id: str,
        provider: str,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "api_keys",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("provider", provider),
                "is_active=eq.true",
                "order=created_at.desc",
                "limit=1",
            ),
        )
        return first_row(rows)

    async def deactivate_key(self, *, workspace_id: str, key_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_update(
            "api_keys",
            {"is_active": False},
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("id", key_id)),
        )
        return first_row(rows)

    async def deactivate_active_keys(
        self,
        *,
        workspace_id: str,
        user_id: str,
        provider: str,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_update(
            "api_keys",
            {"is_active": False},
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                eq_filter("user_id", user_id),
                eq_filter("provider", provider),
                "is_active=eq.true",
            ),
        )

    async def mark_used(self, *, workspace_id: str, key_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_update(
            "api_keys",
            {"last_used_at": datetime.now(UTC).isoformat()},
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("id", key_id)),
        )
        return first_row(rows)

    async def delete_workspace_keys(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_delete(
            "api_keys",
            query=eq_filter("workspace_id", workspace_id),
        )
        return len(rows)
