"""
Tests for the ingestion module.
"""

from __future__ import annotations

import io
from pathlib import Path

from langchain_core.documents import Document
from PIL import Image

from config.settings import get_settings
from src.ingestion import loader as loader_module
from src.ingestion.chunker import RecursiveChunker, SmartChunker
from src.ingestion.job_manager import InMemoryIngestionJobStore
from src.ingestion.loader import LoaderFactory
from src.ingestion.ocr_manager import GeminiVisionOCR
from src.utils.security import FileValidator


def test_ingestion_job_store_accepts_durable_job_id() -> None:
    store = InMemoryIngestionJobStore()

    job = store.create(
        job_id="11111111-1111-1111-1111-111111111111",
        workspace_id="22222222-2222-2222-2222-222222222222",
        document_id="33333333-3333-3333-3333-333333333333",
        filename="enterprise.txt",
    )

    assert job.job_id == "11111111-1111-1111-1111-111111111111"
    assert store.get(job.job_id) is job

# ═══════════════════════════════════════════════════════════════════════════
#  LOADER TESTS
# ═══════════════════════════════════════════════════════════════════════════


class TestLoaderFactory:
    def test_unsupported_extension_returns_empty(self):
        docs = LoaderFactory.load_file(Path("test.xyz"))
        assert docs == []

    def test_txt_loader_from_bytes(self):
        content = b"Hello, this is a test document with some content."
        docs = LoaderFactory.load_file(Path("test.txt"), content=content)
        assert len(docs) >= 1
        assert "test document" in docs[0].page_content
        assert docs[0].metadata["file_type"] == "text"

    def test_json_loader_array(self):
        import json

        data = [{"name": "Alice"}, {"name": "Bob"}]
        content = json.dumps(data).encode()
        docs = LoaderFactory.load_file(Path("data.json"), content=content)
        # full_data + 2 array_items
        assert len(docs) == 3
        assert docs[0].metadata["document_type"] == "full_data"
        assert docs[1].metadata["document_type"] == "array_item"

    def test_csv_loader(self):
        csv_data = b"name,age,city\nAlice,30,NYC\nBob,25,LA\n"
        docs = LoaderFactory.load_file(Path("data.csv"), content=csv_data)
        # full_data + summary + rows + columns
        assert len(docs) >= 4
        types = {d.metadata["document_type"] for d in docs}
        assert "full_data" in types
        assert "summary" in types

    def test_pdf_validation_bad_header(self):
        docs = LoaderFactory.load_file(Path("fake.pdf"), content=b"not a pdf file")
        # Loader should not crash — returns empty or loads nothing
        assert isinstance(docs, list)


# ═══════════════════════════════════════════════════════════════════════════
#  CHUNKER TESTS
# ═══════════════════════════════════════════════════════════════════════════


class TestFileValidation:
    def test_tif_extension_is_supported(self):
        settings = get_settings()
        assert settings.SUPPORTED_EXTENSIONS[".tif"] == "image"

    def test_webp_magic_bytes_are_validated(self):
        valid_webp = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 16
        ok, message = FileValidator.validate("sample.webp", valid_webp)
        assert ok is True
        assert message == "Valid"

        ok, message = FileValidator.validate("sample.webp", b"not-a-webp")
        assert ok is False
        assert "bad magic bytes" in message

    def test_tiff_magic_bytes_are_validated(self):
        ok, message = FileValidator.validate("scan.tif", b"II*\x00" + b"\x00" * 16)
        assert ok is True
        assert message == "Valid"

        ok, message = FileValidator.validate("scan.tiff", b"not-a-tiff")
        assert ok is False
        assert "bad magic bytes" in message

    def test_tif_image_loader_uses_ocr_text(self, monkeypatch):
        monkeypatch.setattr(loader_module, "ocr_image", lambda image: ("Invoice Total 123", 0.92))

        buffer = io.BytesIO()
        Image.new("RGB", (160, 80), "white").save(buffer, format="TIFF")

        docs = LoaderFactory.load_file(Path("scan.tif"), content=buffer.getvalue())

        assert len(docs) == 1
        assert docs[0].metadata["file_type"] == "image"
        assert docs[0].metadata["extraction_method"] == "ocr"
        assert docs[0].metadata["ocr_confidence"] == 0.92
        assert "Invoice Total 123" in docs[0].page_content

    def test_gemini_ocr_uses_current_failover_chain(self, monkeypatch):
        monkeypatch.setenv("LLM_MODEL_NAME", "gemini-2.5-flash")
        monkeypatch.setenv(
            "LLM_FALLBACK_MODELS",
            "gemini-2.5-flash-lite,gemini-2.0-flash,gemini-2.0-flash-lite",
        )
        get_settings.cache_clear()

        try:
            models = GeminiVisionOCR._configured_models()
        finally:
            get_settings.cache_clear()

        assert models[:4] == [
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ]
        assert "gemini-1.5-pro" not in models


class TestSmartChunker:
    def test_short_doc_passes_through(self):
        docs = [Document(page_content="Short text.", metadata={"document_type": "page"})]
        chunker = SmartChunker()
        chunks = chunker.chunk(docs)
        assert len(chunks) == 1

    def test_full_data_passes_through(self):
        long_text = "Row data " * 500
        docs = [Document(page_content=long_text, metadata={"document_type": "full_data"})]
        chunker = SmartChunker()
        chunks = chunker.chunk(docs)
        # full_data should NOT be re-chunked
        assert len(chunks) == 1

    def test_long_text_gets_chunked(self):
        # Use diverse text content so the semantic/recursive chunker can find split points
        paragraphs = [
            (
                "Machine learning is a subset of artificial intelligence that enables "
                "systems to learn from data.\n\n"
            ),
            (
                "Deep learning uses neural networks with multiple layers to analyze "
                "complex patterns.\n\n"
            ),
            (
                "Natural language processing enables computers to understand human "
                "language effectively.\n\n"
            ),
            "Computer vision allows machines to interpret and make decisions from visual data.\n\n",
            "Reinforcement learning trains agents through trial and error to maximize rewards.\n\n",
        ]
        long_text = "".join(paragraphs * 20)  # ~10000 chars
        docs = [Document(page_content=long_text, metadata={"document_type": "page"})]
        chunker = SmartChunker()
        chunks = chunker.chunk(docs)
        assert len(chunks) > 1

    def test_chunk_ids_assigned(self):
        docs = [Document(page_content="Test " * 200, metadata={"document_type": "generic"})]
        chunker = SmartChunker()
        chunks = chunker.chunk(docs)
        for c in chunks:
            assert "chunk_id" in c.metadata


class TestRecursiveChunker:
    def test_splits_large_text(self):
        # Use text with clear paragraph breaks so the recursive splitter can find split points
        text = "This is a long paragraph about machine learning.\n\n" * 100
        docs = [Document(page_content=text, metadata={})]
        chunker = RecursiveChunker()
        chunks = chunker.chunk(docs)
        assert len(chunks) > 1
        for c in chunks:
            assert "chunk_index" in c.metadata
