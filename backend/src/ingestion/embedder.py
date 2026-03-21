"""
Embedding Generation
=====================

Wraps ``HuggingFaceEmbeddings`` from LangChain so the same model instance
is reused across ingestion and retrieval.  Supports batch processing with
configurable batch size.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List, Optional

from langchain_huggingface import HuggingFaceEmbeddings

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class Embedder:
    """Thin wrapper over ``HuggingFaceEmbeddings`` for consistent reuse.

    The heavy model is loaded lazily on first use and cached for the
    lifetime of the instance.
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        s = settings or get_settings()
        self._model_name = s.embedding_model
        self._device = s.embedding_device
        self._normalize = s.embedding_normalize
        self._batch_size = s.embedding_batch_size
        self._model: Optional[HuggingFaceEmbeddings] = None

    @property
    def model(self) -> HuggingFaceEmbeddings:
        """Lazy-loaded embedding model."""
        if self._model is None:
            logger.info("loading_embedding_model", model=self._model_name)
            self._model = HuggingFaceEmbeddings(
                model_name=self._model_name,
                model_kwargs={"device": self._device},
                encode_kwargs={"normalize_embeddings": self._normalize},
            )
            logger.info("embedding_model_loaded")
        return self._model

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Embed a list of texts in batches.

        Args:
            texts: Plain text strings to embed.

        Returns:
            List of embedding vectors (each a list of floats).
        """
        all_embeddings: List[List[float]] = []
        total = len(texts)

        for start in range(0, total, self._batch_size):
            batch = texts[start : start + self._batch_size]
            batch_emb = self.model.embed_documents(batch)
            all_embeddings.extend(batch_emb)

        return all_embeddings

    def embed_query(self, query: str) -> List[float]:
        """Embed a single query string."""
        return self.model.embed_query(query)

    @property
    def dimension(self) -> int:
        """Return the embedding dimensionality (discovered on first embed)."""
        test = self.embed_query("test")
        return len(test)


@lru_cache(maxsize=1)
def get_embedder() -> Embedder:
    """Singleton ``Embedder`` instance."""
    return Embedder()