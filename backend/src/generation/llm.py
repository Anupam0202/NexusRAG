"""
Multi-Provider LLM Abstraction
===============================

Wraps LangChain's ``ChatGoogleGenerativeAI`` with:

* Automatic fallback chain across multiple model names.
* Fail-fast model calls with controlled fallback and lightweight tenacity retries.
* Streaming support (returns an ``AsyncIterator[str]``).
* Graceful quota / auth error detection with custom exceptions.
* Runtime model failover (rotates model if hitting quota limits on stream/invoke).

The ``LLMProvider`` is a singleton obtained through ``get_llm_provider()``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache
from typing import Any

from langchain_core.messages import BaseMessage
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
    """Unified LLM access with runtime fallback chain and streaming.

    Usage::

        provider = get_llm_provider()
        # Blocking call
        text = provider.invoke("Hello")
        # Streaming
        async for token in provider.stream("Hello"):
            print(token, end="")
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._model = None
        self._model_name: str = ""
        self._had_quota_error: bool = False  # track if any candidate hit quota

        # Build candidate list
        s = self._settings
        fallbacks = s.llm_fallback_models.split(",") if hasattr(s, "llm_fallback_models") else []
        candidates_raw = getattr(s, "fallback_models", fallbacks)
        candidates = [s.llm_model_name] + [name.strip() for name in candidates_raw if name.strip()]

        seen = set()
        self._candidates = [x for x in candidates if not (x in seen or seen.add(x))]

    # ── Lazy model initialisation ─────────────────────────────────────

    def _ensure_model(self) -> None:
        if self._model is not None:
            return

        if not self._candidates:
            raise GenerationError("No LLM candidates available to instantiate.")

        s = self._settings

        from langchain_google_genai import ChatGoogleGenerativeAI

        while self._model is None and self._candidates:
            name = self._candidates[0]  # Active candidate is the head of the list

            try:
                logger.info("loading_model", model=name)
                model = ChatGoogleGenerativeAI(
                    model=name,
                    temperature=s.llm_temperature,
                    max_tokens=s.llm_max_tokens,
                    top_p=s.llm_top_p,
                    top_k=s.llm_top_k,
                    google_api_key=s.google_api_key,
                    max_retries=0,
                )
                self._model = model
                self._model_name = name
                logger.info("model_initialised", model=name)
            except Exception as exc:
                logger.warning("model_init_failed", model=name, error=str(exc))
                self._rotate_candidate(exc)

        if self._model is None:
            raise GenerationError("No LLM candidates could be instantiated.")

    def _rotate_candidate(self, exc: Exception) -> None:
        """Removes the failing candidate and resets the model for failover."""
        # Track if any candidate hit quota — used to give better error when all fail
        err_msg = str(exc).lower()
        if any(kw in err_msg for kw in ("429", "quota", "rate limit", "resource exhausted")):
            self._had_quota_error = True

        old_name = self._candidates.pop(0) if self._candidates else self._model_name
        self._model = None
        if not self._candidates:
            # If quota was the root cause, surface that so the UI shows the API key modal
            if self._had_quota_error:
                raise RateLimitError(
                    "All LLM candidates exhausted — quota exceeded on primary model."
                )
            self._classify_and_raise(exc)
        logger.warning(
            "model_failover_initiated",
            failed_model=old_name,
            next_model=self._candidates[0],
            error=str(exc),
        )

    @property
    def model_name(self) -> str:
        self._ensure_model()
        return self._model_name

    # ── Public API ────────────────────────────────────────────────────

    @retry(
        # RateLimitError is handled by the model failover loop, not tenacity.
        retry=retry_if_exception_type((GenerationError,)),
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def invoke(self, prompt: str, **kwargs: Any) -> str:
        """Blocking LLM call runtime fallback logic."""
        while self._candidates:
            self._ensure_model()
            try:
                resp = self._model.invoke(prompt, **kwargs)  # type: ignore[union-attr]
                return resp.content if hasattr(resp, "content") else str(resp)  # type: ignore
            except Exception as exc:
                self._rotate_candidate(exc)
        raise GenerationError("All LLM candidates exhausted on invoke.")

    @retry(
        retry=retry_if_exception_type((GenerationError,)),
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def invoke_messages(self, messages: list[BaseMessage], **kwargs: Any) -> str:
        """Invoke with a list of LangChain messages."""
        while self._candidates:
            self._ensure_model()
            try:
                resp = self._model.invoke(messages, **kwargs)  # type: ignore[union-attr]
                return resp.content if hasattr(resp, "content") else str(resp)  # type: ignore
            except Exception as exc:
                self._rotate_candidate(exc)
        raise GenerationError("All LLM candidates exhausted on invoke_messages.")

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        """Async streaming — failover catches errors on first chunk."""
        while self._candidates:
            self._ensure_model()
            try:
                iterator = self._model.astream(prompt, **kwargs)  # type: ignore[union-attr]
                first_chunk = await iterator.__anext__()
                token = self._extract_token(first_chunk)
                if token:
                    yield token

                # If the first chunk succeeds, the model is working. Yield the rest.
                async for chunk in iterator:
                    token = self._extract_token(chunk)
                    if token:
                        yield token
                return  # Success, exit stream
            except StopAsyncIteration:
                return  # Empty stream
            except Exception as exc:
                self._rotate_candidate(exc)
        raise GenerationError("All LLM candidates exhausted on stream.")

    async def stream_messages(
        self, messages: list[BaseMessage], **kwargs: Any
    ) -> AsyncIterator[str]:
        """Async streaming with message list."""
        while self._candidates:
            self._ensure_model()
            try:
                iterator = self._model.astream(messages, **kwargs)  # type: ignore[union-attr]
                first_chunk = await iterator.__anext__()
                token = self._extract_token(first_chunk)
                if token:
                    yield token

                async for chunk in iterator:
                    token = self._extract_token(chunk)
                    if token:
                        yield token
                return
            except StopAsyncIteration:
                return
            except Exception as exc:
                self._rotate_candidate(exc)
        raise GenerationError("All LLM candidates exhausted on stream_messages.")

    @staticmethod
    def _extract_token(chunk: Any) -> str:
        """Robustly extract text from a streaming chunk."""
        if hasattr(chunk, "content"):
            content = chunk.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
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
