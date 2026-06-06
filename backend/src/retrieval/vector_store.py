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
from src.utils.tenant import normalize_workspace_id
from src.vectorstores.qdrant_store import QdrantVectorStore

logger = get_logger(__name__)

_SEARCH_STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "is",
    "it",
    "name",
    "of",
    "on",
    "or",
    "the",
    "to",
    "what",
    "which",
    "with",
}

_SEARCH_NOISE_TERMS = {
    "file",
    "files",
    "filename",
    "filenames",
    "source",
    "sources",
    "uploaded",
    "upload",
}

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
        self._settings = s
        self._embedder: Embedder = get_embedder()
        self._persist_dir = s.vector_store_dir
        self._alpha = s.hybrid_search_alpha
        self._sim_threshold = s.similarity_threshold
        self._use_lightweight = s.use_lightweight_embeddings
        self._qdrant = QdrantVectorStore(s) if s.qdrant_configured else None
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

    def add_documents(
        self,
        documents: list[Document],
        *,
        workspace_id: str | None = None,
        document_id: str | None = None,
    ) -> int:
        if not documents:
            return 0
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        for doc in documents:
            if workspace_id is not None:
                doc.metadata["workspace_id"] = scoped_workspace_id
            else:
                doc.metadata.setdefault("workspace_id", scoped_workspace_id)
            if document_id:
                doc.metadata["document_id"] = document_id

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

    def delete_by_filename(self, filename: str, *, workspace_id: str | None = None) -> int:
        return self.delete_by_identifier(filename, workspace_id=workspace_id)

    def delete_by_identifier(self, identifier: str, *, workspace_id: str | None = None) -> int:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        target = str(identifier)

        def matches(doc: Document) -> bool:
            return self._doc_workspace_id(doc) == scoped_workspace_id and target in {
                str(doc.metadata.get("document_id") or ""),
                str(doc.metadata.get("filename") or ""),
            }

        with self._lock:
            before = len(self._documents)
            keep = [
                (d, e)
                for d, e in zip(self._documents, self._raw_embeddings)
                if not matches(d)
            ]
            if len(keep) == before:
                return 0
            self._documents = [k[0] for k in keep]
            self._raw_embeddings = [k[1] for k in keep]
            self._rebuild_index()
            self._rebuild_bm25()
            self._save()
        removed = before - len(self._documents)
        logger.info(
            "documents_deleted",
            identifier=target,
            workspace_id=scoped_workspace_id,
            removed=removed,
        )
        return removed

    def list_documents(self, *, workspace_id: str | None = None) -> list[dict[str, Any]]:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        summaries: dict[str, dict[str, Any]] = {}
        for doc in self._documents:
            if self._doc_workspace_id(doc) != scoped_workspace_id:
                continue
            metadata = doc.metadata
            filename = metadata.get("filename", "unknown")
            document_id = str(metadata.get("document_id") or filename)
            item = summaries.setdefault(
                document_id,
                {
                    "filename": filename,
                    "document_id": document_id,
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

    def list_document_chunks(
        self,
        document_id: str,
        *,
        workspace_id: str | None = None,
        search: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Return bounded chunk previews for one workspace document."""
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        safe_limit = max(1, min(int(limit or 50), 200))
        identifier = str(document_id)
        needle = (search or "").strip().lower()
        matches: list[dict[str, Any]] = []
        filename = ""

        for doc in self._documents:
            if self._doc_workspace_id(doc) != scoped_workspace_id:
                continue
            metadata = doc.metadata
            doc_identifier = str(metadata.get("document_id") or "")
            doc_filename = str(metadata.get("filename") or "")
            if identifier not in {doc_identifier, doc_filename}:
                continue
            filename = filename or doc_filename or identifier
            content = doc.page_content or ""
            if needle and needle not in content.lower():
                continue
            chunk_index = self._safe_int(metadata.get("chunk_index"), default=len(matches))
            page_number = self._safe_int(
                metadata.get("page_number") or metadata.get("page"),
                default=0,
            )
            matches.append(
                {
                    "chunk_index": chunk_index,
                    "content": content[:2000],
                    "page_number": page_number,
                    "section_title": metadata.get("section_title"),
                    "token_count": self._safe_int(metadata.get("token_count"), default=0),
                    "metadata": {
                        key: value
                        for key, value in metadata.items()
                        if key
                        not in {
                            "workspace_id",
                            "document_id",
                            "filename",
                            "chunk_index",
                        }
                    },
                }
            )

        matches.sort(key=lambda item: (item["chunk_index"], item["page_number"]))
        return {
            "document_id": identifier,
            "filename": filename or identifier,
            "chunks": matches[:safe_limit],
            "total": len(matches),
        }

    @property
    def total_chunks(self) -> int:
        return len(self._documents)

    def count_chunks(self, *, workspace_id: str | None = None) -> int:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        local_count = sum(
            1 for doc in self._documents if self._doc_workspace_id(doc) == scoped_workspace_id
        )
        if not self._qdrant:
            return local_count
        try:
            qdrant_count = self._qdrant.count_chunks_sync(workspace_id=scoped_workspace_id)
            return max(local_count, qdrant_count)
        except Exception as exc:
            logger.warning(
                "qdrant_count_failed",
                workspace_id=scoped_workspace_id,
                error=str(exc)[:300],
            )
            return local_count

    @staticmethod
    def _safe_int(value: Any, *, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    # ══════════════════════════════════════════════════════════════════
    #  SEARCH
    # ══════════════════════════════════════════════════════════════════

    def search(
        self,
        query: str,
        top_k: int = 10,
        *,
        workspace_id: str | None = None,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchHit]:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        filename_scope = self._explicit_filename_scope(query, workspace_id=scoped_workspace_id)
        safe_filters = self._normalize_filters(filters)
        search_k = max(top_k * 2, self.total_chunks, top_k)
        qdrant_hits = self._qdrant_search(
            query,
            search_k,
            workspace_id=scoped_workspace_id,
            filters=safe_filters,
        )
        if not self._documents:
            return qdrant_hits[:top_k]
        dense = self._dense_search(
            query,
            search_k,
            workspace_id=scoped_workspace_id,
            filters=safe_filters,
        )
        sparse = (
            self._sparse_search(
                query,
                search_k,
                workspace_id=scoped_workspace_id,
                filters=safe_filters,
            )
            if _BM25_OK
            else []
        )
        if self._use_lightweight and sparse:
            hits = self._merge_sparse_first(sparse, dense, top_k)
            if qdrant_hits:
                hits = self._dedupe_hits([*qdrant_hits, *hits], top_k)
            return self._apply_filename_scope(
                hits,
                filename_scope,
                top_k,
                workspace_id=scoped_workspace_id,
                filters=safe_filters,
            )
        if not sparse:
            hits = dense[:top_k]
            if qdrant_hits:
                hits = self._dedupe_hits([*qdrant_hits, *hits], top_k)
            return self._apply_filename_scope(
                hits,
                filename_scope,
                top_k,
                workspace_id=scoped_workspace_id,
                filters=safe_filters,
            )
        hits = self._fuse(dense, sparse, top_k)
        if qdrant_hits:
            hits = self._dedupe_hits([*qdrant_hits, *hits], top_k)
        return self._apply_filename_scope(
            hits,
            filename_scope,
            top_k,
            workspace_id=scoped_workspace_id,
            filters=safe_filters,
        )

    def _dense_search(
        self,
        query: str,
        top_k: int,
        *,
        workspace_id: str,
        filters: dict[str, Any],
    ) -> list[SearchHit]:
        if self._index is None or self._index.ntotal == 0:
            return []
        q_emb = np.array([self._embedder.embed_query(query)], dtype="float32")
        faiss.normalize_L2(q_emb)
        k = min(top_k, self._index.ntotal)
        scores, indices = self._index.search(q_emb, k)
        results: list[SearchHit] = []
        for score, idx in zip(scores[0], indices[0]):
            if (
                idx >= 0
                and score >= self._sim_threshold
                and self._doc_workspace_id(self._documents[idx]) == workspace_id
                and self._matches_filters(self._documents[idx], filters)
            ):
                results.append(
                    SearchHit(document=self._documents[idx], score=float(score), method="dense")
                )
        return results

    def _sparse_search(
        self,
        query: str,
        top_k: int,
        *,
        workspace_id: str,
        filters: dict[str, Any],
    ) -> list[SearchHit]:
        if not self._bm25:
            return []
        tokens = self._tokenize(query)
        token_set = set(tokens)
        raw_scores = self._bm25.get_scores(tokens)
        top_idx = np.argsort(raw_scores)[::-1][:top_k]
        results: list[SearchHit] = []
        for i in top_idx:
            if self._doc_workspace_id(self._documents[i]) != workspace_id:
                continue
            if not self._matches_filters(self._documents[i], filters):
                continue
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
            min_sparse_score = top_sparse_score * 0.5
            sparse = [hit for hit in sparse if hit.score >= min_sparse_score]
            candidates = sparse
        else:
            candidates = [*sparse, *dense]

        merged: list[SearchHit] = []
        seen: set[str] = set()
        for hit in candidates:
            key = self._doc_hash(hit.document)
            if key in seen:
                continue
            seen.add(key)
            merged.append(hit)
            if len(merged) >= top_k:
                break
        return merged

    def _qdrant_search(
        self,
        query: str,
        top_k: int,
        *,
        workspace_id: str,
        filters: dict[str, Any],
    ) -> list[SearchHit]:
        if not self._qdrant:
            return []
        try:
            query_embedding = self._embedder.embed_query(query)
            results = self._qdrant.search_sync(
                workspace_id=workspace_id,
                query_embedding=query_embedding,
                top_k=top_k,
                filters=self._qdrant_filters(filters),
            )
        except Exception as exc:
            logger.warning(
                "qdrant_search_failed",
                workspace_id=workspace_id,
                error=str(exc)[:300],
            )
            return []

        hits: list[SearchHit] = []
        for item in results:
            if item.score < self._sim_threshold:
                continue
            payload = item.payload or {}
            metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
            page_number = payload.get("page_number")
            chunk_index = payload.get("chunk_index")
            doc_metadata = {
                **metadata,
                "workspace_id": workspace_id,
                "document_id": item.document_id,
                "chunk_id": item.chunk_id,
                "filename": payload.get("filename") or metadata.get("filename") or "Unknown",
                "page_number": int(page_number or 0),
                "chunk_index": int(chunk_index or 0),
                "content_hash": payload.get("content_hash"),
                "score": round(float(item.score), 4),
            }
            hits.append(
                SearchHit(
                    document=Document(page_content=item.content, metadata=doc_metadata),
                    score=float(item.score),
                    method="qdrant",
                )
            )
        return [hit for hit in hits if self._matches_filters(hit.document, filters)]

    @staticmethod
    def _dedupe_hits(hits: list[SearchHit], top_k: int) -> list[SearchHit]:
        merged: list[SearchHit] = []
        seen: set[str] = set()
        for hit in hits:
            key = VectorStoreManager._doc_hash(hit.document)
            if key in seen:
                continue
            seen.add(key)
            merged.append(hit)
            if len(merged) >= top_k:
                break
        return merged

    def _apply_filename_scope(
        self,
        hits: list[SearchHit],
        filename_scope: set[str],
        top_k: int,
        *,
        workspace_id: str,
        filters: dict[str, Any],
    ) -> list[SearchHit]:
        if not filename_scope:
            return hits

        scoped: list[SearchHit] = []
        seen: set[str] = set()
        for hit in hits:
            filename = str(hit.document.metadata.get("filename", ""))
            if filename not in filename_scope:
                continue
            if not self._matches_filters(hit.document, filters):
                continue
            key = self._doc_hash(hit.document)
            if key in seen:
                continue
            seen.add(key)
            scoped.append(hit)

        for doc in self._documents:
            if self._doc_workspace_id(doc) != workspace_id:
                continue
            filename = str(doc.metadata.get("filename", ""))
            if filename not in filename_scope:
                continue
            if not self._matches_filters(doc, filters):
                continue
            key = self._doc_hash(doc)
            if key in seen:
                continue
            seen.add(key)
            scoped.append(SearchHit(document=doc, score=0.001, method="filename"))
            if len(scoped) >= top_k:
                break

        return scoped[:top_k]

    @classmethod
    def _normalize_filters(cls, filters: dict[str, Any] | None) -> dict[str, Any]:
        if not filters:
            return {}
        normalized: dict[str, Any] = {}
        document_ids = filters.get("document_ids")
        if document_ids is None and filters.get("document_id"):
            document_ids = [filters.get("document_id")]
        if document_ids is not None:
            values = [
                str(item).strip()
                for item in (document_ids if isinstance(document_ids, list) else [document_ids])
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
        metadata_filters = filters.get("metadata")
        if isinstance(metadata_filters, dict):
            normalized_metadata = {
                str(key): value
                for key, value in metadata_filters.items()
                if re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", str(key))
                and isinstance(value, (str, int, float, bool))
            }
            if normalized_metadata:
                normalized["metadata"] = normalized_metadata
        for key in ("min_page", "max_page"):
            try:
                if filters.get(key) is not None:
                    normalized[key] = int(filters[key])
            except (TypeError, ValueError):
                continue
        return normalized

    @classmethod
    def _qdrant_filters(cls, filters: dict[str, Any]) -> dict[str, Any]:
        payload_filters: dict[str, Any] = {}
        document_ids = filters.get("document_ids")
        if document_ids:
            payload_filters["document_id"] = document_ids
        if filters.get("filename"):
            payload_filters["filename"] = filters["filename"]
        if filters.get("file_types"):
            payload_filters["metadata.file_type"] = filters["file_types"]
        if filters.get("uploaded_by"):
            payload_filters["metadata.uploaded_by"] = filters["uploaded_by"]
        uploaded_range: dict[str, int] = {}
        if filters.get("uploaded_after_epoch") is not None:
            uploaded_range["gte"] = int(filters["uploaded_after_epoch"])
        if filters.get("uploaded_before_epoch") is not None:
            uploaded_range["lte"] = int(filters["uploaded_before_epoch"])
        if uploaded_range:
            payload_filters["metadata.uploaded_at_epoch"] = uploaded_range
        for key, value in (filters.get("metadata") or {}).items():
            payload_filters[f"metadata.{key}"] = value
        page_range: dict[str, int] = {}
        if filters.get("min_page") is not None:
            page_range["gte"] = int(filters["min_page"])
        if filters.get("max_page") is not None:
            page_range["lte"] = int(filters["max_page"])
        if page_range:
            payload_filters["page_number"] = page_range
        return payload_filters

    @classmethod
    def _matches_filters(cls, doc: Document, filters: dict[str, Any]) -> bool:
        if not filters:
            return True
        metadata = doc.metadata
        document_ids = filters.get("document_ids")
        if document_ids:
            document_id = str(metadata.get("document_id") or "")
            if document_id not in set(document_ids):
                return False
        filename = filters.get("filename")
        if filename and str(metadata.get("filename") or "") != str(filename):
            return False
        file_types = filters.get("file_types")
        if file_types:
            file_type = str(metadata.get("file_type") or "").lower().lstrip(".")
            if file_type not in set(file_types):
                return False
        uploaded_by = filters.get("uploaded_by")
        if uploaded_by:
            owner = str(
                metadata.get("uploaded_by")
                or metadata.get("uploader_id")
                or metadata.get("user_id")
                or ""
            )
            if owner != str(uploaded_by):
                return False
        uploaded_at_epoch = cls._safe_int(metadata.get("uploaded_at_epoch"), default=0)
        if (
            filters.get("uploaded_after_epoch") is not None
            and uploaded_at_epoch < int(filters["uploaded_after_epoch"])
        ):
            return False
        if (
            filters.get("uploaded_before_epoch") is not None
            and uploaded_at_epoch > int(filters["uploaded_before_epoch"])
        ):
            return False
        for key, value in (filters.get("metadata") or {}).items():
            if metadata.get(key) != value:
                return False
        page = cls._safe_int(metadata.get("page_number") or metadata.get("page"), default=0)
        if filters.get("min_page") is not None and page < int(filters["min_page"]):
            return False
        if filters.get("max_page") is not None and page > int(filters["max_page"]):
            return False
        return True

    def _explicit_filename_scope(
        self,
        query: str,
        *,
        workspace_id: str | None = None,
    ) -> set[str]:
        normalized_query = self._normalize_filename_reference(query)
        if not normalized_query:
            return set()

        scoped_workspace_id = normalize_workspace_id(workspace_id)
        padded_query = f" {normalized_query} "
        matches: set[str] = set()
        filenames = {
            str(doc.metadata.get("filename", ""))
            for doc in self._documents
            if self._doc_workspace_id(doc) == scoped_workspace_id
        }
        for filename in filenames:
            normalized_filename = self._normalize_filename_reference(filename)
            normalized_stem = self._normalize_filename_reference(Path(filename).stem)
            if normalized_filename and f" {normalized_filename} " in padded_query:
                matches.add(filename)
            elif (
                len(normalized_stem.split()) >= 2
                and f" {normalized_stem} " in padded_query
            ):
                matches.add(filename)
        return matches

    @staticmethod
    def _normalize_filename_reference(value: str) -> str:
        return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())

    @staticmethod
    def _doc_hash(doc: Document) -> str:
        return VectorStoreManager._doc_identity(doc)

    @staticmethod
    def _doc_identity(doc: Document) -> str:
        workspace_id = VectorStoreManager._doc_workspace_id(doc)
        document_id = doc.metadata.get("document_id", "")
        filename = doc.metadata.get("filename", "")
        chunk_index = doc.metadata.get("chunk_index", "")
        digest = hashlib.sha256(doc.page_content.encode("utf-8", "ignore")).hexdigest()
        return f"{workspace_id}:{document_id}:{filename}:{chunk_index}:{digest}"

    @staticmethod
    def _doc_workspace_id(doc: Document) -> str:
        return normalize_workspace_id(str(doc.metadata.get("workspace_id") or ""))

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
        tokens = re.sub(r"[^a-z0-9]+", " ", text.lower()).split()
        return [
            token
            for token in tokens
            if token not in _SEARCH_STOPWORDS and token not in _SEARCH_NOISE_TERMS
        ]

    @staticmethod
    def _bm25_text(doc: Document) -> str:
        metadata = doc.metadata
        filename = str(metadata.get("filename", ""))
        file_type = str(metadata.get("file_type", ""))
        document_type = str(metadata.get("document_type", ""))
        return f"{filename} {file_type} {document_type}\n{doc.page_content}"
