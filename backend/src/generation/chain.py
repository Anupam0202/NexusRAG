"""
RAG Chain Orchestrator
=======================

The ``RAGChain`` is the **top-level entry point** for the entire
query-answering pipeline.  It wires together:

  Query → Cache check → Retrieve → Build prompt → Stream LLM → Update memory → Cache set

Both a blocking ``query()`` and a streaming ``stream()`` interface are
provided.  The streaming path is used by the WebSocket endpoint.
"""

from __future__ import annotations

import time
from typing import Any, AsyncIterator, Dict, List, Optional

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage, SystemMessage

from config.settings import Settings, get_settings
from src.generation.llm import LLMProvider, get_llm_provider
from src.generation.memory import ConversationMemory, SessionMemoryStore
from src.generation.prompts import PromptManager
from src.retrieval.cache import SemanticCache
from src.retrieval.retriever import HybridRetriever, QueryType
from src.retrieval.vector_store import VectorStoreManager
from src.utils.helpers import truncate
from src.utils.logger import get_logger
from src.utils.security import InputSanitizer

logger = get_logger(__name__)


class RAGChain:
    """Full RAG pipeline: retrieval → generation with streaming support.

    Usage::

        chain = RAGChain(vector_store=vs)

        # Blocking
        result = chain.query("What is…?", session_id="abc")

        # Streaming (for WebSocket)
        async for token in chain.stream("What is…?", session_id="abc"):
            send(token)
    """

    def __init__(
        self,
        vector_store: VectorStoreManager,
        settings: Optional[Settings] = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._retriever = HybridRetriever(vector_store, settings=self._settings)
        self._llm = get_llm_provider()
        self._prompts = PromptManager()
        self._cache = SemanticCache(settings=self._settings)
        self._memory_store = SessionMemoryStore(ttl_seconds=7200)

    # ══════════════════════════════════════════════════════════════════
    #  BLOCKING QUERY
    # ══════════════════════════════════════════════════════════════════

    def query(
        self,
        question: str,
        *,
        session_id: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        top_k: Optional[int] = None,
        use_reranking: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Full blocking RAG query → returns structured response dict."""
        t0 = time.perf_counter()
        safe_q = InputSanitizer.sanitize_for_prompt(question)

        # Memory
        memory = self._memory_store.get(session_id or "default")
        if conversation_history:
            for m in conversation_history:
                memory.add(m["role"], m["content"])

        # Cache
        cached = self._cache.get(safe_q)
        if cached is not None:
            logger.info("cache_hit")
            cached["response_time_seconds"] = round(time.perf_counter() - t0, 3)
            cached["from_cache"] = True
            return cached

        # Retrieve
        history_msgs = memory.get_context_messages()
        retrieval = self._retriever.retrieve(
            safe_q, history=history_msgs, top_k=top_k, use_reranking=use_reranking
        )
        docs: List[Document] = retrieval["documents"]
        query_type: QueryType = retrieval["query_type"]

        # Build prompt
        context_str = self._format_context(docs)
        history_str = memory.get_formatted_history()
        user_prompt = self._prompts.render_rag(
            context=context_str, history=history_str, question=safe_q
        )

        messages = [
            SystemMessage(content=self._prompts.render_system()),
            HumanMessage(content=user_prompt),
        ]

        # Generate
        answer = self._llm.invoke_messages(messages)

        # Update memory
        memory.add("user", question)
        memory.add("assistant", answer[:3000])

        # Build sources
        sources = self._build_sources(docs)

        result = {
            "answer": answer,
            "sources": sources,
            "query_type": query_type.value,
            "confidence": self._estimate_confidence(docs, answer),
            "response_time_seconds": round(time.perf_counter() - t0, 3),
            "metadata": {
                "k_used": retrieval["k_used"],
                "transformed_queries": retrieval["transformed_queries"],
                "num_sources": len(docs),
                "model": self._llm.model_name,
            },
        }

        # Cache
        self._cache.set(safe_q, result)

        logger.info(
            "query_complete",
            query_type=query_type.value,
            sources=len(docs),
            time_s=result["response_time_seconds"],
        )
        return result

    # ══════════════════════════════════════════════════════════════════
    #  STREAMING QUERY (for WebSocket)
    # ══════════════════════════════════════════════════════════════════

    async def stream(
        self,
        question: str,
        *,
        session_id: Optional[str] = None,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        top_k: Optional[int] = None,
        use_reranking: Optional[bool] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Async streaming RAG query — yields dicts suitable for WebSocket.

        Yields:
            ``{"type": "token", "content": "..."}``  — text deltas
            ``{"type": "sources", "sources": [...]}`` — source chunks
            ``{"type": "done", "metadata": {...}}``   — final metadata
        """
        t0 = time.perf_counter()
        safe_q = InputSanitizer.sanitize_for_prompt(question)

        memory = self._memory_store.get(session_id or "default")
        if conversation_history:
            for m in conversation_history:
                memory.add(m["role"], m["content"])

        # Cache check
        cached = self._cache.get(safe_q)
        if cached is not None:
            yield {"type": "token", "content": cached["answer"]}
            yield {"type": "sources", "sources": cached.get("sources", [])}
            yield {"type": "done", "metadata": {**cached.get("metadata", {}), "from_cache": True}}
            return

        # Retrieve
        history_msgs = memory.get_context_messages()
        retrieval = self._retriever.retrieve(
            safe_q, history=history_msgs, top_k=top_k, use_reranking=use_reranking
        )
        docs = retrieval["documents"]
        query_type: QueryType = retrieval["query_type"]

        # Build prompt
        context_str = self._format_context(docs)
        history_str = memory.get_formatted_history()
        user_prompt = self._prompts.render_rag(
            context=context_str, history=history_str, question=safe_q
        )
        messages = [
            SystemMessage(content=self._prompts.render_system()),
            HumanMessage(content=user_prompt),
        ]

        # Stream generation
        full_answer = ""
        async for token in self._llm.stream_messages(messages):
            full_answer += token
            yield {"type": "token", "content": token}

        # Memory
        memory.add("user", question)
        memory.add("assistant", full_answer[:3000])

        # Sources
        sources = self._build_sources(docs)
        yield {"type": "sources", "sources": sources}

        elapsed = round(time.perf_counter() - t0, 3)
        metadata = {
            "query_type": query_type.value,
            "k_used": retrieval["k_used"],
            "num_sources": len(docs),
            "response_time_seconds": elapsed,
            "model": self._llm.model_name,
            "confidence": self._estimate_confidence(docs, full_answer),
        }
        yield {"type": "done", "metadata": metadata}

        # Cache
        self._cache.set(safe_q, {
            "answer": full_answer,
            "sources": sources,
            "metadata": metadata,
        })

    # ══════════════════════════════════════════════════════════════════
    #  HELPERS
    # ══════════════════════════════════════════════════════════════════

    @staticmethod
    def _format_context(docs: List[Document]) -> str:
        parts: List[str] = []
        for i, doc in enumerate(docs, 1):
            src = doc.metadata.get("filename", "Unknown")
            page = doc.metadata.get("page_number", "")
            doc_type = doc.metadata.get("document_type", "document")
            header = f"[Source {i}: {src}"
            if page:
                header += f" | Page {page}"
            header += f" ({doc_type})]"
            parts.append(header)
            parts.append(doc.page_content)
            parts.append("")
        return "\n".join(parts)

    @staticmethod
    def _build_sources(docs: List[Document]) -> List[Dict[str, Any]]:
        sources: List[Dict[str, Any]] = []
        for doc in docs:
            sources.append({
                "content": truncate(doc.page_content, 500),
                "filename": doc.metadata.get("filename", "Unknown"),
                "page_number": doc.metadata.get("page_number", 0),
                "chunk_index": doc.metadata.get("chunk_index", 0),
                "document_type": doc.metadata.get("document_type", ""),
                "relevance_score": doc.metadata.get("score", 0.0),
                "metadata": {
                    k: v
                    for k, v in doc.metadata.items()
                    if k not in ("source", "filename", "page_number", "chunk_index")
                },
            })
        return sources

    @staticmethod
    def _estimate_confidence(docs: List[Document], answer: str) -> float:
        if not docs:
            return 0.1
        base = min(0.5 + len(docs) * 0.05, 0.85)
        if len(answer) > 200:
            base = min(base + 0.05, 0.95)
        if "[Source" in answer:
            base = min(base + 0.05, 0.95)
        return round(base, 3)

    # ── Session management ────────────────────────────────────────────

    def clear_session(self, session_id: str) -> None:
        self._memory_store.delete(session_id)

    def get_session_history(self, session_id: str) -> List[Dict[str, Any]]:
        memory = self._memory_store.get(session_id)
        return memory.get_full_history()

    @property
    def cache_stats(self) -> Dict[str, Any]:
        return self._cache.stats