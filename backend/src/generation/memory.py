"""
Conversation Memory
====================

``ConversationMemory`` holds the turn-by-turn history for a single
conversation and trims to the configured context window.

``SessionMemoryStore`` maps session IDs to ``ConversationMemory``
instances, providing multi-user isolation with automatic expiry.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class Message:
    role: str  # "user" | "assistant"
    content: str
    timestamp: float = field(default_factory=time.time)
    metadata: Dict[str, Any] = field(default_factory=dict)


class ConversationMemory:
    """Holds and trims conversation history for a single session.

    The context window controls how many *recent messages* are included
    when building the prompt.  Older messages are retained in ``_history``
    so they can be exported, but they are **not** sent to the LLM.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        self._max_messages = s.context_window_messages * 2  # user + assistant pairs
        self._max_chars = s.max_context_chars
        self._history: List[Message] = []

    def add(self, role: str, content: str, **meta: Any) -> None:
        self._history.append(Message(role=role, content=content[:5000], metadata=meta))

    def get_context_messages(self) -> List[Dict[str, str]]:
        """Return the most recent messages that fit the context window."""
        recent = self._history[-self._max_messages :]
        total_chars = sum(len(m.content) for m in recent)
        while total_chars > self._max_chars and len(recent) > 1:
            recent = recent[1:]
            total_chars = sum(len(m.content) for m in recent)
        return [{"role": m.role, "content": m.content} for m in recent]

    def get_formatted_history(self) -> str:
        """Return a newline-delimited text version of the context window."""
        msgs = self.get_context_messages()
        if not msgs:
            return "No previous conversation."
        parts = []
        for m in msgs:
            label = "User" if m["role"] == "user" else "Assistant"
            parts.append(f"{label}: {m['content']}")
        return "\n".join(parts)

    def get_full_history(self) -> List[Dict[str, Any]]:
        """Return the complete history (for export)."""
        return [
            {
                "role": m.role,
                "content": m.content,
                "timestamp": m.timestamp,
                **m.metadata,
            }
            for m in self._history
        ]

    def clear(self) -> None:
        self._history.clear()

    @property
    def length(self) -> int:
        return len(self._history)


class SessionMemoryStore:
    """Thread-safe registry of per-session ``ConversationMemory`` instances.

    Sessions that have been idle longer than *ttl_seconds* are
    automatically evicted on the next ``get`` call.
    """

    def __init__(self, ttl_seconds: int = 7200) -> None:
        self._memories: Dict[str, ConversationMemory] = {}
        self._last_access: Dict[str, float] = {}
        self._ttl = ttl_seconds
        self._lock = threading.Lock()

    def get(self, session_id: str) -> ConversationMemory:
        with self._lock:
            self._evict_expired()
            if session_id not in self._memories:
                self._memories[session_id] = ConversationMemory()
                logger.debug("session_created", session_id=session_id[:8])
            self._last_access[session_id] = time.time()
            return self._memories[session_id]

    def delete(self, session_id: str) -> None:
        with self._lock:
            self._memories.pop(session_id, None)
            self._last_access.pop(session_id, None)

    def _evict_expired(self) -> None:
        now = time.time()
        expired = [
            sid for sid, ts in self._last_access.items() if now - ts > self._ttl
        ]
        for sid in expired:
            del self._memories[sid]
            del self._last_access[sid]
        if expired:
            logger.info("sessions_evicted", count=len(expired))

    @property
    def active_sessions(self) -> int:
        return len(self._memories)