"""
Intelligent Chunking Strategies
================================

* **RecursiveChunker** — general-purpose text splitting.
* **SemanticChunker** — sentence-embedding breakpoint detection.
* **HierarchicalChunker** — section-aware splitting for scientific docs
  that preserves section title context in every chunk.
* **TabularPassthrough** — keeps tabular documents intact.
* **SmartChunker** — router that selects the best strategy per document.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from typing import List, Optional

import numpy as np
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ChunkingStrategy(ABC):
    @abstractmethod
    def chunk(self, documents: List[Document]) -> List[Document]:
        ...


# ── Recursive ─────────────────────────────────────────────────────────────


class RecursiveChunker(ChunkingStrategy):
    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        separators = s.chunk_separators.split("|")
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=s.chunk_size,
            chunk_overlap=s.chunk_overlap,
            separators=separators,
            length_function=len,
        )
        self._min_len = s.min_chunk_length

    def chunk(self, documents: List[Document]) -> List[Document]:
        chunks: List[Document] = []
        for doc in documents:
            splits = self._splitter.split_documents([doc])
            for i, s in enumerate(splits):
                if len(s.page_content.strip()) >= self._min_len:
                    s.metadata["chunk_index"] = i
                    chunks.append(s)
        return chunks


# ── Semantic ──────────────────────────────────────────────────────────────


class SemanticChunker(ChunkingStrategy):
    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        self._min_chunk = s.min_chunk_length
        self._max_chunk = s.chunk_size * 2
        self._model_name = s.embedding_model
        self._model = None

    def _get_model(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer
            name = self._model_name
            if name.startswith("models/"):
                name = "sentence-transformers/all-MiniLM-L6-v2"
            self._model = SentenceTransformer(name)
        return self._model

    def chunk(self, documents: List[Document]) -> List[Document]:
        chunks: List[Document] = []
        for doc in documents:
            text = doc.page_content
            if len(text) < self._min_chunk * 2:
                chunks.append(doc)
                continue
            try:
                segments = self._semantic_split(text)
            except Exception:
                segments = [text]
            for i, seg in enumerate(segments):
                if len(seg.strip()) >= self._min_chunk:
                    chunks.append(Document(
                        page_content=seg,
                        metadata={**doc.metadata, "chunk_index": i, "chunking": "semantic"},
                    ))
        return chunks

    def _semantic_split(self, text: str) -> List[str]:
        sentences = self._split_sentences(text)
        if len(sentences) <= 3:
            return [text]
        model = self._get_model()
        embeddings = model.encode(sentences, show_progress_bar=False, batch_size=128)
        sims: List[float] = []
        for i in range(len(embeddings) - 1):
            a, b = embeddings[i], embeddings[i + 1]
            cos = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-10))
            sims.append(cos)
        mean_sim, std_sim = float(np.mean(sims)), float(np.std(sims))
        threshold = max(0.25, mean_sim - std_sim)
        breakpoints = [i for i, s in enumerate(sims) if s < threshold]
        segments: List[str] = []
        start = 0
        for bp in breakpoints:
            seg = " ".join(sentences[start: bp + 1]).strip()
            if seg:
                segments.append(seg)
            start = bp + 1
        if start < len(sentences):
            seg = " ".join(sentences[start:]).strip()
            if seg:
                segments.append(seg)
        merged: List[str] = []
        buf = ""
        for seg in segments:
            if len(buf) + len(seg) < self._max_chunk:
                buf = (buf + " " + seg).strip()
            else:
                if buf:
                    merged.append(buf)
                buf = seg
        if buf:
            merged.append(buf)
        return merged if merged else [text]

    @staticmethod
    def _split_sentences(text: str) -> List[str]:
        raw = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
        return [s.strip() for s in raw if s.strip() and len(s.strip()) > 10]


# ── Hierarchical (section-aware) ──────────────────────────────────────────


class HierarchicalChunker(ChunkingStrategy):
    """Section-aware chunking for scientific documents.

    Keeps the section title as a prefix to every chunk so retrieval
    always knows the structural context.  Long sections are further
    split with ``RecursiveChunker``.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        self._recursive = RecursiveChunker(s)
        self._max_chunk = s.chunk_size

    def chunk(self, documents: List[Document]) -> List[Document]:
        chunks: List[Document] = []
        for doc in documents:
            section_title = doc.metadata.get("section_title", "")
            content = doc.page_content

            if len(content) <= self._max_chunk:
                chunks.append(doc)
                continue

            # Split long section content, prepend section title to each
            sub_docs = self._recursive.chunk([doc])
            for i, sd in enumerate(sub_docs):
                if section_title and not sd.page_content.startswith(section_title):
                    sd.page_content = f"[Section: {section_title}]\n{sd.page_content}"
                sd.metadata["section_title"] = section_title
                sd.metadata["chunk_index"] = i
                sd.metadata["chunking"] = "hierarchical"
                chunks.append(sd)

        return chunks


# ── Tabular passthrough ───────────────────────────────────────────────────


class TabularPassthrough(ChunkingStrategy):
    def chunk(self, documents: List[Document]) -> List[Document]:
        return documents


# ═══════════════════════════════════════════════════════════════════════════
#  SMART CHUNKER (router)
# ═══════════════════════════════════════════════════════════════════════════


class SmartChunker:
    """Routes each document to the best chunking strategy."""

    _PASSTHROUGH_TYPES = frozenset({
        "full_data", "rows", "row", "summary", "column",
        "array_item", "figure", "equation",
    })

    _HIERARCHICAL_TYPES = frozenset({"section"})

    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        self._semantic_enabled = s.enable_semantic_chunking
        self._chunk_size = s.chunk_size

        self._recursive = RecursiveChunker(s)
        self._semantic = SemanticChunker(s) if self._semantic_enabled else None
        self._hierarchical = HierarchicalChunker(s)
        self._passthrough = TabularPassthrough()

    def chunk(self, documents: List[Document]) -> List[Document]:
        passthrough: List[Document] = []
        hierarchical: List[Document] = []
        text_docs: List[Document] = []

        for doc in documents:
            doc_type = doc.metadata.get("document_type", "")
            if doc_type in self._PASSTHROUGH_TYPES:
                passthrough.append(doc)
            elif doc_type in self._HIERARCHICAL_TYPES:
                hierarchical.append(doc)
            elif len(doc.page_content) <= self._chunk_size:
                passthrough.append(doc)
            else:
                text_docs.append(doc)

        chunks = list(passthrough)

        if hierarchical:
            chunks.extend(self._hierarchical.chunk(hierarchical))

        if text_docs:
            if self._semantic is not None:
                try:
                    chunks.extend(self._semantic.chunk(text_docs))
                except Exception as exc:
                    logger.warning("semantic_chunking_failed", error=str(exc))
                    chunks.extend(self._recursive.chunk(text_docs))
            else:
                chunks.extend(self._recursive.chunk(text_docs))

        for i, c in enumerate(chunks):
            if "chunk_id" not in c.metadata:
                c.metadata["chunk_id"] = f"chunk_{i}"

        logger.info("chunking_complete", input_docs=len(documents), output_chunks=len(chunks))
        return chunks