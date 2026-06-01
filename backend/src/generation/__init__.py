"""Generation package exports.

Exports are resolved lazily so importing a leaf module such as
``src.generation.provider_keys`` does not eagerly load the full RAG chain and
create circular imports with retrieval modules.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "LLMProvider",
    "get_llm_provider",
    "PromptManager",
    "RAGChain",
    "ConversationMemory",
    "SessionMemoryStore",
]


def __getattr__(name: str) -> Any:
    if name == "RAGChain":
        from src.generation.chain import RAGChain

        return RAGChain
    if name in {"LLMProvider", "get_llm_provider"}:
        from src.generation.llm import LLMProvider, get_llm_provider

        return {"LLMProvider": LLMProvider, "get_llm_provider": get_llm_provider}[name]
    if name in {"ConversationMemory", "SessionMemoryStore"}:
        from src.generation.memory import ConversationMemory, SessionMemoryStore

        return {
            "ConversationMemory": ConversationMemory,
            "SessionMemoryStore": SessionMemoryStore,
        }[name]
    if name == "PromptManager":
        from src.generation.prompts import PromptManager

        return PromptManager
    raise AttributeError(f"module 'src.generation' has no attribute {name!r}")
