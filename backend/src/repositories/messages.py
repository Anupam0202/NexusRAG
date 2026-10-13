"""Chat session and message persistence."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID, uuid4

from src.repositories.base import SupabaseRepository, and_query, encoded, eq_filter


class ConversationUnavailableError(ValueError):
    """No live caller-owned conversation was authorized for cleanup."""


class ConversationConflictError(ValueError):
    """Conversation authority changed before the turn could commit."""


@dataclass(frozen=True)
class PrivateTurnContext:
    workspace_id: str
    session_id: str
    user_id: str
    revision: int
    history_epoch: int
    history: tuple[dict[str, str], ...] = field(repr=False)
    access_token: str = field(repr=False)
    key: str = field(default_factory=lambda: str(uuid4()), repr=False)

    @property
    def cache_authority(self) -> str:
        return hashlib.sha256(json.dumps([self.workspace_id, self.session_id,
            self.user_id, self.revision, self.history_epoch]).encode()).hexdigest()


class MessageRepository(SupabaseRepository):
    async def read_turn_context(self, *, workspace_id: str, session_id: str,
                                user_id: str, access_token: str) -> PrivateTurnContext:
        workspace_id, session_id, user_id = map(str, map(UUID, (workspace_id, session_id, user_id)))
        rows = await self._supabase.rpc_as_user("read_backend_private_turn_context",
            {"p_workspace": workspace_id, "p_session": session_id}, access_token=access_token)
        row = self._turn_receipt(rows, workspace_id, session_id)
        if row.get("actor_id") != user_id or any(type(row.get(key)) is not int
                or not 0 <= row[key] < 2**53 - 2 for key in ("revision", "history_epoch")):
            raise ValueError("Unconfirmed private turn context")
        history = row.get("history")
        if not isinstance(history, list) or len(history) > 50 or any(
            not isinstance(message, dict) or message.get("role") not in {"user", "assistant", "system"}
            or not isinstance(message.get("content"), str) or len(message["content"]) > 5000
            for message in history):
            raise ValueError("Unconfirmed private history snapshot")
        return PrivateTurnContext(workspace_id, session_id, user_id, row["revision"],
            row["history_epoch"], tuple({"role": m["role"], "content": m["content"]} for m in history), access_token)

    async def commit_turn(self, context: PrivateTurnContext, *, question: str, answer: str,
                          sources: list[dict[str, Any]], metadata: dict[str, Any]) -> dict:
        payload = {"p_workspace": context.workspace_id, "p_session": context.session_id,
            "p_key": context.key, "p_revision": context.revision, "p_epoch": context.history_epoch,
            "p_question": question, "p_answer": answer, "p_sources": sources, "p_metadata": metadata}
        staged = await self._supabase.rpc("stage_backend_private_turn", {"p_actor": context.user_id, **payload})
        row = self._turn_receipt(staged, context.workspace_id, context.session_id)
        if row.get("state") != "STAGED" or type(row.get("revision")) is not int \
                or row["revision"] != context.revision or type(row.get("history_epoch")) is not int \
                or row["history_epoch"] != context.history_epoch:
            raise ValueError("Unconfirmed private turn staging")
        committed = await self._supabase.rpc_as_user("commit_backend_private_turn", payload,
                                                    access_token=context.access_token)
        row = self._turn_receipt(committed, context.workspace_id, context.session_id)
        if row.get("state") == "CONFLICT":
            raise ConversationConflictError("Conversation changed; reload before continuing")
        if row.get("state") != "COMMITTED" or type(row.get("messages_written")) is not int \
                or row["messages_written"] != 2 or type(row.get("revision")) is not int \
                or row["revision"] != context.revision + 1 or type(row.get("history_epoch")) is not int \
                or row["history_epoch"] != context.history_epoch + 1:
            raise ValueError("Unconfirmed private turn commit")
        return row

    async def revalidate_turn_context(self, context: PrivateTurnContext) -> None:
        current = await self.read_turn_context(workspace_id=context.workspace_id,
            session_id=context.session_id, user_id=context.user_id, access_token=context.access_token)
        if current.cache_authority != context.cache_authority or current.history != context.history:
            raise ConversationConflictError("Conversation changed before generation")

    @staticmethod
    def _turn_receipt(rows: Any, workspace_id: str, session_id: str) -> dict:
        if rows == []:
            raise ConversationUnavailableError("Conversation is not available")
        if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) \
                or rows[0].get("workspace_id") != workspace_id or rows[0].get("session_id") != session_id:
            raise ValueError("Unconfirmed private turn response")
        return rows[0]

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
