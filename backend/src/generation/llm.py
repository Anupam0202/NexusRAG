"""
Multi-Provider LLM Abstraction
===============================

Wraps LangChain's ``ChatGoogleGenerativeAI`` with:

* Automatic fallback chain across multiple model names.
* Retry with exponential back-off (via ``tenacity``).
* Streaming support (returns an ``AsyncIterator[str]``).
* Graceful quota / auth error detection with custom exceptions.

The ``LLMProvider`` is a singleton obtained through ``get_llm_provider()``.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache
from typing import Any, AsyncIterator, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.outputs import ChatGenerationChunk
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config.settings import Settings, get_settings
from src.utils.exceptions import GenerationError, RateLimitError
from src.utils.logger import get_logger

logger = get_logger(__name__)


class LLMProvider:
    """Unified LLM access with fallback chain and streaming.

    Usage::

        provider = get_llm_provider()
        # Blocking call
        text = provider.invoke("Hello")
        # Streaming
        async for token in provider.stream("Hello"):
            print(token, end="")
    """

    def __init__(self, settings: Optional[Settings] = None) -> None:
        self._settings = settings or get_settings()
        self._model = None
        self._model_name: str = ""

    # ── Lazy model initialisation ─────────────────────────────────────

    def _ensure_model(self) -> None:
        if self._model is not None:
            return

        from langchain_google_genai import ChatGoogleGenerativeAI

        s = self._settings
        candidates: list[str] = [s.llm_model_name] + list(s.fallback_models)
        # Deduplicate, preserving order
        seen: set[str] = set()
        unique: list[str] = []
        for m in candidates:
            name = str(m).strip()
            if name and name not in seen:
                seen.add(name)
                unique.append(name)

        # Try to instantiate the model — NO smoke test to save API calls.
        # On the free tier every request counts.
        for name in unique:
            try:
                logger.info("trying_model", model=name)
                model = ChatGoogleGenerativeAI(
                    model=name,
                    temperature=s.llm_temperature,
                    max_tokens=s.llm_max_tokens,
                    top_p=s.llm_top_p,
                    top_k=s.llm_top_k,
                    google_api_key=s.google_api_key,
                )
                self._model = model
                self._model_name = name
                logger.info("model_initialised", model=name)
                return
            except Exception as exc:
                logger.warning("model_init_failed", model=name, error=str(exc))

        raise GenerationError(
            f"All LLM candidates failed to instantiate",
            details={"tried": unique},
        )

    @property
    def model_name(self) -> str:
        self._ensure_model()
        return self._model_name

    # ── Public API ────────────────────────────────────────────────────

    @retry(
        retry=retry_if_exception_type((GenerationError,)),  # Do NOT retry RateLimitError
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def invoke(self, prompt: str, **kwargs: Any) -> str:
        """Blocking LLM call. Returns the full response text."""
        self._ensure_model()
        try:
            resp = self._model.invoke(prompt, **kwargs)  # type: ignore[union-attr]
            return resp.content if hasattr(resp, "content") else str(resp)
        except Exception as exc:
            self._classify_and_raise(exc)
            raise  # unreachable but keeps mypy happy

    @retry(
        retry=retry_if_exception_type((GenerationError,)),  # Do NOT retry RateLimitError
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def invoke_messages(self, messages: List[BaseMessage], **kwargs: Any) -> str:
        """Invoke with a list of LangChain messages."""
        self._ensure_model()
        try:
            resp = self._model.invoke(messages, **kwargs)  # type: ignore[union-attr]
            return resp.content if hasattr(resp, "content") else str(resp)
        except Exception as exc:
            self._classify_and_raise(exc)
            raise

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        """Async streaming — yields text tokens as they arrive."""
        self._ensure_model()
        try:
            async for chunk in self._model.astream(prompt, **kwargs):  # type: ignore[union-attr]
                token = self._extract_token(chunk)
                if token:
                    yield token
        except Exception as exc:
            self._classify_and_raise(exc)

    async def stream_messages(
        self, messages: List[BaseMessage], **kwargs: Any
    ) -> AsyncIterator[str]:
        """Async streaming with message list."""
        self._ensure_model()
        try:
            async for chunk in self._model.astream(messages, **kwargs):  # type: ignore[union-attr]
                token = self._extract_token(chunk)
                if token:
                    yield token
        except Exception as exc:
            self._classify_and_raise(exc)

    @staticmethod
    def _extract_token(chunk: Any) -> str:
        """Robustly extract text from a streaming chunk.

        Google GenAI may return ``content`` as a string or as a list of
        ``Part`` objects. This helper normalises both cases.
        """
        if hasattr(chunk, "content"):
            content = chunk.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                # list of Part objects — join text from each
                parts = []
                for part in content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif hasattr(part, "text"):
                        parts.append(part.text)
                    else:
                        parts.append(str(part))
                return "".join(parts)
            return str(content) if content else ""
        if isinstance(chunk, str):
            return chunk
        return ""

    # ── Runtime configuration ─────────────────────────────────────────

    def update_temperature(self, temp: float) -> None:
        if self._model is not None:
            self._model.temperature = temp  # type: ignore[union-attr]
            logger.info("temperature_updated", temperature=temp)

    # ── Error classification ──────────────────────────────────────────

    @staticmethod
    def _classify_and_raise(exc: Exception) -> None:
        msg = str(exc).lower()
        if any(kw in msg for kw in ("429", "quota", "rate limit", "resource exhausted")):
            raise RateLimitError(f"LLM rate limit: {exc}") from exc
        if any(kw in msg for kw in ("401", "403", "invalid", "api key")):
            raise GenerationError(f"LLM auth error: {exc}") from exc
        raise GenerationError(f"LLM error: {exc}") from exc


@lru_cache(maxsize=1)
def get_llm_provider() -> LLMProvider:
    """Singleton ``LLMProvider``."""
    return LLMProvider()