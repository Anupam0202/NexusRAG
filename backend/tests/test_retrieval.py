"""
Tests for the retrieval module.
"""

from __future__ import annotations

from langchain_core.documents import Document

from config.settings import get_settings
from src.retrieval.query_transformer import QueryTransformer
from src.retrieval.retriever import QueryType, classify_query
from src.retrieval.vector_store import VectorStoreManager


class TestQueryClassification:
    def test_list_all(self):
        assert classify_query("Show all employees") == QueryType.LIST_ALL

    def test_aggregation(self):
        assert classify_query("What is the total sales amount?") == QueryType.AGGREGATION

    def test_summary(self):
        assert classify_query("Summarize the document") == QueryType.SUMMARY

    def test_comparison(self):
        assert classify_query("Compare Q1 vs Q2 sales") == QueryType.COMPARISON

    def test_filter(self):
        assert classify_query("Who works in Mumbai?") == QueryType.FILTER

    def test_general(self):
        assert classify_query("Hello there") == QueryType.GENERAL


class TestVectorStoreManager:
    def test_add_and_search(self, sample_documents: list[Document], tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        # Start fresh
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        added = vs.add_documents(sample_documents)
        assert added == 3
        assert vs.total_chunks == 3

        results = vs.search("revenue Q1", top_k=2)
        assert len(results) >= 1
        assert results[0].document.metadata["filename"] == "report.pdf"

    def test_delete_by_filename(self, sample_documents: list[Document], tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        vs.add_documents(sample_documents)
        removed = vs.delete_by_filename("report.pdf")
        assert removed >= 1
        assert vs.total_chunks == 2

    def test_list_documents(self, sample_documents: list[Document], tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        vs.add_documents(sample_documents)
        listing = vs.list_documents()
        filenames = {d["filename"] for d in listing}
        assert "report.pdf" in filenames
        assert "employees.xlsx" in filenames
        report = next(d for d in listing if d["filename"] == "report.pdf")
        assert report["file_type"] == "pdf"

    def test_duplicate_chunks_are_skipped(self, sample_documents: list[Document], tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        assert vs.add_documents(sample_documents) == 3
        assert vs.add_documents(sample_documents) == 0
        assert vs.total_chunks == 3

    def test_lightweight_search_prefers_sparse_filename_matches(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._use_lightweight = True
        vs._documents = [
            Document(
                page_content="Seasonal planting calendar and plant health scanner.",
                metadata={"filename": "plantpal_comprehensive_guide.md", "file_type": "md"},
            ),
            Document(
                page_content="Family income, ration card, and applicant address fields.",
                metadata={"filename": "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf"},
            ),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        results = vs.search("PlantPal features", top_k=2)

        assert results[0].document.metadata["filename"] == "plantpal_comprehensive_guide.md"


class TestQueryTransformer:
    def test_constrained_memory_disables_query_expansion(self, monkeypatch):
        monkeypatch.setenv("CONSTRAINED_MEMORY", "true")
        monkeypatch.setenv("ENABLE_QUERY_EXPANSION", "true")
        get_settings.cache_clear()
        try:
            result = QueryTransformer(settings=get_settings()).transform("PlantPal features")
        finally:
            get_settings.cache_clear()

        assert result["queries"] == ["PlantPal features"]
