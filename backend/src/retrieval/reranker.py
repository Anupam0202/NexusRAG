"""
Re-Ranking Pipeline
====================

1. **Cross-encoder** — fast local re-ranking via
   ``cross-encoder/ms-marco-MiniLM-L-6-v2``.
2. **LLM re-ranker** — asks the LLM to rank passages (fallback).
3. **NoOp** — passthrough when re-ranking is disabled.

``RerankerPipeline`` tries cross-encoder first, falls back to LLM,
and ultimately returns the original order on total failure (graceful
degradation).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional, Tuple

from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class BaseReranker(ABC):
    @abstractmethod
    def rerank(self, query: str, documents: List[Document], top_k: int) -> List[Document]:
        ...


# ── Cross-Encoder ─────────────────────────────────────────────────────────


class CrossEncoderReranker(BaseReranker):
    """Rerank using a cross-encoder model (runs locally, no API cost)."""

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2") -> None:
        self._model_name = model_name
        self._model = None

    def _load_model(self):
        if self._model is None:
            from sentence_transformers import CrossEncoder

            self._model = CrossEncoder(self._model_name)
            logger.info("cross_encoder_loaded", model=self._model_name)
        return self._model

    def rerank(self, query: str, documents: List[Document], top_k: int) -> List[Document]:
        model = self._load_model()
        pairs: List[Tuple[str, str]] = [
            (query, doc.page_content[:1000]) for doc in documents
        ]
        scores = model.predict(pairs)  # type: ignore

        scored = sorted(
            zip(documents, scores), key=lambda x: x[1], reverse=True
        )
        reranked = [doc for doc, _ in scored[:top_k]]
        logger.debug("cross_encoder_reranked", top_k=top_k, input=len(documents))
        return reranked


# ── LLM Reranker (fallback) ──────────────────────────────────────────────


class LLMReranker(BaseReranker):
    """Ask the LLM to rank passages by relevance (more expensive)."""

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._llm = None

    def _get_llm(self):
        if self._llm is None:
            from langchain_google_genai import ChatGoogleGenerativeAI

            s = self._settings
            self._llm = ChatGoogleGenerativeAI(
                model=s.llm_model_name,
                temperature=0.0,
                max_tokens=100,
                google_api_key=s.google_api_key,
            )
        return self._llm

    def rerank(self, query: str, documents: List[Document], top_k: int) -> List[Document]:
        import json
        import re as _re

        passages = "\n\n".join(
            f"[{i + 1}] {doc.page_content[:400]}" for i, doc in enumerate(documents[:15])
        )
        prompt = (
            f"Query: {query}\n\nPassages:\n{passages}\n\n"
            "Return a JSON list of passage numbers in order of relevance (most relevant first). "
            "Example: [3, 1, 5, 2, 4]"
        )
        try:
            resp = self._get_llm().invoke(prompt)
            text = resp.content if hasattr(resp, "content") else str(resp)
            match = _re.search(r"\[[\d,\s]+\]", text)
            if match:
                ranking = json.loads(match.group())
                reranked: List[Document] = []
                for idx in ranking:
                    if 1 <= idx <= len(documents):
                        reranked.append(documents[idx - 1])
                # Append any we missed
                for doc in documents:
                    if doc not in reranked:
                        reranked.append(doc)
                return reranked[:top_k]
        except Exception as exc:
            logger.warning("llm_reranking_failed", error=str(exc))

        return documents[:top_k]


# ═══════════════════════════════════════════════════════════════════════════
#  PIPELINE (cross-encoder → LLM → passthrough)
# ═══════════════════════════════════════════════════════════════════════════


class RerankerPipeline:
    """Try cross-encoder first, fall back to LLM, then passthrough.

    On memory-constrained platforms (detected via RENDER env var or
    DISABLE_CROSS_ENCODER=true), skips the ~80MB cross-encoder model
    AND the LLM reranker (which burns API quota) — uses score-based
    ordering from FAISS+BM25 hybrid search instead.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        import os

        s = settings or get_settings()
        # Skip cross-encoder on Render / low-memory platforms
        is_constrained = (
            os.environ.get("RENDER", "")
            or os.environ.get("DISABLE_CROSS_ENCODER", "").lower() == "true"
        )
        if is_constrained:
            logger.info("memory_constrained_mode — skipping cross-encoder and LLM reranker")
            self._cross_encoder: Optional[CrossEncoderReranker] = None
            # Also skip LLM reranker to save API quota on free tier
            self._llm_reranker: Optional[LLMReranker] = None
        else:
            self._cross_encoder = CrossEncoderReranker(s.rerank_model)
            self._llm_reranker = LLMReranker(s)

    def rerank(self, query: str, documents: List[Document], top_k: int) -> List[Document]:
        # Try cross-encoder (if available)
        if self._cross_encoder is not None:
            try:
                return self._cross_encoder.rerank(query, documents, top_k)
            except Exception as exc:
                logger.warning("cross_encoder_failed — trying LLM reranker", error=str(exc))

        # Try LLM reranker (if available)
        if self._llm_reranker is not None:
            try:
                return self._llm_reranker.rerank(query, documents, top_k)
            except Exception as exc:
                logger.warning("llm_reranker_failed — returning original order", error=str(exc))

        # Graceful fallback — use score-based ordering from hybrid search
        return documents[:top_k]