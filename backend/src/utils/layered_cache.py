"""Bounded tenant-scoped cache primitives for expensive RAG pipeline stages."""

from __future__ import annotations

import copy
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from config.settings import get_settings
from src.utils.tenant import normalize_workspace_id


@dataclass
class _Entry:
    value: Any
    workspace_id: str
    document_id: str | None
    expires_at: float


class LayeredCache:
    """Thread-safe TTL cache partitioned by layer, workspace, and document."""

    def __init__(self, *, ttl_seconds: int, max_entries: int = 512) -> None:
        self._ttl_seconds = max(1, int(ttl_seconds))
        self._max_entries = max(1, int(max_entries))
        self._entries: dict[tuple[str, str, str, str | None], _Entry] = {}
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0

    @staticmethod
    def _key(
        layer: str,
        key: str,
        *,
        workspace_id: str | None,
        document_id: str | None,
    ) -> tuple[str, str, str, str | None]:
        return (
            layer.strip().lower(),
            key,
            normalize_workspace_id(workspace_id),
            document_id,
        )

    def get(
        self,
        layer: str,
        key: str,
        *,
        workspace_id: str | None,
        document_id: str | None = None,
    ) -> Any | None:
        cache_key = self._key(
            layer,
            key,
            workspace_id=workspace_id,
            document_id=document_id,
        )
        with self._lock:
            entry = self._entries.get(cache_key)
            if not entry:
                self.misses += 1
                return None
            if entry.expires_at <= time.monotonic():
                self._entries.pop(cache_key, None)
                self.misses += 1
                return None
            self.hits += 1
            return copy.deepcopy(entry.value)

    def set(
        self,
        layer: str,
        key: str,
        value: Any,
        *,
        workspace_id: str | None,
        document_id: str | None = None,
    ) -> None:
        cache_key = self._key(
            layer,
            key,
            workspace_id=workspace_id,
            document_id=document_id,
        )
        with self._lock:
            self._entries[cache_key] = _Entry(
                value=copy.deepcopy(value),
                workspace_id=cache_key[2],
                document_id=document_id,
                expires_at=time.monotonic() + self._ttl_seconds,
            )
            while len(self._entries) > self._max_entries:
                self._entries.pop(next(iter(self._entries)), None)

    def invalidate(
        self,
        *,
        workspace_id: str | None = None,
        document_id: str | None = None,
        layers: set[str] | None = None,
    ) -> int:
        scoped_workspace = normalize_workspace_id(workspace_id) if workspace_id else None
        normalized_layers = {item.strip().lower() for item in layers} if layers else None
        with self._lock:
            keys = [
                key
                for key, entry in self._entries.items()
                if (scoped_workspace is None or entry.workspace_id == scoped_workspace)
                and (document_id is None or entry.document_id == document_id)
                and (normalized_layers is None or key[0] in normalized_layers)
            ]
            for key in keys:
                self._entries.pop(key, None)
            return len(keys)

    @property
    def stats(self) -> dict[str, Any]:
        total = self.hits + self.misses
        with self._lock:
            layers = sorted({key[0] for key in self._entries})
            entries = len(self._entries)
        return {
            "entries": entries,
            "layers": layers,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total * 100, 1) if total else 0.0,
        }


@lru_cache(maxsize=1)
def get_layered_cache() -> LayeredCache:
    settings = get_settings()
    return LayeredCache(ttl_seconds=settings.cache_ttl_seconds, max_entries=1024)
