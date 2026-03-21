"""
FastAPI Dependency Injection
=============================

Provides singleton instances of all heavy components.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from config.settings import Settings, get_settings
from src.generation.chain import RAGChain
from src.retrieval.vector_store import VectorStoreManager
from src.utils.logger import get_logger

logger = get_logger(__name__)


# ── Auth ──────────────────────────────────────────────────────────────────


async def verify_api_key(
    x_api_key: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
) -> None:
    if settings.api_key and settings.api_key.strip():
        if not x_api_key or x_api_key != settings.api_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing API key",
            )


# ── Singletons ────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStoreManager:
    logger.info("initialising_vector_store")
    return VectorStoreManager()


@lru_cache(maxsize=1)
def get_rag_chain() -> RAGChain:
    logger.info("initialising_rag_chain")
    vs = get_vector_store()
    return RAGChain(vector_store=vs)