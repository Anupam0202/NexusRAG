from __future__ import annotations

from pathlib import Path

from langchain_core.documents import Document

from config.settings import Settings
from src.ingestion.pipeline import IngestionPipeline
from src.utils.layered_cache import LayeredCache


def test_layered_cache_is_scoped_deep_copied_and_explicitly_invalidated() -> None:
    cache = LayeredCache(ttl_seconds=60, max_entries=10)
    payload = [{"value": "private"}]

    cache.set(
        "parse",
        "same-content",
        payload,
        workspace_id="workspace-a",
        document_id="document-a",
    )
    first = cache.get(
        "parse",
        "same-content",
        workspace_id="workspace-a",
        document_id="document-a",
    )
    assert first == payload
    first[0]["value"] = "mutated"

    assert cache.get(
        "parse",
        "same-content",
        workspace_id="workspace-a",
        document_id="document-a",
    ) == payload
    assert cache.get(
        "parse",
        "same-content",
        workspace_id="workspace-b",
        document_id="document-a",
    ) is None

    assert cache.invalidate(workspace_id="workspace-a", document_id="document-a") == 1
    assert cache.get(
        "parse",
        "same-content",
        workspace_id="workspace-a",
        document_id="document-a",
    ) is None


def test_ingestion_pipeline_reuses_parse_and_chunk_layers_within_document(monkeypatch) -> None:
    settings = Settings(
        _env_file=None,
        enable_cache=True,
        enable_contextual_enrichment=False,
        enable_semantic_chunking=False,
    )
    pipeline = IngestionPipeline(settings=settings)
    calls = {"load": 0, "chunk": 0}

    def fake_load(_path, _content):
        calls["load"] += 1
        return [Document(page_content="cached document", metadata={"filename": "cached.txt"})]

    def fake_chunk(documents):
        calls["chunk"] += 1
        return [
            Document(
                page_content=documents[0].page_content,
                metadata=dict(documents[0].metadata),
            )
        ]

    monkeypatch.setattr("src.ingestion.pipeline.LoaderFactory.load_file", fake_load)
    monkeypatch.setattr(pipeline._chunker, "chunk", fake_chunk)

    for _ in range(2):
        result = pipeline.ingest(
            file_uploads=[{"filename": "cached.txt", "content": b"same bytes"}],
            workspace_id="workspace-a",
            document_id="document-a",
        )
        assert result.success is True
        assert result.chunks[0].metadata["workspace_id"] == "workspace-a"

    assert calls == {"load": 1, "chunk": 1}

    pipeline.clear_cache(workspace_id="workspace-a", document_id="document-a")
    pipeline.ingest(
        file_uploads=[{"filename": "cached.txt", "content": b"same bytes"}],
        workspace_id="workspace-a",
        document_id="document-a",
    )
    assert calls == {"load": 2, "chunk": 2}


def test_parse_cache_key_changes_when_parser_settings_change() -> None:
    baseline = IngestionPipeline(
        settings=Settings(
            _env_file=None,
            max_pdf_pages=40,
            max_pdf_ocr_pages=12,
            pdf_ocr_dpi=150,
        )
    )
    limited = IngestionPipeline(
        settings=Settings(
            _env_file=None,
            max_pdf_pages=10,
            max_pdf_ocr_pages=2,
            pdf_ocr_dpi=96,
        )
    )

    baseline_key = baseline._parse_cache_key(Path("report.pdf"), b"same PDF bytes")
    limited_key = limited._parse_cache_key(Path("report.pdf"), b"same PDF bytes")

    assert baseline_key != limited_key
