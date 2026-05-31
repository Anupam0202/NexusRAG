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
