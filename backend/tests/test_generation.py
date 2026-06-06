"""
Tests for the generation module (non-LLM parts).
"""

from __future__ import annotations

import sys
from types import SimpleNamespace

from langchain_core.documents import Document

from config.settings import Settings
from src.generation.chain import RAGChain
from src.generation.llm import LLMProvider
from src.generation.memory import ConversationMemory, SessionMemoryStore
from src.generation.prompts import PromptManager
from src.generation.provider_keys import get_provider_key_manager
from src.generation.router import LLMRouter, ModelPolicy, ProviderUsageLedger, UsageRecord
from src.retrieval.cache import SemanticCache
from src.retrieval.retriever import QueryType


class TestConversationMemory:
    def test_add_and_retrieve(self):
        mem = ConversationMemory()
        mem.add("user", "Hello")
        mem.add("assistant", "Hi there!")
        msgs = mem.get_context_messages()
        assert len(msgs) == 2
        assert msgs[0]["role"] == "user"

    def test_formatted_history(self):
        mem = ConversationMemory()
        mem.add("user", "What is AI?")
        mem.add("assistant", "AI is artificial intelligence.")
        history = mem.get_formatted_history()
        assert "User:" in history
        assert "Assistant:" in history

    def test_clear(self):
        mem = ConversationMemory()
        mem.add("user", "test")
        mem.clear()
        assert mem.length == 0

    def test_empty_history(self):
        mem = ConversationMemory()
        assert mem.get_formatted_history() == "No previous conversation."


class TestSessionMemoryStore:
    def test_get_creates_session(self):
        store = SessionMemoryStore(ttl_seconds=60)
        mem = store.get("session-1")
        assert isinstance(mem, ConversationMemory)
        assert store.active_sessions == 1

    def test_delete_session(self):
        store = SessionMemoryStore()
        store.get("s1")
        store.delete("s1")
        assert store.active_sessions == 0


class TestPromptManager:
    def test_render_rag(self):
        pm = PromptManager()
        result = pm.render_rag(context="ctx", history="hist", question="q")
        assert "ctx" in result
        assert "hist" in result
        assert "q" in result

    def test_render_system(self):
        text = PromptManager.render_system()
        assert "ONLY" in text
        assert "Source" in text


class TestLLMProvider:
    def test_default_candidate_chain_starts_with_current_gemini_model(self):
        settings = Settings(_env_file=None, google_api_key="test-key")
        provider = LLMProvider(settings)

        assert provider._candidates == [
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
            "gemini-2.0-flash-lite",
        ]
        assert "gemini-1.5-pro" not in provider._candidates

    def test_langchain_google_provider_retries_are_disabled(self, monkeypatch):
        calls: list[dict] = []

        class FakeChatGoogleGenerativeAI:
            def __init__(self, **kwargs):
                calls.append(kwargs)

        monkeypatch.setitem(
            sys.modules,
            "langchain_google_genai",
            SimpleNamespace(ChatGoogleGenerativeAI=FakeChatGoogleGenerativeAI),
        )

        settings = Settings(
            _env_file=None,
            google_api_key="test-key",
            llm_model_name="gemini-2.5-flash",
            llm_fallback_models="",
        )
        provider = LLMProvider(settings)

        provider._ensure_model()

        assert calls[0]["model"] == "gemini-2.5-flash"
        assert calls[0]["max_retries"] == 0

    def test_workspace_key_uses_scoped_model_without_mutating_default_key(self, monkeypatch):
        calls: list[dict] = []

        class FakeResponse:
            content = "scoped answer"

        class FakeChatGoogleGenerativeAI:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
                calls.append(kwargs)

            def invoke(self, *_args, **_kwargs):
                return FakeResponse()

        monkeypatch.setitem(
            sys.modules,
            "langchain_google_genai",
            SimpleNamespace(ChatGoogleGenerativeAI=FakeChatGoogleGenerativeAI),
        )
        get_provider_key_manager.cache_clear()
        manager = get_provider_key_manager()
        manager.store_key(
            workspace_id="workspace-a",
            user_id="user-a",
            provider="gemini",
            api_key="workspace-key",
        )

        try:
            settings = Settings(_env_file=None, google_api_key="server-key")
            provider = LLMProvider(settings)

            result = provider.invoke("hello", workspace_id="workspace-a")

            assert result == "scoped answer"
            assert calls[0]["google_api_key"] == "workspace-key"
            assert settings.google_api_key == "server-key"
            assert provider._candidates[0] == "gemini-2.5-flash"
        finally:
            get_provider_key_manager.cache_clear()


class TestLLMRouter:
    def test_workspace_byok_is_selected_before_server_default(self):
        get_provider_key_manager.cache_clear()
        manager = get_provider_key_manager()
        manager.store_key(
            workspace_id="workspace-a",
            user_id="user-a",
            provider="gemini",
            api_key="workspace-key",
        )
        try:
            router = LLMRouter(Settings(_env_file=None, google_api_key="server-key"))
            configs = router.configs_for_workspace(workspace_id="workspace-a")

            assert configs
            assert configs[0].mode == "workspace_byok_key"
            assert configs[0].provider == "gemini"
            assert configs[0].api_key_fingerprint
        finally:
            get_provider_key_manager.cache_clear()

    def test_router_circuit_breaker_removes_unhealthy_model(self):
        router = LLMRouter(Settings(_env_file=None, google_api_key="server-key"))
        first = router.configs_for_workspace(workspace_id=None)[0]

        router.record_failure(first, RuntimeError("429 RESOURCE_EXHAUSTED"))
        next_configs = router.configs_for_workspace(workspace_id=None)

        assert first.model not in [config.model for config in next_configs]
        assert router.health_snapshot()[0]["quota_exhausted"] is True
        assert router.health_snapshot()[0]["circuit_open"] is True

    def test_usage_ledger_enforces_workspace_and_user_budget(self):
        policy = ModelPolicy(workspace_daily_token_limit=10, user_daily_token_limit=8)
        ledger = ProviderUsageLedger(policy)
        ledger.record(
            UsageRecord(
                workspace_id="workspace-a",
                user_id="user-a",
                provider="gemini",
                model="gemini-2.5-flash",
                input_tokens=5,
                output_tokens=3,
            )
        )

        assert ledger.can_consume(
            workspace_id="workspace-a",
            user_id="user-a",
            input_tokens=1,
            output_tokens=1,
        ) is False
        assert ledger.can_consume(
            workspace_id="workspace-b",
            user_id="user-b",
            input_tokens=1,
            output_tokens=1,
        ) is True


class TestRAGChain:
    def test_document_inventory_query_includes_all_uploaded_filenames(self, monkeypatch):
        class FakeRetriever:
            def retrieve(self, *args, **kwargs):
                return {
                    "documents": [
                        Document(
                            page_content="Annapurna Yojana family-level form fields.",
                            metadata={
                                "filename": "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf"
                            },
                        )
                    ],
                    "query_type": QueryType.LIST_ALL,
                    "k_used": 2,
                    "transformed_queries": ["Which uploaded files are available?"],
                }

        class FakeLLM:
            _model_name = "fake-model"

            def invoke_messages(self, messages):
                return messages[-1].content

        vector_store = SimpleNamespace(
            list_documents=lambda: [
                {
                    "filename": "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf",
                    "file_type": "pdf",
                    "chunk_count": 51,
                    "page_count": 11,
                    "file_size_bytes": 482442,
                },
                {
                    "filename": "PlantPal_new_features.txt",
                    "file_type": "text",
                    "chunk_count": 1,
                    "page_count": 0,
                    "file_size_bytes": 80417,
                },
            ]
        )
        monkeypatch.setattr("src.generation.chain.get_llm_provider", lambda: FakeLLM())

        chain = RAGChain(vector_store=vector_store, settings=Settings(_env_file=None))
        chain._retriever = FakeRetriever()

        result = chain.query("Which uploaded files are available?")

        assert "PlantPal_new_features.txt" in result["answer"]
        assert "Annapurna_Yojana_Family_Level_Data_Collection_Form.pdf" in result["answer"]
        assert result["sources"][0]["filename"] == "NexusRAG Document Library"

    def test_query_returns_extractive_fallback_when_generation_fails(self, monkeypatch):
        class FakeRetriever:
            def retrieve(self, *args, **kwargs):
                return {
                    "documents": [
                        Document(
                            page_content="Invoice MSPO1549 total amount 928 USD.",
                            metadata={"filename": "Invoice_Anupam_Roy_MSPO1549.docx"},
                        )
                    ],
                    "query_type": QueryType.SPECIFIC,
                    "k_used": 1,
                    "transformed_queries": ["invoice"],
                }

        class FakeLLM:
            _model_name = "fake-model"

            def invoke_messages(self, messages):
                raise RuntimeError("All LLM candidates exhausted on invoke_messages.")

        monkeypatch.setattr("src.generation.chain.get_llm_provider", lambda: FakeLLM())

        chain = RAGChain(vector_store=SimpleNamespace(), settings=Settings(_env_file=None))
        chain._retriever = FakeRetriever()

        result = chain.query("Summarize invoice MSPO1549")

        assert "temporarily unavailable" in result["answer"]
        assert "Invoice MSPO1549 total amount 928 USD" in result["answer"]
        assert result["sources"][0]["filename"] == "Invoice_Anupam_Roy_MSPO1549.docx"
        assert result["metadata"]["generation_fallback"] is True

    def test_cache_and_memory_are_scoped_by_workspace(self, monkeypatch):
        calls: list[str | None] = []

        class FakeRetriever:
            def retrieve(self, *args, **kwargs):
                workspace_id = kwargs.get("workspace_id")
                calls.append(workspace_id)
                return {
                    "documents": [
                        Document(
                            page_content=f"Private marker for {workspace_id}.",
                            metadata={
                                "filename": "private.txt",
                                "workspace_id": workspace_id,
                                "score": 0.9,
                            },
                        )
                    ],
                    "query_type": QueryType.SPECIFIC,
                    "k_used": 1,
                    "transformed_queries": ["marker"],
                }

        class FakeLLM:
            _model_name = "fake-model"

            def invoke_messages(self, messages):
                return messages[-1].content

        monkeypatch.setattr("src.generation.chain.get_llm_provider", lambda: FakeLLM())

        chain = RAGChain(
            vector_store=SimpleNamespace(),
            settings=Settings(_env_file=None, enable_cache=True),
        )
        chain._retriever = FakeRetriever()

        first = chain.query("What is the private marker?", workspace_id="workspace-a")
        second = chain.query("What is the private marker?", workspace_id="workspace-b")
        cached = chain.query("What is the private marker?", workspace_id="workspace-a")

        assert calls == ["workspace-a", "workspace-b"]
        assert "workspace-a" in first["answer"]
        assert "workspace-b" in second["answer"]
        assert cached["from_cache"] is True

    def test_cache_is_isolated_by_retrieval_filter_namespace(self, monkeypatch):
        cache = SemanticCache(settings=Settings(_env_file=None, enable_cache=True))

        class FakeEmbedder:
            def embed_query(self, _query: str):
                return [1.0, 0.0, 0.0]

        cache._embedder = FakeEmbedder()
        cache.set(
            "What is the policy?",
            {"answer": "Workspace answer"},
            workspace_id="workspace-a",
            namespace="workspace",
        )

        assert cache.get(
            "What is the policy?",
            workspace_id="workspace-a",
            namespace="documents:doc-alpha",
        ) is None
        assert cache.get(
            "What is the policy?",
            workspace_id="workspace-a",
            namespace="workspace",
        )["answer"] == "Workspace answer"

    def test_query_includes_answer_quality_metadata_and_filters(self, monkeypatch):
        calls: list[dict] = []

        class FakeRetriever:
            def retrieve(self, *args, **kwargs):
                calls.append(kwargs)
                return {
                    "documents": [
                        Document(
                            page_content="The policy requires invoice approval before payment.",
                            metadata={
                                "filename": "policy.pdf",
                                "document_id": "doc-alpha",
                                "page_number": 2,
                                "score": 0.86,
                            },
                        )
                    ],
                    "query_type": QueryType.SPECIFIC,
                    "k_used": 1,
                    "transformed_queries": ["policy"],
                }

        class FakeLLM:
            _model_name = "fake-model"

            def invoke_messages(self, _messages):
                return "The policy requires invoice approval before payment."

        monkeypatch.setattr("src.generation.chain.get_llm_provider", lambda: FakeLLM())
        chain = RAGChain(
            vector_store=SimpleNamespace(),
            settings=Settings(_env_file=None, enable_cache=True),
        )
        chain._retriever = FakeRetriever()

        result = chain.query(
            "What does the policy require?",
            workspace_id="workspace-a",
            retrieval_filters={"document_ids": ["doc-alpha"], "min_page": 2},
        )

        assert calls[0]["filters"] == {"document_ids": ["doc-alpha"], "min_page": 2}
        assert result["metadata"]["retrieval_scope"] == "documents"
        assert result["metadata"]["selected_document_ids"] == ["doc-alpha"]
        assert result["metadata"]["answerability"] == "answerable"
        assert result["metadata"]["source_quote_coverage"] > 0
        assert result["metadata"]["citation_coverage"] == 1.0

    def test_source_verification_cache_is_workspace_scoped_and_clearable(self):
        chain = RAGChain(
            vector_store=SimpleNamespace(),
            settings=Settings(_env_file=None, enable_cache=True),
        )
        docs = [
            Document(
                page_content="The policy requires invoice approval before payment.",
                metadata={"filename": "policy.pdf", "page_number": 2},
            )
        ]
        answer = "The policy requires invoice approval before payment."

        first = chain._source_quote_checks(
            answer=answer,
            docs=docs,
            workspace_id="workspace-a",
        )
        misses = chain._layer_cache.misses
        second = chain._source_quote_checks(
            answer=answer,
            docs=docs,
            workspace_id="workspace-a",
        )
        assert second == first
        assert chain._layer_cache.hits >= 1

        chain._source_quote_checks(
            answer=answer,
            docs=docs,
            workspace_id="workspace-b",
        )
        assert chain._layer_cache.misses > misses

        chain.clear_cache(workspace_id="workspace-a")
        misses = chain._layer_cache.misses
        chain._source_quote_checks(
            answer=answer,
            docs=docs,
            workspace_id="workspace-a",
        )
        assert chain._layer_cache.misses > misses
