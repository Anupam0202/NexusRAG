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

import re
from collections import defaultdict
from enum import Enum
from typing import Any, Dict, List, Optional

from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.retrieval.query_transformer import QueryTransformer
from src.retrieval.reranker import RerankerPipeline
from src.retrieval.vector_store import SearchHit, VectorStoreManager
from src.utils.logger import get_logger

logger = get_logger(__name__)


# ── Query type classification (regex, no LLM cost) ──────────────────────


class QueryType(str, Enum):
    LIST_ALL = "list_all"
    AGGREGATION = "aggregation"
    FILTER = "filter"
    COMPARISON = "comparison"
    SUMMARY = "summary"
    SPECIFIC = "specific"
    GENERAL = "general"


_QUERY_PATTERNS: Dict[QueryType, List[re.Pattern]] = {  # type: ignore
    QueryType.LIST_ALL: [
        re.compile(r"\b(show|list|display|get|give|provide)\s+(me\s+)?(all|every|complete|full)\b", re.I),
        re.compile(r"\ball\s+(the\s+)?(data|records|rows|entries|employees|items)\b", re.I),
        re.compile(r"\b(everything|complete\s+list)\b", re.I),
    ],
    QueryType.AGGREGATION: [
        re.compile(r"\b(total|sum|average|avg|mean|count|how\s+many|maximum|minimum|max|min)\b", re.I),
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

_K_BY_TYPE: Dict[QueryType, int] = {
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
    scores: Dict[QueryType, int] = defaultdict(int)
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
        settings: Optional[Settings] = None,
    ) -> None:
        s = settings or get_settings()
        self._store = vector_store
        self._default_k = s.retrieval_top_k
        self._reranker = RerankerPipeline(settings=s)
        self._transformer = QueryTransformer(settings=s)
        self._enable_rerank = s.enable_reranking
        self._rerank_top_k = s.rerank_top_k

    def retrieve(
        self,
        query: str,
        *,
        history: Optional[List[Dict[str, str]]] = None,
        top_k: Optional[int] = None,
        use_reranking: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Full retrieval pipeline.

        Returns:
            Dict with keys ``documents``, ``query_type``, ``k_used``,
            ``transformed_queries``.
        """
        # 1. Classify query type → adaptive K
        query_type = classify_query(query)
        effective_k = top_k or _K_BY_TYPE.get(query_type, self._default_k)
        effective_k = min(effective_k, self._store.total_chunks or effective_k)

        # 2. Transform query
        transformed = self._transformer.transform(query, history=history)
        queries = transformed["queries"]  # list of query strings

        # 3. Retrieve for every query variant
        all_hits: List[SearchHit] = []
        for q in queries:
            hits = self._store.search(q, top_k=effective_k)
            all_hits.extend(hits)

        # 4. Deduplicate
        seen_ids: set = set()
        unique_hits: List[SearchHit] = []
        for h in all_hits:
            cid = id(h.document)
            if cid not in seen_ids:
                seen_ids.add(cid)
                unique_hits.append(h)

        # Sort by score descending
        unique_hits.sort(key=lambda h: h.score, reverse=True)

        # 5. Re-rank (optional, graceful fallback)
        should_rerank = use_reranking if use_reranking is not None else self._enable_rerank
        docs = [h.document for h in unique_hits[:effective_k]]

        if should_rerank and docs:
            try:
                docs = self._reranker.rerank(
                    query=query, documents=docs, top_k=self._rerank_top_k
                )
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
        )

        return {
            "documents": docs,
            "query_type": query_type,
            "k_used": effective_k,
            "transformed_queries": queries,
        }