"""
Tests for the generation module (non-LLM parts).
"""

from __future__ import annotations

import sys
from types import SimpleNamespace

from config.settings import Settings
from src.generation.llm import LLMProvider
from src.generation.memory import ConversationMemory, SessionMemoryStore
from src.generation.prompts import PromptManager


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
