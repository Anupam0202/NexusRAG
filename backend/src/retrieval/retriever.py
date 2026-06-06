"""
Hybrid Retriever with Adaptive K
==================================

Orchestrates:
1. **Query transformation** (multi-query, history-aware reformulation).
2. **Hybrid search** (dense + sparse via ``VectorStoreManager``).
3. **Re-ranking** (cross-encoder or LLM, with graceful fallback).
4. **Adaptive K** — adjusts retrieval depth by detected query type.

This is the main entry-point for the generation layer.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import time
from collections import defaultdict
from enum import StrEnum
from typing import Any

from config.settings import Settings, get_settings
from src.retrieval.query_transformer import QueryTransformer
from src.retrieval.reranker import RerankerPipeline
from src.retrieval.vector_store import SearchHit, VectorStoreManager
from src.utils.logger import get_logger

logger = get_logger(__name__)


# ── Query type classification (regex, no LLM cost) ──────────────────────


class QueryType(StrEnum):
    LIST_ALL = "list_all"
    AGGREGATION = "aggregation"
    FILTER = "filter"
    COMPARISON = "comparison"
    SUMMARY = "summary"
    SPECIFIC = "specific"
    GENERAL = "general"


_QUERY_PATTERNS: dict[QueryType, list[re.Pattern]] = {  # type: ignore
    QueryType.LIST_ALL: [
        re.compile(
            r"\b(show|list|display|get|give|provide)\s+(me\s+)?"
            r"(all|every|complete|full)\b",
            re.I,
        ),
        re.compile(r"\ball\s+(the\s+)?(data|records|rows|entries|employees|items)\b", re.I),
        re.compile(r"\b(everything|complete\s+list)\b", re.I),
        re.compile(
            r"\b(which|what|list|show|display)\b.*\b(uploaded|available|indexed)?\s*"
            r"(files?|documents?|source\s+files?|filenames?)\b",
            re.I,
        ),
        re.compile(r"\b(uploaded|available|indexed)\s+(files?|documents?|filenames?)\b", re.I),
    ],
    QueryType.AGGREGATION: [
        re.compile(
            r"\b(total|sum|average|avg|mean|count|how\s+many|maximum|minimum|max|min)\b",
            re.I,
        ),
    ],
    QueryType.FILTER: [
        re.compile(r"\b(where|with|having|in|at|from|filter|only|just)\b", re.I),
        re.compile(r"\bwho\s+(is|are|has|have|works?)\b", re.I),
    ],
    QueryType.COMPARISON: [
        re.compile(r"\b(compare|comparison|versus|vs\.?|difference)\b", re.I),
    ],
    QueryType.SUMMARY: [
        re.compile(r"\b(summarize|summary|overview|brief|outline)\b", re.I),
    ],
}

_K_BY_TYPE: dict[QueryType, int] = {
    QueryType.LIST_ALL: 50,
    QueryType.AGGREGATION: 30,
    QueryType.FILTER: 25,
    QueryType.COMPARISON: 20,
    QueryType.SUMMARY: 15,
    QueryType.SPECIFIC: 10,
    QueryType.GENERAL: 10,
}


def classify_query(query: str) -> QueryType:
    """Classify a query using regex patterns (zero LLM cost)."""
    scores: dict[QueryType, int] = defaultdict(int)
    for qt, patterns in _QUERY_PATTERNS.items():
        for p in patterns:
            if p.search(query):
                scores[qt] += 1
    if scores:
        return max(scores, key=scores.get)  # type: ignore
    return QueryType.GENERAL


# ═══════════════════════════════════════════════════════════════════════════
#  HYBRID RETRIEVER
# ═══════════════════════════════════════════════════════════════════════════


class HybridRetriever:
    """Top-level retrieval engine.

    Usage::

        retriever = HybridRetriever(vector_store=vs)
        results = retriever.retrieve("Show all employees", history=[...])
    """

    def __init__(
        self,
        vector_store: VectorStoreManager,
        settings: Settings | None = None,
    ) -> None:
        s = settings or get_settings()
        self._store = vector_store
        self._default_k = s.retrieval_top_k
        self._reranker = RerankerPipeline(settings=s)
        self._transformer = QueryTransformer(settings=s)
        self._enable_rerank = s.enable_reranking
        self._rerank_top_k = s.rerank_top_k
        self._cache_enabled = s.enable_cache
        self._cache_ttl = s.cache_ttl_seconds
        self._cache: dict[str, tuple[float, str, dict[str, Any]]] = {}

    def retrieve(
        self,
        query: str,
        *,
        workspace_id: str | None = None,
        history: list[dict[str, str]] | None = None,
        top_k: int | None = None,
        use_reranking: bool | None = None,
        filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Full retrieval pipeline.

        Returns:
            Dict with keys ``documents``, ``query_type``, ``k_used``,
            ``transformed_queries``.
        """
        # 1. Classify query type → adaptive K
        cache_key = self._cache_key(
            query=query,
            workspace_id=workspace_id,
            history=history,
            top_k=top_k,
            use_reranking=use_reranking,
            filters=filters,
        )
        cached = self._cache_get(cache_key)
        if cached is not None:
            cached["retrieval_cache_hit"] = True
            return cached

        query_type = classify_query(query)
        effective_k = top_k or _K_BY_TYPE.get(query_type, self._default_k)
        count_chunks = getattr(self._store, "count_chunks", None)
        visible_chunks = (
            count_chunks(workspace_id=workspace_id)
            if callable(count_chunks)
            else getattr(self._store, "total_chunks", 0)
        )
        effective_k = min(effective_k, visible_chunks or effective_k)

        # 2. Transform query
        transformed = self._transformer.transform(
            query,
            workspace_id=workspace_id,
            history=history,
        )
        queries = transformed["queries"]  # list of query strings

        # 3. Retrieve for every query variant
        all_hits: list[SearchHit] = []
        for q in queries:
            hits = self._store.search(
                q,
                top_k=effective_k,
                workspace_id=workspace_id,
                filters=filters,
            )
            all_hits.extend(hits)

        # 4. Deduplicate
        seen_ids: set = set()
        unique_hits: list[SearchHit] = []
        for h in all_hits:
            cid = id(h.document)
            if cid not in seen_ids:
                seen_ids.add(cid)
                unique_hits.append(h)

        # Sort by score descending
        unique_hits.sort(key=lambda h: h.score, reverse=True)

        # Attach retrieval scores to document metadata so downstream components
        # (confidence estimation, source display) can use actual relevance scores
        for h in unique_hits[:effective_k]:
            h.document.metadata["score"] = round(float(h.score), 4)

        # 5. Re-rank (optional, graceful fallback)
        should_rerank = use_reranking if use_reranking is not None else self._enable_rerank
        docs = [h.document for h in unique_hits[:effective_k]]

        if should_rerank and docs:
            try:
                docs = self._reranker.rerank(query=query, documents=docs, top_k=self._rerank_top_k)
            except Exception as exc:
                logger.warning("reranking_failed — using base results", error=str(exc))
                docs = docs[: self._rerank_top_k]
        else:
            docs = docs[: self._rerank_top_k]

        logger.info(
            "retrieval_complete",
            query_type=query_type.value,
            k_used=effective_k,
            docs_returned=len(docs),
            reranked=should_rerank,
            workspace_id=workspace_id,
            filters=filters or {},
        )

        result = {
            "documents": docs,
            "query_type": query_type,
            "k_used": effective_k,
            "transformed_queries": queries,
            "retrieval_cache_hit": False,
        }
        self._cache_set(cache_key, workspace_id=workspace_id, value=result)
        return result

    def clear_cache(self, *, workspace_id: str | None = None) -> None:
        if workspace_id is None:
            self._cache.clear()
            return
        self._cache = {
            key: entry
            for key, entry in self._cache.items()
            if entry[1] != workspace_id
        }

    @staticmethod
    def _cache_key(
        *,
        query: str,
        workspace_id: str | None,
        history: list[dict[str, str]] | None,
        top_k: int | None,
        use_reranking: bool | None,
        filters: dict[str, Any] | None,
    ) -> str:
        payload = json.dumps(
            {
                "workspace_id": workspace_id or "default",
                "query": " ".join(query.lower().split()),
                "history": history or [],
                "top_k": top_k,
                "use_reranking": use_reranking,
                "filters": filters or {},
            },
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        return hashlib.sha256(payload.encode()).hexdigest()

    def _cache_get(self, key: str) -> dict[str, Any] | None:
        if not self._cache_enabled:
            return None
        entry = self._cache.get(key)
        if not entry:
            return None
        expires_at, _workspace_id, value = entry
        if expires_at <= time.monotonic():
            self._cache.pop(key, None)
            return None
        return copy.deepcopy(value)

    def _cache_set(
        self,
        key: str,
        *,
        workspace_id: str | None,
        value: dict[str, Any],
    ) -> None:
        if not self._cache_enabled:
            return
        self._cache[key] = (
            time.monotonic() + self._cache_ttl,
            workspace_id or "default",
            copy.deepcopy(value),
        )
        if len(self._cache) > 512:
            oldest = next(iter(self._cache))
            self._cache.pop(oldest, None)
