"""
Tests for the ingestion module.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

import pytest
from langchain_core.documents import Document

from src.ingestion.chunker import RecursiveChunker, SemanticChunker, SmartChunker
from src.ingestion.loader import LoaderFactory


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
        long_text = ("This is a long sentence about machine learning. " * 100)
        docs = [Document(page_content=long_text, metadata={"document_type": "generic"})]
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
        text = "Sentence one. " * 200
        docs = [Document(page_content=text, metadata={})]
        chunker = RecursiveChunker()
        chunks = chunker.chunk(docs)
        assert len(chunks) > 1
        for c in chunks:
            assert "chunk_index" in c.metadata