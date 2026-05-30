"""
Embedding tests.
"""

from __future__ import annotations

from config.settings import get_settings
from src.ingestion.embedder import Embedder


def test_lightweight_embeddings_are_stable(monkeypatch):
    monkeypatch.setenv("ENABLE_LIGHTWEIGHT_EMBEDDINGS", "true")
    get_settings.cache_clear()
    try:
        embedder = Embedder(settings=get_settings())
        first = embedder.embed_query("family level data collection")
        second = embedder.embed_query("family level data collection")
    finally:
        get_settings.cache_clear()

    assert len(first) == 384
    assert first == second
    assert any(value != 0 for value in first)
