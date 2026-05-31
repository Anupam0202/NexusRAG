"""Local FAISS adapter for development and demo fallback only."""

from __future__ import annotations

from typing import Any

from langchain_core.documents import Document

from src.retrieval.vector_store import VectorStoreManager
from src.vectorstores.base import VectorChunk, VectorSearchResult


class LocalFaissVectorStore:
    def __init__(self, manager: VectorStoreManager | None = None) -> None:
        self._manager = manager or VectorStoreManager()

    async def upsert_chunks(
        self,
        *,
        workspace_id: str,
        document_id: str,
        chunks: list[VectorChunk],
    ) -> int:
        documents = [
            Document(
                page_content=chunk.content,
                metadata={
                    **chunk.metadata,
                    "workspace_id": workspace_id,
                    "document_id": document_id,
                    "chunk_id": chunk.chunk_id,
                    "filename": chunk.filename,
                    "page_number": chunk.page_number,
                    "chunk_index": chunk.chunk_index,
                    "content_hash": chunk.content_hash,
                },
            )
            for chunk in chunks
        ]
        return self._manager.add_documents(
            documents,
            workspace_id=workspace_id,
            document_id=document_id,
        )

    async def search(
        self,
        *,
        workspace_id: str,
        query_embedding: list[float],
        top_k: int,
        filters: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        query = str((filters or {}).get("query") or "")
        if not query:
            raise ValueError("LocalFaissVectorStore requires filters['query'] for text search.")
        hits = self._manager.search(query, top_k=top_k * 3, workspace_id=workspace_id)
        results: list[VectorSearchResult] = []
        for hit in hits:
            metadata = hit.document.metadata
            if metadata.get("workspace_id") != workspace_id:
                continue
            results.append(
                VectorSearchResult(
                    chunk_id=str(metadata.get("chunk_id") or ""),
                    document_id=str(metadata.get("document_id") or ""),
                    content=hit.document.page_content,
                    score=hit.score,
                    payload=dict(metadata),
                )
            )
            if len(results) >= top_k:
                break
        return results

    async def delete_document(self, *, workspace_id: str, document_id: str) -> int:
        before = self._manager.total_chunks
        keep = [
            (doc, embedding)
            for doc, embedding in zip(self._manager._documents, self._manager._raw_embeddings)
            if not (
                doc.metadata.get("workspace_id") == workspace_id
                and doc.metadata.get("document_id") == document_id
            )
        ]
        self._manager._documents = [item[0] for item in keep]
        self._manager._raw_embeddings = [item[1] for item in keep]
        self._manager._rebuild_index()
        self._manager._rebuild_bm25()
        self._manager._save()
        return before - self._manager.total_chunks

    async def count_chunks(self, *, workspace_id: str) -> int:
        return sum(
            1
            for doc in self._manager._documents
            if doc.metadata.get("workspace_id") == workspace_id
        )
