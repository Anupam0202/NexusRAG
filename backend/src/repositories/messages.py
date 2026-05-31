"""Chat session and message persistence."""

from __future__ import annotations

from typing import Any

from src.repositories.base import SupabaseRepository, and_query, eq_filter, first_row


class MessageRepository(SupabaseRepository):
    async def create_session(
        self,
        *,
        workspace_id: str,
        user_id: str | None,
        session_id: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "workspace_id": workspace_id,
            "user_id": user_id,
            "title": title,
        }
        if session_id:
            payload["id"] = session_id
        rows = await self._supabase.table_insert(
            "chat_sessions",
            payload,
        )
        return rows[0]

    async def ensure_session(
        self,
        *,
        workspace_id: str,
        session_id: str,
        user_id: str | None,
        title: str | None = None,
    ) -> dict[str, Any]:
        existing = await self.get_session(workspace_id=workspace_id, session_id=session_id)
        if existing:
            return existing
        return await self.create_session(
            workspace_id=workspace_id,
            user_id=user_id,
            session_id=session_id,
            title=title,
        )

    async def get_session(self, *, workspace_id: str, session_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "chat_sessions",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("id", session_id),
                "limit=1",
            ),
        )
        return first_row(rows)

    async def add_message(
        self,
        *,
        workspace_id: str,
        session_id: str,
        role: str,
        content: str,
        sources: list[dict[str, Any]] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "chat_messages",
            {
                "workspace_id": workspace_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "sources": sources or [],
                "metadata": metadata or {},
            },
        )
        return rows[0]

    async def list_messages(
        self,
        *,
        workspace_id: str,
        session_id: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "chat_messages",
            query=and_query(
                "select=*",
                eq_filter("workspace_id", workspace_id),
                eq_filter("session_id", session_id),
                "order=created_at.asc",
                f"limit={limit}",
            ),
        )

    async def clear_session(self, *, workspace_id: str, session_id: str) -> int:
        rows = await self._supabase.table_delete(
            "chat_messages",
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                eq_filter("session_id", session_id),
            ),
        )
        return len(rows)
