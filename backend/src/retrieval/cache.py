"""
Semantic Query Cache
=====================

Caches query→response pairs.  On a new query the cache computes the
embedding and compares it against cached query embeddings using cosine
similarity.  If a cached entry exceeds the similarity threshold (default
0.95) *and* is within TTL, the cached response is returned — saving a
full retrieval + generation round-trip.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import numpy as np

from config.settings import Settings, get_settings
from src.ingestion.embedder import Embedder, get_embedder
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class CacheEntry:
    """Single cached query–response pair."""

    query: str
    query_embedding: np.ndarray
    response: Dict[str, Any]
    created_at: float = field(default_factory=time.time)


class SemanticCache:
    """Embedding-based semantic cache with TTL and LRU eviction.

    Usage::

        cache = SemanticCache()
        hit = cache.get(query)
        if hit:
            return hit  # cached response
        ...  # compute response
        cache.set(query, response)
    """

    def __init__(
        self,
        settings: Optional[Settings] = None,
        similarity_threshold: float = 0.95,
        max_entries: int = 500,
    ) -> None:
        s = settings or get_settings()
        self._embedder = get_embedder()
        self._ttl = s.cache_ttl_seconds
        self._enabled = s.enable_cache
        self._threshold = similarity_threshold
        self._max_entries = max_entries

        self._entries: List[CacheEntry] = []
        self._lock = threading.Lock()

        # Stats
        self.hits = 0
        self.misses = 0

    def get(self, query: str) -> Optional[Dict[str, Any]]:
        """Look up a semantically similar cached response.

        Returns:
            The cached response dict if found, else ``None``.
        """
        if not self._enabled or not self._entries:
            self.misses += 1
            return None

        q_emb = np.array(self._embedder.embed_query(query), dtype="float32")
        now = time.time()

        best_score = 0.0
        best_entry: Optional[CacheEntry] = None

        with self._lock:
            for entry in self._entries:
                # TTL check
                if now - entry.created_at > self._ttl:
                    continue
                cos = float(
                    np.dot(q_emb, entry.query_embedding)
                    / (np.linalg.norm(q_emb) * np.linalg.norm(entry.query_embedding) + 1e-10)
                )
                if cos > best_score:
                    best_score = cos
                    best_entry = entry

        if best_entry and best_score >= self._threshold:
            self.hits += 1
            logger.debug("cache_hit", similarity=round(best_score, 4))
            return best_entry.response

        self.misses += 1
        return None

    def set(self, query: str, response: Dict[str, Any]) -> None:
        """Store a query–response pair in the cache."""
        if not self._enabled:
            return

        q_emb = np.array(self._embedder.embed_query(query), dtype="float32")
        entry = CacheEntry(query=query, query_embedding=q_emb, response=response)

        with self._lock:
            self._entries.append(entry)
            # Evict oldest if over limit
            if len(self._entries) > self._max_entries:
                self._entries = self._entries[-self._max_entries:]

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
        logger.info("semantic_cache_cleared")

    def cleanup_expired(self) -> int:
        """Remove expired entries.  Returns count removed."""
        now = time.time()
        with self._lock:
            before = len(self._entries)
            self._entries = [e for e in self._entries if now - e.created_at <= self._ttl]
            removed = before - len(self._entries)
        if removed:
            logger.info("cache_cleanup", removed=removed)
        return removed

    @property
    def stats(self) -> Dict[str, Any]:
        total = self.hits + self.misses
        return {
            "entries": len(self._entries),
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total * 100, 1) if total else 0.0,
        }