"""Chat session and message persistence."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.repositories.base import SupabaseRepository, and_query, encoded, eq_filter, first_row


class ConversationUnavailableError(ValueError):
    """No live caller-owned conversation was authorized for cleanup."""


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

    async def list_authorized_messages(
        self,
        *,
        workspace_id: str,
        session_id: str,
        access_token: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        workspace_id = str(UUID(workspace_id))
        session_id = str(UUID(session_id))
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("Invalid history read limit")
        rows = await self._supabase.rpc_as_user(
            "read_private_history",
            {"p_workspace": workspace_id, "p_session": session_id, "p_limit": limit},
            access_token=access_token,
        )
        if not isinstance(rows, list) or len(rows) > limit or any(
            not isinstance(row, dict)
            or row.get("workspace_id") != workspace_id
            or row.get("session_id") != session_id
            for row in rows
        ):
            raise ValueError("Unconfirmed history read response")
        return rows

    async def clear_session(
        self, *, workspace_id: str, session_id: str, access_token: str
    ) -> int:
        workspace_id = str(UUID(workspace_id))
        session_id = str(UUID(session_id))
        rows = await self._supabase.rpc_as_user(
            "clear_private_history",
            {"p_workspace": workspace_id, "p_session": session_id},
            access_token=access_token,
        )
        if rows == []:
            raise ConversationUnavailableError("Conversation is not available")
        if (
            not isinstance(rows, list) or len(rows) != 1
            or not isinstance(rows[0], dict)
            or rows[0].get("workspace_id") != workspace_id
            or rows[0].get("session_id") != session_id
            or rows[0].get("success") is not True
            or type(rows[0].get("durable_messages_deleted")) is not int
            or not 0 <= rows[0]["durable_messages_deleted"] <= 2**53 - 1
        ):
            raise ValueError("Unconfirmed history cleanup response")
        return rows[0]["durable_messages_deleted"]

    async def delete_sessions_before(self, *, workspace_id: str, created_before: str) -> int:
        rows = await self._supabase.table_delete(
            "chat_sessions",
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                f"created_at=lt.{encoded(created_before)}",
            ),
        )
        return len(rows)

    async def delete_workspace_history(self, *, workspace_id: str) -> int:
        message_rows = await self._supabase.table_delete(
            "chat_messages",
            query=eq_filter("workspace_id", workspace_id),
        )
        session_rows = await self._supabase.table_delete(
            "chat_sessions",
            query=eq_filter("workspace_id", workspace_id),
        )
        return len(message_rows) + len(session_rows)
