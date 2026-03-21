"""
Tests for the retrieval module.
"""

from __future__ import annotations

from typing import List

import pytest
from langchain_core.documents import Document

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
    def test_add_and_search(self, sample_documents: List[Document], tmp_path):
        import os

        os.environ["VECTOR_STORE_PATH"] = str(tmp_path / "vs")
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)

        added = vs.add_documents(sample_documents)
        assert added == 3
        assert vs.total_chunks == 3

        results = vs.search("revenue Q1", top_k=2)
        assert len(results) >= 1
        assert results[0].document.metadata["filename"] == "report.pdf"

    def test_delete_by_filename(self, sample_documents: List[Document], tmp_path):
        import os

        os.environ["VECTOR_STORE_PATH"] = str(tmp_path / "vs")
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)

        vs.add_documents(sample_documents)
        removed = vs.delete_by_filename("report.pdf")
        assert removed >= 1
        assert vs.total_chunks == 2

    def test_list_documents(self, sample_documents: List[Document], tmp_path):
        import os

        os.environ["VECTOR_STORE_PATH"] = str(tmp_path / "vs")
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)

        vs.add_documents(sample_documents)
        listing = vs.list_documents()
        filenames = {d["filename"] for d in listing}
        assert "report.pdf" in filenames
        assert "employees.xlsx" in filenames