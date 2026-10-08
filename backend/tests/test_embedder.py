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


def test_embedder_caches_query_and_document_embeddings(monkeypatch):
    monkeypatch.setenv("ENABLE_LIGHTWEIGHT_EMBEDDINGS", "false")
    monkeypatch.setenv("ENABLE_CACHE", "true")
    get_settings.cache_clear()

    class FakeModel:
        def __init__(self):
            self.query_calls = 0
            self.document_calls: list[list[str]] = []

        def embed_query(self, _query: str):
            self.query_calls += 1
            return [1.0, 0.0]

        def embed_documents(self, texts: list[str]):
            self.document_calls.append(texts)
            return [[float(index), 1.0] for index, _ in enumerate(texts)]

    try:
        embedder = Embedder(settings=get_settings())
        fake = FakeModel()
        embedder._model = fake

        assert embedder.embed_query("same query") == embedder.embed_query("same query")
        first = embedder.embed_texts(["alpha", "alpha", "beta"])
        second = embedder.embed_texts(["alpha", "beta"])
    finally:
        get_settings.cache_clear()

    assert fake.query_calls == 1
    assert fake.document_calls == [["alpha", "beta"]]
    assert first == [first[0], first[0], first[2]]
    assert second == [first[0], first[2]]


def test_neural_model_receives_pinned_revision_and_cache_identity(monkeypatch):
    import sys
    from types import SimpleNamespace
    from config.settings import Settings

    captured = {}

    def fake_embeddings(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setitem(sys.modules, "langchain_huggingface", SimpleNamespace(HuggingFaceEmbeddings=fake_embeddings))
    settings = Settings(embedding_revision="a" * 40, enable_lightweight_embeddings=False)
    embedder = Embedder(settings=settings)
    assert embedder.model is not None
    assert captured["model_kwargs"] == {"device": "cpu", "revision": "a" * 40}
    other = Embedder(settings=Settings(embedding_revision="b" * 40))
    assert embedder._cache_key("same content") != other._cache_key("same content")
