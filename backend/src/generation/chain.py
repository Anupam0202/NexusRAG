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

import hashlib
import json
import re
import threading
import time
from collections import deque
from collections.abc import AsyncIterator
from datetime import date
from typing import Any

from langchain_core.documents import Document
from langchain_core.messages import HumanMessage, SystemMessage

from config.settings import Settings, get_settings
from src.generation.llm import get_llm_provider
from src.generation.memory import SessionMemoryStore
from src.generation.prompts import PromptManager
from src.retrieval.cache import SemanticCache
from src.retrieval.retriever import HybridRetriever, QueryType
from src.retrieval.vector_store import VectorStoreManager
from src.utils.helpers import truncate
from src.utils.layered_cache import get_layered_cache
from src.utils.logger import get_logger
from src.utils.security import InputSanitizer
from src.utils.tenant import normalize_workspace_id

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
        settings: Settings | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._vector_store = vector_store
        self._retriever = HybridRetriever(vector_store, settings=self._settings)
        self._llm = get_llm_provider()
        self._prompts = PromptManager()
        self._cache = SemanticCache(settings=self._settings)
        self._layer_cache = get_layered_cache()
        self._memory_store = SessionMemoryStore(ttl_seconds=7200)

        # In-memory query metrics (rolling window)
        self._metrics_lock = threading.Lock()
        self._response_times: deque[float] = deque(maxlen=1000)
        self._confidences: deque[float] = deque(maxlen=1000)
        self._daily_queries: dict[str, int] = {}

    # ══════════════════════════════════════════════════════════════════
    #  BLOCKING QUERY
    # ══════════════════════════════════════════════════════════════════

    def query(
        self,
        question: str,
        *,
        workspace_id: str | None = None,
        session_id: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        top_k: int | None = None,
        use_reranking: bool | None = None,
        retrieval_filters: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Full blocking RAG query → returns structured response dict."""
        t0 = time.perf_counter()
        safe_q = InputSanitizer.sanitize_for_prompt(question)
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        scoped_session_id = self._session_key(scoped_workspace_id, session_id)
        safe_filters = self._normalize_retrieval_filters(retrieval_filters)
        cache_namespace = self._retrieval_namespace(safe_filters)

        # Memory
        memory = self._memory_store.get(scoped_session_id)
        if conversation_history:
            for m in conversation_history:
                memory.add(m["role"], m["content"])

        # Cache
        cached = self._cache.get(
            safe_q,
            workspace_id=scoped_workspace_id,
            namespace=cache_namespace,
        )
        if cached is not None:
            logger.info("cache_hit")
            cached["response_time_seconds"] = round(time.perf_counter() - t0, 3)
            cached["from_cache"] = True
            return cached

        # Retrieve
        history_msgs = memory.get_context_messages()
        retrieval = self._retriever.retrieve(
            safe_q,
            workspace_id=scoped_workspace_id,
            history=history_msgs,
            top_k=top_k,
            use_reranking=use_reranking,
            filters=safe_filters,
        )
        docs: list[Document] = retrieval["documents"]
        query_type: QueryType = retrieval["query_type"]
        docs = self._with_inventory_context(
            safe_q,
            docs,
            workspace_id=scoped_workspace_id,
            retrieval_filters=safe_filters,
        )

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
        generation_fallback = False
        generation_error = ""
        try:
            answer = self._invoke_llm_messages(messages, workspace_id=scoped_workspace_id)
        except Exception as exc:
            generation_fallback = True
            generation_error = getattr(exc, "message", str(exc))
            logger.warning("generation_fallback_used", error=generation_error)
            answer = self._build_extractive_fallback_answer(docs, generation_error)

        # Update memory
        memory.add("user", question)
        memory.add("assistant", answer[:3000])

        # Build sources
        sources = self._build_sources(docs)
        confidence = self._estimate_confidence(docs, answer)
        quality = self._answer_quality_metadata(
            docs=docs,
            sources=sources,
            answer=answer,
            confidence=confidence,
            retrieval_filters=safe_filters,
            workspace_id=scoped_workspace_id,
        )

        result: dict[str, Any] = {
            "answer": answer,
            "sources": sources,
            "query_type": query_type.value,
            "confidence": confidence,
            "response_time_seconds": round(time.perf_counter() - t0, 3),
            "metadata": {
                "k_used": retrieval["k_used"],
                "transformed_queries": retrieval["transformed_queries"],
                "num_sources": len(docs),
                "model": self._model_name_safe(scoped_workspace_id),
                "generation_fallback": generation_fallback,
                "generation_error": generation_error,
                "workspace_id": scoped_workspace_id,
                "retrieval_filters": safe_filters,
                "cache_namespace": cache_namespace,
                **quality,
            },
        }

        # Cache
        self._cache.set(
            safe_q,
            result,
            workspace_id=scoped_workspace_id,
            namespace=cache_namespace,
        )

        # Track metrics
        self._record_metric(
            float(result["response_time_seconds"]),
            float(result["confidence"]),
        )

        logger.info(
            "query_complete",
            query_type=query_type.value,
            sources=len(docs),
            time_s=result["response_time_seconds"],
            workspace_id=scoped_workspace_id,
        )
        return result

    def answer_from_documents(
        self,
        question: str,
        documents: list[Document],
        *,
        workspace_id: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        retrieval_filters: dict[str, Any] | None = None,
        query_type: str | QueryType = QueryType.SPECIFIC,
        transformed_queries: list[str] | None = None,
        k_used: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate an answer from a trusted, caller-supplied document set."""
        t0 = time.perf_counter()
        safe_q = InputSanitizer.sanitize_for_prompt(question)
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        safe_filters = self._normalize_retrieval_filters(retrieval_filters)
        safe_docs = self._with_inventory_context(
            safe_q,
            documents,
            workspace_id=scoped_workspace_id,
            retrieval_filters=safe_filters,
        )

        history_lines: list[str] = []
        for item in conversation_history or []:
            role = str(item.get("role") or "").strip().lower()
            content = InputSanitizer.sanitize_for_prompt(str(item.get("content") or ""))
            if role in {"user", "assistant"} and content:
                history_lines.append(f"{role}: {content[:2000]}")
        history_str = "\n".join(history_lines[-20:]) or "No previous conversation."
        user_prompt = self._prompts.render_rag(
            context=self._format_context(safe_docs),
            history=history_str,
            question=safe_q,
        )
        messages = [
            SystemMessage(content=self._prompts.render_system()),
            HumanMessage(content=user_prompt),
        ]

        generation_fallback = False
        generation_error = ""
        try:
            answer = self._invoke_llm_messages(messages, workspace_id=scoped_workspace_id)
        except Exception as exc:
            generation_fallback = True
            generation_error = getattr(exc, "message", str(exc))
            logger.warning(
                "durable_document_generation_fallback_used",
                error=generation_error,
            )
            answer = self._build_extractive_fallback_answer(safe_docs, generation_error)

        sources = self._build_sources(safe_docs)
        confidence = self._estimate_confidence(safe_docs, answer)
        quality = self._answer_quality_metadata(
            docs=safe_docs,
            sources=sources,
            answer=answer,
            confidence=confidence,
            retrieval_filters=safe_filters,
            workspace_id=scoped_workspace_id,
        )
        try:
            query_type_value = (
                query_type.value
                if isinstance(query_type, QueryType)
                else QueryType(str(query_type)).value
            )
        except ValueError:
            query_type_value = QueryType.SPECIFIC.value

        result: dict[str, Any] = {
            "answer": answer,
            "sources": sources,
            "query_type": query_type_value,
            "confidence": confidence,
            "response_time_seconds": round(time.perf_counter() - t0, 3),
            "metadata": {
                **dict(metadata or {}),
                "k_used": k_used or len(safe_docs),
                "transformed_queries": transformed_queries or [safe_q],
                "num_sources": len(safe_docs),
                "model": self._model_name_safe(scoped_workspace_id),
                "generation_fallback": generation_fallback,
                "generation_error": generation_error,
                "workspace_id": scoped_workspace_id,
                "retrieval_filters": safe_filters,
                **quality,
            },
        }
        self._record_metric(
            float(result["response_time_seconds"]),
            float(result["confidence"]),
        )
        logger.info(
            "durable_document_answer_complete",
            query_type=query_type_value,
            sources=len(safe_docs),
            time_s=result["response_time_seconds"],
            workspace_id=scoped_workspace_id,
        )
        return result

    # ══════════════════════════════════════════════════════════════════
    #  STREAMING QUERY (for WebSocket)
    # ══════════════════════════════════════════════════════════════════

    async def stream(
        self,
        question: str,
        *,
        workspace_id: str | None = None,
        session_id: str | None = None,
        conversation_history: list[dict[str, str]] | None = None,
        top_k: int | None = None,
        use_reranking: bool | None = None,
        retrieval_filters: dict[str, Any] | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        """Async streaming RAG query — yields dicts suitable for WebSocket.

        Yields:
            ``{"type": "token", "content": "..."}``  — text deltas
            ``{"type": "sources", "sources": [...]}`` — source chunks
            ``{"type": "done", "metadata": {...}}``   — final metadata
        """
        t0 = time.perf_counter()
        safe_q = InputSanitizer.sanitize_for_prompt(question)
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        scoped_session_id = self._session_key(scoped_workspace_id, session_id)
        safe_filters = self._normalize_retrieval_filters(retrieval_filters)
        cache_namespace = self._retrieval_namespace(safe_filters)

        memory = self._memory_store.get(scoped_session_id)
        if conversation_history:
            for m in conversation_history:
                memory.add(m["role"], m["content"])

        # Cache check
        cached = self._cache.get(
            safe_q,
            workspace_id=scoped_workspace_id,
            namespace=cache_namespace,
        )
        if cached is not None:
            yield {"type": "token", "content": cached["answer"]}
            yield {"type": "sources", "sources": cached.get("sources", [])}
            yield {"type": "done", "metadata": {**cached.get("metadata", {}), "from_cache": True}}
            return

        # Retrieve
        history_msgs = memory.get_context_messages()
        retrieval = self._retriever.retrieve(
            safe_q,
            workspace_id=scoped_workspace_id,
            history=history_msgs,
            top_k=top_k,
            use_reranking=use_reranking,
            filters=safe_filters,
        )
        docs = retrieval["documents"]
        query_type: QueryType = retrieval["query_type"]
        docs = self._with_inventory_context(
            safe_q,
            docs,
            workspace_id=scoped_workspace_id,
            retrieval_filters=safe_filters,
        )

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
        generation_fallback = False
        generation_error = ""
        try:
            async for token in self._stream_llm_messages(
                messages, workspace_id=scoped_workspace_id
            ):
                full_answer += token
                yield {"type": "token", "content": token}
        except Exception as exc:
            generation_fallback = True
            generation_error = getattr(exc, "message", str(exc))
            logger.warning("stream_generation_fallback_used", error=generation_error)
            full_answer = self._build_extractive_fallback_answer(docs, generation_error)
            yield {"type": "token", "content": full_answer}

        # Memory
        memory.add("user", question)
        memory.add("assistant", full_answer[:3000])

        # Sources
        sources = self._build_sources(docs)
        yield {"type": "sources", "sources": sources}

        elapsed = round(time.perf_counter() - t0, 3)
        confidence = self._estimate_confidence(docs, full_answer)
        quality = self._answer_quality_metadata(
            docs=docs,
            sources=sources,
            answer=full_answer,
            confidence=confidence,
            retrieval_filters=safe_filters,
            workspace_id=scoped_workspace_id,
        )
        metadata = {
            "query_type": query_type.value,
            "k_used": retrieval["k_used"],
            "num_sources": len(docs),
            "response_time_seconds": elapsed,
            "model": self._model_name_safe(scoped_workspace_id),
            "confidence": confidence,
            "generation_fallback": generation_fallback,
            "generation_error": generation_error,
            "workspace_id": scoped_workspace_id,
            "retrieval_filters": safe_filters,
            "cache_namespace": cache_namespace,
            **quality,
        }
        yield {"type": "done", "metadata": metadata}

        # Track metrics
        self._record_metric(elapsed, metadata["confidence"])

        # Cache
        self._cache.set(
            safe_q,
            {
                "answer": full_answer,
                "sources": sources,
                "metadata": metadata,
            },
            workspace_id=scoped_workspace_id,
            namespace=cache_namespace,
        )

    # ══════════════════════════════════════════════════════════════════
    #  HELPERS
    # ══════════════════════════════════════════════════════════════════

    @staticmethod
    def _format_context(docs: list[Document]) -> str:
        parts: list[str] = []
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
    def _build_sources(docs: list[Document]) -> list[dict[str, Any]]:
        sources: list[dict[str, Any]] = []
        for doc in docs:
            sources.append(
                {
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
                }
            )
        return sources

    @staticmethod
    def _is_document_inventory_query(question: str) -> bool:
        q = question.lower()
        has_document_noun = any(
            term in q
            for term in (
                "file",
                "files",
                "document",
                "documents",
                "filename",
                "filenames",
                "source",
                "sources",
                "uploaded",
                "available",
                "indexed",
            )
        )
        has_inventory_intent = any(
            term in q
            for term in (
                "which",
                "what",
                "list",
                "show",
                "display",
                "available",
                "uploaded",
                "indexed",
                "source filenames",
            )
        )
        return has_document_noun and has_inventory_intent

    def _with_inventory_context(
        self,
        question: str,
        docs: list[Document],
        *,
        workspace_id: str,
        retrieval_filters: dict[str, Any] | None = None,
    ) -> list[Document]:
        if not self._is_document_inventory_query(question):
            return docs

        try:
            try:
                documents = self._vector_store.list_documents(workspace_id=workspace_id)
            except TypeError:
                documents = self._vector_store.list_documents()
        except Exception as exc:
            logger.warning("document_inventory_unavailable", error=str(exc))
            return docs

        if not documents:
            return docs
        filters = self._normalize_retrieval_filters(retrieval_filters)
        document_ids = set(filters.get("document_ids") or [])
        filename = filters.get("filename")
        if document_ids or filename:
            documents = [
                item
                for item in documents
                if (
                    not document_ids
                    or str(item.get("document_id") or item.get("id") or "") in document_ids
                )
                and (not filename or str(item.get("filename") or "") == filename)
            ]
        if not documents:
            return docs

        lines = ["Uploaded document library:"]
        for item in sorted(documents, key=lambda d: str(d.get("filename", "")).lower()):
            filename = item.get("filename", "Unknown")
            file_type = item.get("file_type") or "unknown"
            chunks = item.get("chunk_count", 0)
            pages = item.get("page_count", 0)
            size = item.get("file_size_bytes", 0)
            lines.append(
                f"- {filename} ({file_type}; {chunks} chunks; {pages} pages; {size} bytes)"
            )

        inventory = Document(
            page_content="\n".join(lines),
            metadata={
                "filename": "NexusRAG Document Library",
                "document_type": "document_inventory",
                "score": 1.0,
                "workspace_id": workspace_id,
            },
        )
        return [inventory, *docs]

    @classmethod
    def _normalize_retrieval_filters(cls, filters: dict[str, Any] | None) -> dict[str, Any]:
        if not filters:
            return {}
        normalized: dict[str, Any] = {}
        raw_ids = filters.get("document_ids")
        if raw_ids is None and filters.get("document_id"):
            raw_ids = [filters.get("document_id")]
        if raw_ids is not None:
            values = [
                str(item).strip()
                for item in (raw_ids if isinstance(raw_ids, list) else [raw_ids])
                if str(item).strip()
            ]
            if values:
                normalized["document_ids"] = sorted(set(values))
        filename = str(filters.get("filename") or "").strip()
        if filename:
            normalized["filename"] = filename
        raw_file_types = filters.get("file_types") or []
        file_types = [
            str(item).strip().lower().lstrip(".")
            for item in raw_file_types
            if str(item).strip()
        ]
        if file_types:
            normalized["file_types"] = sorted(set(file_types))
        uploaded_by = str(filters.get("uploaded_by") or "").strip()
        if uploaded_by:
            normalized["uploaded_by"] = uploaded_by
        for key in ("uploaded_after_epoch", "uploaded_before_epoch"):
            try:
                if filters.get(key) is not None:
                    normalized[key] = int(filters[key])
            except (TypeError, ValueError):
                continue
        raw_metadata = filters.get("metadata")
        if isinstance(raw_metadata, dict):
            metadata_filters = {
                str(key): value
                for key, value in raw_metadata.items()
                if re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", str(key))
            }
            if metadata_filters:
                normalized["metadata"] = metadata_filters
        for key in ("min_page", "max_page"):
            try:
                if filters.get(key) is not None:
                    normalized[key] = int(filters[key])
            except (TypeError, ValueError):
                continue
        return normalized

    @classmethod
    def _retrieval_namespace(cls, filters: dict[str, Any] | None) -> str:
        normalized = cls._normalize_retrieval_filters(filters)
        if not normalized:
            return "workspace"
        return "filtered:" + json.dumps(normalized, sort_keys=True, separators=(",", ":"))

    def _answer_quality_metadata(
        self,
        *,
        docs: list[Document],
        sources: list[dict[str, Any]],
        answer: str,
        confidence: float,
        retrieval_filters: dict[str, Any],
        workspace_id: str,
    ) -> dict[str, Any]:
        selected_ids = list(retrieval_filters.get("document_ids") or [])
        retrieval_scope = (
            "documents" if selected_ids or retrieval_filters.get("filename") else "workspace"
        )
        citation_coverage = round(len(sources) / len(docs), 3) if docs else 0.0
        quote_checks = self._source_quote_checks(
            answer=answer,
            docs=docs,
            workspace_id=workspace_id,
        )
        if not docs:
            answerability = "no_sources"
        elif confidence < 0.35:
            answerability = "low_confidence"
        else:
            answerability = "answerable"
        return {
            "retrieval_scope": retrieval_scope,
            "selected_document_ids": selected_ids,
            "answerability": answerability,
            "low_confidence": answerability != "answerable",
            "citation_coverage": min(1.0, citation_coverage),
            "source_quote_coverage": quote_checks["coverage"],
            "verified_source_quotes": quote_checks["verified_quotes"],
        }

    def _source_quote_checks(
        self,
        *,
        answer: str,
        docs: list[Document],
        workspace_id: str,
    ) -> dict[str, Any]:
        payload = {
            "answer": answer,
            "documents": [
                {
                    "content": doc.page_content,
                    "filename": doc.metadata.get("filename"),
                    "page_number": doc.metadata.get("page_number"),
                }
                for doc in docs[:5]
            ],
        }
        cache_key = hashlib.sha256(
            json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode()
        ).hexdigest()
        cached = self._layer_cache.get(
            "source_verification",
            cache_key,
            workspace_id=workspace_id,
        )
        if cached is not None:
            return cached

        answer_words = RAGChain._normalized_words(answer)
        answer_text = " ".join(answer_words)
        if not answer_text:
            return {"coverage": 0.0, "verified_quotes": []}

        checked = 0
        verified: list[dict[str, Any]] = []
        for doc in docs[:5]:
            words = RAGChain._normalized_words(doc.page_content)
            if len(words) < 5:
                continue
            checked += 1
            window = 6 if len(words) >= 6 else len(words)
            max_start = min(len(words) - window + 1, 80)
            for start in range(max_start):
                phrase = " ".join(words[start : start + window])
                if phrase and phrase in answer_text:
                    verified.append(
                        {
                            "filename": doc.metadata.get("filename", "Unknown"),
                            "page_number": doc.metadata.get("page_number", 0),
                            "quote": phrase,
                        }
                    )
                    break
        result = {
            "coverage": round(len(verified) / checked, 3) if checked else 0.0,
            "verified_quotes": verified[:5],
        }
        if self._settings.enable_cache:
            self._layer_cache.set(
                "source_verification",
                cache_key,
                result,
                workspace_id=workspace_id,
            )
        return result

    @staticmethod
    def _normalized_words(text: str) -> list[str]:
        return re.findall(r"[a-z0-9]+", text.lower())

    @staticmethod
    def _build_extractive_fallback_answer(docs: list[Document], _error: str) -> str:
        if not docs:
            return (
                "The language model is temporarily unavailable and no relevant document "
                "context was retrieved. Please try again after the provider quota resets."
            )

        parts = [
            "The language model is temporarily unavailable, so I am returning the most "
            "relevant retrieved document excerpts instead.",
            "",
        ]
        for index, doc in enumerate(docs[:5], 1):
            filename = doc.metadata.get("filename", "Unknown")
            page = doc.metadata.get("page_number") or doc.metadata.get("page") or ""
            page_label = f", page {page}" if page else ""
            parts.append(f"{index}. {filename}{page_label}")
            parts.append(truncate(doc.page_content, 700))
            parts.append("")
        return "\n".join(parts).strip()

    @staticmethod
    def _answer_indicates_insufficient_context(answer: str) -> bool:
        text = answer.lower()
        return any(
            phrase in text
            for phrase in (
                "don't have enough information",
                "do not have enough information",
                "not enough information",
                "insufficient information",
                "insufficient context",
                "no relevant context",
                "no context",
                "not provided in the context",
                "not found in the provided",
                "cannot determine",
                "can't determine",
                "unable to determine",
            )
        )

    def _invoke_llm_messages(self, messages: list, *, workspace_id: str) -> str:
        try:
            return self._llm.invoke_messages(messages, workspace_id=workspace_id)
        except TypeError as exc:
            if "workspace_id" not in str(exc):
                raise
            return self._llm.invoke_messages(messages)

    async def _stream_llm_messages(self, messages: list, *, workspace_id: str):
        try:
            async for token in self._llm.stream_messages(messages, workspace_id=workspace_id):
                yield token
        except TypeError as exc:
            if "workspace_id" not in str(exc):
                raise
            async for token in self._llm.stream_messages(messages):
                yield token

    def _model_name_safe(self, workspace_id: str | None = None) -> str:
        current_model_name = getattr(self._llm, "current_model_name", None)
        if callable(current_model_name):
            return current_model_name(workspace_id=workspace_id)
        return getattr(self._llm, "_model_name", "") or self._settings.llm_model_name

    @staticmethod
    def _estimate_confidence(docs: list[Document], answer: str) -> float:
        """Estimate response confidence using actual retrieval scores."""
        if not docs:
            return 0.1

        # Use actual relevance scores from retrieval
        scores = [doc.metadata.get("score", 0.0) for doc in docs]
        valid_scores = [s for s in scores if s > 0]

        if valid_scores:
            top_score = max(valid_scores)
            avg_score = sum(valid_scores) / len(valid_scores)
            score_component = 0.6 * top_score + 0.4 * avg_score
        else:
            score_component = min(0.3 + len(docs) * 0.05, 0.6)

        if RAGChain._answer_indicates_insufficient_context(answer):
            return round(min(score_component, 0.3), 3)

        # Answer quality signals
        answer_bonus = 0.0
        if len(answer) > 200:
            answer_bonus += 0.05
        if len(answer) > 50 and not answer.lower().startswith("i don't"):
            answer_bonus += 0.05

        confidence = min(score_component + answer_bonus, 0.95)
        return round(max(confidence, 0.1), 3)

    # ── Session management ────────────────────────────────────────────

    @staticmethod
    def _session_key(workspace_id: str | None, session_id: str | None) -> str:
        return f"{normalize_workspace_id(workspace_id)}:{session_id or 'default'}"

    def clear_session(self, session_id: str, *, workspace_id: str | None = None) -> None:
        self._memory_store.delete(self._session_key(workspace_id, session_id))

    def clear_cache(self, *, workspace_id: str | None = None) -> None:
        self._cache.clear(workspace_id=workspace_id)
        self._layer_cache.invalidate(
            workspace_id=workspace_id,
            layers={"source_verification"},
        )
        clear_retrieval_cache = getattr(self._retriever, "clear_cache", None)
        if callable(clear_retrieval_cache):
            clear_retrieval_cache(workspace_id=workspace_id)

    def get_session_history(
        self,
        session_id: str,
        *,
        workspace_id: str | None = None,
    ) -> list[dict[str, Any]]:
        memory = self._memory_store.get(self._session_key(workspace_id, session_id))
        return memory.get_full_history()

    @property
    def cache_stats(self) -> dict[str, Any]:
        return self._cache.stats

    @property
    def llm(self) -> Any:
        return self._llm

    def _record_metric(self, response_time: float, confidence: float) -> None:
        """Record query metrics for analytics."""
        with self._metrics_lock:
            self._response_times.append(response_time)
            self._confidences.append(confidence)
            today = date.today().isoformat()
            self._daily_queries[today] = self._daily_queries.get(today, 0) + 1

    @property
    def query_metrics(self) -> dict[str, Any]:
        """Aggregate metrics for the analytics endpoint."""
        with self._metrics_lock:
            rt_list = list(self._response_times)
            cf_list = list(self._confidences)
            today = date.today().isoformat()
            queries_today = self._daily_queries.get(today, 0)
        return {
            "avg_response_time": round(sum(rt_list) / len(rt_list), 3) if rt_list else 0.0,
            "avg_confidence": round(sum(cf_list) / len(cf_list), 3) if cf_list else 0.0,
            "total_queries": len(rt_list),
            "queries_today": queries_today,
        }
