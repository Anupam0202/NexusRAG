"""
Embedding Generation
=====================

Wraps ``HuggingFaceEmbeddings`` from LangChain so the same model instance
is reused across ingestion and retrieval.  Supports batch processing with
configurable batch size.
"""

from __future__ import annotations

import hashlib
import re
from functools import lru_cache
from typing import Any

import numpy as np

from config.settings import Settings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class Embedder:
    """Thin wrapper over ``HuggingFaceEmbeddings`` for consistent reuse.

    The heavy model is loaded lazily on first use and cached for the
    lifetime of the instance.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        s = settings or get_settings()
        self._model_name = s.embedding_model
        self._device = s.embedding_device
        self._normalize = s.embedding_normalize
        self._batch_size = s.embedding_batch_size
        self._lightweight = s.use_lightweight_embeddings
        self._lightweight_dim = 384
        self._lightweight_logged = False
        self._model: Any | None = None

    @property
    def model(self) -> Any:
        """Lazy-loaded embedding model."""
        if self._model is None:
            from langchain_huggingface import HuggingFaceEmbeddings

            logger.info("loading_embedding_model", model=self._model_name)
            self._model = HuggingFaceEmbeddings(
                model_name=self._model_name,
                model_kwargs={"device": self._device},
                encode_kwargs={"normalize_embeddings": self._normalize},
            )
            logger.info("embedding_model_loaded")
        return self._model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed a list of texts in batches.

        Args:
            texts: Plain text strings to embed.

        Returns:
            List of embedding vectors (each a list of floats).
        """
        if self._lightweight:
            self._log_lightweight_once()
            return [self._hash_embedding(text) for text in texts]

        all_embeddings: list[list[float]] = []
        total = len(texts)

        for start in range(0, total, self._batch_size):
            batch = texts[start : start + self._batch_size]
            batch_emb = self.model.embed_documents(batch)
            all_embeddings.extend(batch_emb)

        return all_embeddings

    def embed_query(self, query: str) -> list[float]:
        """Embed a single query string."""
        if self._lightweight:
            self._log_lightweight_once()
            return self._hash_embedding(query)
        return self.model.embed_query(query)

    @property
    def dimension(self) -> int:
        """Return the embedding dimensionality (discovered on first embed)."""
        if self._lightweight:
            return self._lightweight_dim
        test = self.embed_query("test")
        return len(test)

    def _log_lightweight_once(self) -> None:
        if self._lightweight_logged:
            return
        logger.info("lightweight_embeddings_enabled", dimensions=self._lightweight_dim)
        self._lightweight_logged = True

    def _hash_embedding(self, text: str) -> list[float]:
        tokens = re.findall(r"[a-zA-Z0-9_]{2,}", text.lower())
        vec = np.zeros(self._lightweight_dim, dtype=np.float32)
        for token in tokens:
            digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
            value = int.from_bytes(digest, "little", signed=False)
            sign = 1.0 if value & 1 else -1.0
            vec[(value >> 1) % self._lightweight_dim] += sign

        norm = float(np.linalg.norm(vec))
        if norm <= 1e-12:
            return vec.tolist()
        return (vec / norm).tolist()


@lru_cache(maxsize=1)
def get_embedder() -> Embedder:
    """Singleton ``Embedder`` instance."""
    return Embedder()
