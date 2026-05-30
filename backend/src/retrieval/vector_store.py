"""
Vector Store Manager — FAISS + BM25 Hybrid
============================================

Fixed from Part 2:
  • Uses **actual FAISS index** (``IndexFlatIP``) instead of brute-force
  • Uses **content hashing** for dedup instead of ``id()``
  • Separate persistence for FAISS index and metadata
"""

from __future__ import annotations

import hashlib
import pickle
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import faiss
import numpy as np
from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.ingestion.embedder import Embedder, get_embedder
from src.utils.logger import get_logger

logger = get_logger(__name__)

try:
    from rank_bm25 import BM25Okapi

    _BM25_OK = True
except ImportError:
    _BM25_OK = False


@dataclass
class SearchHit:
    document: Document
    score: float
    method: str


class VectorStoreManager:
    """Hybrid FAISS + BM25 store with CRUD and persistence."""

    def __init__(self, settings: Settings | None = None) -> None:
        s = settings or get_settings()
        self._embedder: Embedder = get_embedder()
        self._persist_dir = s.vector_store_dir
        self._alpha = s.hybrid_search_alpha
        self._sim_threshold = s.similarity_threshold
        self._use_lightweight = s.use_lightweight_embeddings
        self._dim: int = 0

        self._documents: list[Document] = []
        self._raw_embeddings: list[np.ndarray] = []
        self._index: faiss.IndexFlatIP | None = None
        self._bm25: BM25Okapi | None = None
        self._lock = threading.Lock()

        self._load()

    # ══════════════════════════════════════════════════════════════════
    #  CRUD
    # ══════════════════════════════════════════════════════════════════

    def add_documents(self, documents: list[Document]) -> int:
        if not documents:
            return 0

        with self._lock:
            existing_ids = {self._doc_identity(d) for d in self._documents}
            incoming_ids: set[str] = set()
            documents_to_add: list[Document] = []
            for doc in documents:
                doc_id = self._doc_identity(doc)
                if doc_id in existing_ids or doc_id in incoming_ids:
                    continue
                incoming_ids.add(doc_id)
                documents_to_add.append(doc)

        if not documents_to_add:
            logger.info("documents_skipped_duplicates", requested=len(documents))
            return 0

        texts = [d.page_content for d in documents_to_add]
        embeddings = self._embedder.embed_texts(texts)
        vectors = np.array(embeddings, dtype="float32")
        faiss.normalize_L2(vectors)

        with self._lock:
            existing_ids = {self._doc_identity(d) for d in self._documents}
            filtered: list[tuple[Document, np.ndarray]] = [
                (doc, vec)
                for doc, vec in zip(documents_to_add, vectors)
                if self._doc_identity(doc) not in existing_ids
            ]
            if not filtered:
                logger.info("documents_skipped_duplicates", requested=len(documents))
                return 0

            documents_to_add = [item[0] for item in filtered]
            vectors = np.array([item[1] for item in filtered], dtype="float32")

            if self._dim == 0:
                self._dim = vectors.shape[1]
            if self._index is None:
                self._index = faiss.IndexFlatIP(self._dim)

            self._index.add(vectors)
            for doc, vec in zip(documents_to_add, vectors):
                self._documents.append(doc)
                self._raw_embeddings.append(vec)
            self._rebuild_bm25()
            self._save()

        logger.info("documents_added", count=len(documents_to_add), total=len(self._documents))
        return len(documents_to_add)

    def delete_by_filename(self, filename: str) -> int:
        with self._lock:
            before = len(self._documents)
            keep = [
                (d, e)
                for d, e in zip(self._documents, self._raw_embeddings)
                if d.metadata.get("filename") != filename
            ]
            if len(keep) == before:
                return 0
            self._documents = [k[0] for k in keep]
            self._raw_embeddings = [k[1] for k in keep]
            self._rebuild_index()
            self._rebuild_bm25()
            self._save()
        removed = before - len(self._documents)
        logger.info("documents_deleted", filename=filename, removed=removed)
        return removed

    def list_documents(self) -> list[dict[str, Any]]:
        summaries: dict[str, dict[str, Any]] = {}
        for doc in self._documents:
            metadata = doc.metadata
            filename = metadata.get("filename", "unknown")
            item = summaries.setdefault(
                filename,
                {
                    "filename": filename,
                    "chunk_count": 0,
                    "file_size_bytes": 0,
                    "file_type": "",
                    "page_count": 0,
                    "extraction_method": "",
                },
            )
            item["chunk_count"] += 1
            item["file_size_bytes"] = max(
                item["file_size_bytes"],
                int(metadata.get("file_size_bytes") or 0),
            )
            item["page_count"] = max(item["page_count"], int(metadata.get("page_count") or 0))
            if not item["file_type"]:
                item["file_type"] = (
                    metadata.get("file_type")
                    or str(metadata.get("file_extension", "")).lstrip(".")
                    or Path(filename).suffix.lower().lstrip(".")
                )
            if not item["extraction_method"]:
                item["extraction_method"] = metadata.get("extraction_method", "")
        return sorted(summaries.values(), key=lambda d: d["filename"].lower())

    @property
    def total_chunks(self) -> int:
        return len(self._documents)

    # ══════════════════════════════════════════════════════════════════
    #  SEARCH
    # ══════════════════════════════════════════════════════════════════

    def search(self, query: str, top_k: int = 10) -> list[SearchHit]:
        if not self._documents:
            return []
        dense = self._dense_search(query, top_k * 2)
        sparse = self._sparse_search(query, top_k * 2) if _BM25_OK else []
        if self._use_lightweight and sparse:
            return self._merge_sparse_first(sparse, dense, top_k)
        if not sparse:
            return dense[:top_k]
        return self._fuse(dense, sparse, top_k)

    def _dense_search(self, query: str, top_k: int) -> list[SearchHit]:
        if self._index is None or self._index.ntotal == 0:
            return []
        q_emb = np.array([self._embedder.embed_query(query)], dtype="float32")
        faiss.normalize_L2(q_emb)
        k = min(top_k, self._index.ntotal)
        scores, indices = self._index.search(q_emb, k)
        results: list[SearchHit] = []
        for score, idx in zip(scores[0], indices[0]):
            if idx >= 0 and score >= self._sim_threshold:
                results.append(
                    SearchHit(document=self._documents[idx], score=float(score), method="dense")
                )
        return results

    def _sparse_search(self, query: str, top_k: int) -> list[SearchHit]:
        if not self._bm25:
            return []
        tokens = self._tokenize(query)
        token_set = set(tokens)
        raw_scores = self._bm25.get_scores(tokens)
        top_idx = np.argsort(raw_scores)[::-1][:top_k]
        results: list[SearchHit] = []
        for i in top_idx:
            doc_tokens = set(self._tokenize(self._bm25_text(self._documents[i])))
            if raw_scores[i] > 0 or token_set.intersection(doc_tokens):
                results.append(
                    SearchHit(
                        document=self._documents[i],
                        score=max(float(raw_scores[i]), 0.001),
                        method="sparse",
                    )
                )
        return results

    def _fuse(self, dense: list[SearchHit], sparse: list[SearchHit], top_k: int) -> list[SearchHit]:
        rrf_k = 60
        rrf: dict[str, float] = {}
        doc_map: dict[str, SearchHit] = {}
        for rank, hit in enumerate(dense):
            key = self._doc_hash(hit.document)
            rrf[key] = rrf.get(key, 0) + 1 / (rrf_k + rank + 1)
            if key not in doc_map:
                doc_map[key] = hit
        for rank, hit in enumerate(sparse):
            key = self._doc_hash(hit.document)
            rrf[key] = rrf.get(key, 0) + 1 / (rrf_k + rank + 1)
            if key not in doc_map:
                doc_map[key] = hit
        sorted_keys = sorted(rrf, key=rrf.get, reverse=True)  # type: ignore[arg-type]
        return [
            SearchHit(document=doc_map[k].document, score=rrf[k], method="hybrid")
            for k in sorted_keys[:top_k]
        ]

    def _merge_sparse_first(
        self,
        sparse: list[SearchHit],
        dense: list[SearchHit],
        top_k: int,
    ) -> list[SearchHit]:
        top_sparse_score = max((hit.score for hit in sparse), default=0.0)
        if top_sparse_score > 0.01:
            min_sparse_score = top_sparse_score * 0.15
            sparse = [hit for hit in sparse if hit.score >= min_sparse_score]

        merged: list[SearchHit] = []
        seen: set[str] = set()
        for hit in [*sparse, *dense]:
            key = self._doc_hash(hit.document)
            if key in seen:
                continue
            seen.add(key)
            merged.append(hit)
            if len(merged) >= top_k:
                break
        return merged

    @staticmethod
    def _doc_hash(doc: Document) -> str:
        return VectorStoreManager._doc_identity(doc)

    @staticmethod
    def _doc_identity(doc: Document) -> str:
        filename = doc.metadata.get("filename", "")
        chunk_index = doc.metadata.get("chunk_index", "")
        digest = hashlib.sha256(doc.page_content.encode("utf-8", "ignore")).hexdigest()
        return f"{filename}:{chunk_index}:{digest}"

    # ══════════════════════════════════════════════════════════════════
    #  PERSISTENCE
    # ══════════════════════════════════════════════════════════════════

    def _rebuild_index(self) -> None:
        if not self._raw_embeddings:
            self._index = None
            return
        vectors = np.array(self._raw_embeddings, dtype="float32")
        self._dim = vectors.shape[1]
        self._index = faiss.IndexFlatIP(self._dim)
        self._index.add(vectors)

    def _rebuild_bm25(self) -> None:
        if not _BM25_OK or not self._documents:
            self._bm25 = None
            return
        tokenized = [self._tokenize(self._bm25_text(d)) for d in self._documents]
        self._bm25 = BM25Okapi(tokenized)

    def _save(self) -> None:
        try:
            meta_path = self._persist_dir / "store_meta.pkl"
            with open(meta_path, "wb") as f:
                pickle.dump(
                    {
                        "documents": self._documents,
                        "embeddings": self._raw_embeddings,
                    },
                    f,
                )
            if self._index is not None:
                idx_path = str(self._persist_dir / "faiss.index")
                faiss.write_index(self._index, idx_path)
            logger.debug("vector_store_saved", chunks=len(self._documents))
        except Exception as exc:
            logger.error("vector_store_save_failed", error=str(exc))

    def _load(self) -> None:
        meta_path = self._persist_dir / "store_meta.pkl"
        if not meta_path.exists():
            return
        try:
            with open(meta_path, "rb") as f:
                data = pickle.load(f)
            self._documents = data.get("documents", [])
            self._raw_embeddings = data.get("embeddings", [])
            idx_path = str(self._persist_dir / "faiss.index")
            if Path(idx_path).exists():
                self._index = faiss.read_index(idx_path)
                self._dim = self._index.d
            else:
                self._rebuild_index()
            self._rebuild_bm25()
            logger.info("vector_store_loaded", chunks=len(self._documents))
        except Exception as exc:
            logger.warning("vector_store_load_failed", error=str(exc))

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return re.sub(r"[^a-z0-9]+", " ", text.lower()).split()

    @staticmethod
    def _bm25_text(doc: Document) -> str:
        metadata = doc.metadata
        filename = str(metadata.get("filename", ""))
        file_type = str(metadata.get("file_type", ""))
        document_type = str(metadata.get("document_type", ""))
        return f"{filename} {file_type} {document_type}\n{doc.page_content}"
