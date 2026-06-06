"""
Tests for the retrieval module.
"""

from __future__ import annotations

from langchain_core.documents import Document

from config.settings import Settings, get_settings
from src.retrieval.query_transformer import QueryTransformer
from src.retrieval.retriever import HybridRetriever, QueryType, classify_query
from src.retrieval.vector_store import SearchHit, VectorStoreManager
from src.vectorstores import VectorSearchResult


class TestQueryClassification:
    def test_list_all(self):
        assert classify_query("Show all employees") == QueryType.LIST_ALL
        assert classify_query("Which uploaded files are available?") == QueryType.LIST_ALL

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
    def test_search_uses_qdrant_when_local_store_is_empty(self, tmp_path):
        class FakeEmbedder:
            def embed_query(self, query: str) -> list[float]:
                assert query == "annapurna yojana"
                return [0.1, 0.2]

        class FakeQdrant:
            def search_sync(self, **kwargs):
                assert kwargs["workspace_id"] == "workspace-a"
                return [
                    VectorSearchResult(
                        chunk_id="chunk-a",
                        document_id="doc-a",
                        content="Annapurna Yojana household data collection form",
                        score=0.89,
                        payload={
                            "filename": "annapurna.pdf",
                            "page_number": None,
                            "chunk_index": 0,
                            "metadata": {"file_type": "pdf"},
                        },
                    )
                ]

        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None
        vs._embedder = FakeEmbedder()
        vs._qdrant = FakeQdrant()

        results = vs.search("annapurna yojana", top_k=3, workspace_id="workspace-a")

        assert len(results) == 1
        assert results[0].method == "qdrant"
        assert results[0].document.metadata["document_id"] == "doc-a"
        assert results[0].document.metadata["filename"] == "annapurna.pdf"
        assert results[0].document.metadata["page_number"] == 0

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

    def test_list_and_delete_documents_by_document_id_when_filenames_repeat(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        vs.add_documents(
            [
                Document(
                    page_content="January invoice for client alpha.",
                    metadata={"filename": "invoice.pdf", "chunk_index": 0},
                ),
                Document(
                    page_content="February invoice for client beta.",
                    metadata={"filename": "invoice.pdf", "chunk_index": 0},
                ),
            ],
            document_id="doc-alpha",
        )
        vs.add_documents(
            [
                Document(
                    page_content="March invoice for client gamma.",
                    metadata={"filename": "invoice.pdf", "chunk_index": 0},
                )
            ],
            document_id="doc-beta",
        )

        listing = vs.list_documents()
        assert [item["document_id"] for item in listing] == ["doc-alpha", "doc-beta"]
        assert [item["chunk_count"] for item in listing] == [2, 1]

        removed = vs.delete_by_identifier("doc-alpha")
        assert removed == 2
        remaining = vs.list_documents()
        assert len(remaining) == 1
        assert remaining[0]["document_id"] == "doc-beta"

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

    def test_lightweight_search_ignores_generic_source_terms(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._use_lightweight = True
        vs._documents = [
            Document(
                page_content="PlantPal product features include weather-aware recommendations.",
                metadata={"filename": "PlantPal_new_features.txt"},
            ),
            Document(
                page_content="Uploaded source filename document metadata and file records.",
                metadata={"filename": "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf"},
            ),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        results = vs.search(
            "From the uploaded PlantPal files, name source filenames and summarize features",
            top_k=5,
        )

        assert [hit.document.metadata["filename"] for hit in results] == [
            "PlantPal_new_features.txt"
        ]

    def test_exact_filename_query_is_scoped_to_that_file(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._use_lightweight = True
        vs._documents = [
            Document(
                page_content="e-Electors Photo Identity Card details.",
                metadata={"filename": "Voter_Card.pdf", "file_type": "pdf"},
            ),
            Document(
                page_content="Family identity, head of family, address, and document fields.",
                metadata={"filename": "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf"},
            ),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        results = vs.search(
            "From Voter_Card.pdf, identify the source filename and document type",
            top_k=5,
        )

        assert results
        assert {hit.document.metadata["filename"] for hit in results} == {"Voter_Card.pdf"}

    def test_single_word_stems_do_not_scope_generic_queries(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._use_lightweight = True
        vs._documents = [
            Document(page_content="Annual revenue report.", metadata={"filename": "report.pdf"}),
            Document(page_content="Inventory report.", metadata={"filename": "inventory.pdf"}),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        assert vs._explicit_filename_scope("summarize the report") == set()

    def test_workspace_scoped_search_list_and_delete(self, tmp_path):
        vs = VectorStoreManager()
        vs._persist_dir = tmp_path / "vs"
        vs._persist_dir.mkdir(parents=True, exist_ok=True)
        vs._documents = []
        vs._raw_embeddings = []
        vs._index = None
        vs._bm25 = None

        vs.add_documents(
            [
                Document(
                    page_content="Workspace alpha private cobalt marker.",
                    metadata={"filename": "shared.txt", "chunk_index": 0},
                )
            ],
            workspace_id="workspace-alpha",
            document_id="doc-alpha",
        )
        vs.add_documents(
            [
                Document(
                    page_content="Workspace beta private amber marker.",
                    metadata={"filename": "shared.txt", "chunk_index": 0},
                )
            ],
            workspace_id="workspace-beta",
            document_id="doc-beta",
        )

        alpha_hits = vs.search("private marker", workspace_id="workspace-alpha", top_k=5)
        assert alpha_hits
        assert {hit.document.metadata["workspace_id"] for hit in alpha_hits} == {
            "workspace-alpha"
        }
        assert vs.count_chunks(workspace_id="workspace-alpha") == 1
        assert vs.count_chunks(workspace_id="workspace-beta") == 1
        assert len(vs.list_documents(workspace_id="workspace-alpha")) == 1

        removed = vs.delete_by_filename("shared.txt", workspace_id="workspace-alpha")
        assert removed == 1
        assert vs.count_chunks(workspace_id="workspace-alpha") == 0
        assert vs.count_chunks(workspace_id="workspace-beta") == 1

    def test_search_supports_document_and_page_filters(self):
        vs = VectorStoreManager()
        vs._use_lightweight = True
        vs._documents = [
            Document(
                page_content="Alpha appendix mentions budget approvals.",
                metadata={
                    "workspace_id": "workspace-a",
                    "document_id": "doc-alpha",
                    "filename": "alpha.pdf",
                    "page_number": 4,
                },
            ),
            Document(
                page_content="Beta appendix mentions budget approvals.",
                metadata={
                    "workspace_id": "workspace-a",
                    "document_id": "doc-beta",
                    "filename": "beta.pdf",
                    "page_number": 8,
                },
            ),
            Document(
                page_content="Alpha opening page has no appendix.",
                metadata={
                    "workspace_id": "workspace-a",
                    "document_id": "doc-alpha",
                    "filename": "alpha.pdf",
                    "page_number": 1,
                },
            ),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        hits = vs.search(
            "appendix budget approvals",
            workspace_id="workspace-a",
            top_k=10,
            filters={"document_ids": ["doc-alpha"], "min_page": 2},
        )

        assert hits
        assert {hit.document.metadata["document_id"] for hit in hits} == {"doc-alpha"}
        assert {hit.document.metadata["page_number"] for hit in hits} == {4}

    def test_search_supports_uploaded_date_and_arbitrary_metadata_filters(self):
        vs = VectorStoreManager()
        vs._use_lightweight = True
        vs._documents = [
            Document(
                page_content="Approved finance policy.",
                metadata={
                    "workspace_id": "workspace-a",
                    "document_id": "doc-alpha",
                    "filename": "alpha.pdf",
                    "department": "finance",
                    "uploaded_at_epoch": 100,
                },
            ),
            Document(
                page_content="Approved engineering policy.",
                metadata={
                    "workspace_id": "workspace-a",
                    "document_id": "doc-beta",
                    "filename": "beta.pdf",
                    "department": "engineering",
                    "uploaded_at_epoch": 200,
                },
            ),
        ]
        vs._raw_embeddings = []
        vs._index = None
        vs._rebuild_bm25()

        hits = vs.search(
            "approved policy",
            workspace_id="workspace-a",
            top_k=10,
            filters={
                "uploaded_after_epoch": 150,
                "metadata": {"department": "engineering"},
            },
        )

        assert [hit.document.metadata["document_id"] for hit in hits] == ["doc-beta"]


class TestHybridRetriever:
    def test_retriever_passes_filters_to_vector_store(self):
        calls: list[dict] = []

        class FakeStore:
            def count_chunks(self, *, workspace_id=None):
                return 4

            def search(self, query, top_k=10, **kwargs):
                calls.append({"query": query, "top_k": top_k, **kwargs})
                return [
                    SearchHit(
                        Document(
                            page_content="Filtered chunk",
                            metadata={"filename": "alpha.pdf", "document_id": "doc-alpha"},
                        ),
                        score=0.8,
                        method="test",
                    )
                ]

        retriever = HybridRetriever(
            vector_store=FakeStore(),  # type: ignore[arg-type]
        )
        retriever._transformer = type(
            "FakeTransformer",
            (),
            {"transform": lambda self, query, **kwargs: {"queries": [query]}},
        )()

        result = retriever.retrieve(
            "filtered question",
            workspace_id="workspace-a",
            filters={"document_ids": ["doc-alpha"]},
        )

        assert result["documents"]
        assert calls == [
            {
                "query": "filtered question",
                "top_k": 4,
                "workspace_id": "workspace-a",
                "filters": {"document_ids": ["doc-alpha"]},
            }
        ]

    def test_retrieval_cache_is_workspace_scoped_and_invalidated(self):
        calls: list[str | None] = []

        class FakeStore:
            def count_chunks(self, *, workspace_id=None):
                return 1

            def search(self, query, top_k=10, **kwargs):
                calls.append(kwargs.get("workspace_id"))
                return [
                    SearchHit(
                        Document(
                            page_content=f"Result for {kwargs.get('workspace_id')}",
                            metadata={"filename": "result.txt"},
                        ),
                        score=0.8,
                        method="test",
                    )
                ]

        retriever = HybridRetriever(  # type: ignore[arg-type]
            vector_store=FakeStore(),
            settings=Settings(_env_file=None, enable_cache=True),
        )
        retriever._transformer = type(
            "FakeTransformer",
            (),
            {"transform": lambda self, query, **kwargs: {"queries": [query]}},
        )()

        first = retriever.retrieve("cached question", workspace_id="workspace-a")
        cached = retriever.retrieve("cached question", workspace_id="workspace-a")
        other = retriever.retrieve("cached question", workspace_id="workspace-b")
        retriever.clear_cache(workspace_id="workspace-a")
        refreshed = retriever.retrieve("cached question", workspace_id="workspace-a")

        assert first["documents"][0].page_content == cached["documents"][0].page_content
        assert other["documents"][0].page_content == "Result for workspace-b"
        assert refreshed["documents"][0].page_content == "Result for workspace-a"
        assert calls == ["workspace-a", "workspace-b", "workspace-a"]

    def test_document_chunk_preview_is_workspace_scoped(self):
        vs = VectorStoreManager()
        vs.add_documents(
            [
                Document(
                    page_content="Alpha workspace contract renewal clause.",
                    metadata={"filename": "contract.txt", "chunk_index": 0},
                ),
                Document(
                    page_content="Alpha workspace payment schedule.",
                    metadata={"filename": "contract.txt", "chunk_index": 1},
                ),
            ],
            workspace_id="workspace-alpha",
            document_id="doc-alpha",
        )
        vs.add_documents(
            [
                Document(
                    page_content="Beta workspace confidential marker.",
                    metadata={"filename": "contract.txt", "chunk_index": 0},
                )
            ],
            workspace_id="workspace-beta",
            document_id="doc-beta",
        )

        alpha = vs.list_document_chunks("doc-alpha", workspace_id="workspace-alpha")
        searched = vs.list_document_chunks(
            "contract.txt",
            workspace_id="workspace-alpha",
            search="payment",
        )
        beta_from_alpha = vs.list_document_chunks("doc-beta", workspace_id="workspace-alpha")

        assert alpha["total"] == 2
        assert [chunk["chunk_index"] for chunk in alpha["chunks"]] == [0, 1]
        assert searched["total"] == 1
        assert searched["chunks"][0]["content"] == "Alpha workspace payment schedule."
        assert beta_from_alpha["total"] == 0

    def test_lightweight_sparse_matches_do_not_pad_with_dense_noise(self):
        vs = VectorStoreManager()
        sparse_doc = Document(
            page_content="Invoice MSPO1549 total amount 928 USD.",
            metadata={"filename": "Invoice_Anupam_Roy_MSPO1549.docx"},
        )
        dense_doc = Document(
            page_content="Unrelated voter card details.",
            metadata={"filename": "Voter_Card.pdf"},
        )

        results = vs._merge_sparse_first(
            sparse=[SearchHit(sparse_doc, score=3.5, method="sparse")],
            dense=[SearchHit(dense_doc, score=0.9, method="dense")],
            top_k=5,
        )

        assert [hit.document.metadata["filename"] for hit in results] == [
            "Invoice_Anupam_Roy_MSPO1549.docx"
        ]


def test_vector_store_maps_file_type_filters_to_qdrant_metadata() -> None:
    assert VectorStoreManager._qdrant_filters({"file_types": ["md", "pdf"]}) == {
        "metadata.file_type": ["md", "pdf"]
    }


def test_vector_store_maps_date_and_metadata_filters_to_qdrant() -> None:
    assert VectorStoreManager._qdrant_filters(
        {
            "uploaded_after_epoch": 100,
            "uploaded_before_epoch": 200,
            "metadata": {"department": "finance"},
        }
    ) == {
        "metadata.uploaded_at_epoch": {"gte": 100, "lte": 200},
        "metadata.department": "finance",
    }


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
