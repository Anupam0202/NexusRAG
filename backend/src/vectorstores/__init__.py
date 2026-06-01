"""Workspace-scoped vector store adapters."""

from src.vectorstores.base import VectorChunk, VectorSearchResult, VectorStore

__all__ = [
    "LocalFaissVectorStore",
    "PgVectorStore",
    "QdrantVectorStore",
    "VectorChunk",
    "VectorSearchResult",
    "VectorStore",
]


def __getattr__(name: str):
    if name == "LocalFaissVectorStore":
        from src.vectorstores.local_faiss_store import LocalFaissVectorStore

        return LocalFaissVectorStore
    if name == "PgVectorStore":
        from src.vectorstores.pgvector_store import PgVectorStore

        return PgVectorStore
    if name == "QdrantVectorStore":
        from src.vectorstores.qdrant_store import QdrantVectorStore

        return QdrantVectorStore
    raise AttributeError(name)
