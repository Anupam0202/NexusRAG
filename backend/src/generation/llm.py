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
from dataclasses import dataclass, field
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
from src.generation.provider_keys import GEMINI_PROVIDER, get_provider_key_manager, key_fingerprint
from src.utils.exceptions import GenerationError, RateLimitError
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class _ScopedModelState:
    """Per-workspace model state for BYOK keys."""

    api_key_fingerprint: str
    candidates: list[str] = field(default_factory=list)
    model: Any = None
    model_name: str = ""
    had_quota_error: bool = False


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
        self._scoped_states: dict[tuple[str, str], _ScopedModelState] = {}

        # Build candidate list
        self._base_candidates = self._candidate_chain()
        self._candidates = list(self._base_candidates)

    def _candidate_chain(self) -> list[str]:
        s = self._settings
        fallbacks = s.llm_fallback_models.split(",") if hasattr(s, "llm_fallback_models") else []
        candidates_raw = getattr(s, "fallback_models", fallbacks)
        candidates = [s.llm_model_name] + [name.strip() for name in candidates_raw if name.strip()]

        seen = set()
        return [x for x in candidates if not (x in seen or seen.add(x))]

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

    def _scoped_state_and_key(
        self,
        workspace_id: str | None,
    ) -> tuple[_ScopedModelState | None, str]:
        """Return BYOK model state when a workspace key overrides the server key."""
        api_key = get_provider_key_manager().effective_api_key(
            workspace_id=workspace_id,
            provider=GEMINI_PROVIDER,
            settings=self._settings,
        )
        if not workspace_id or not api_key or api_key == self._settings.google_api_key:
            return None, api_key

        fingerprint = key_fingerprint(api_key)
        scoped_key = (workspace_id, fingerprint)
        state = self._scoped_states.get(scoped_key)
        if state is None:
            state = _ScopedModelState(
                api_key_fingerprint=fingerprint,
                candidates=list(self._base_candidates),
            )
            self._scoped_states[scoped_key] = state
        return state, api_key

    def _ensure_scoped_model(self, state: _ScopedModelState, api_key: str) -> None:
        if state.model is not None:
            return

        if not state.candidates:
            raise GenerationError("No LLM candidates available to instantiate.")

        s = self._settings

        from langchain_google_genai import ChatGoogleGenerativeAI

        while state.model is None and state.candidates:
            name = state.candidates[0]
            try:
                logger.info("loading_scoped_model", model=name)
                state.model = ChatGoogleGenerativeAI(
                    model=name,
                    temperature=s.llm_temperature,
                    max_tokens=s.llm_max_tokens,
                    top_p=s.llm_top_p,
                    top_k=s.llm_top_k,
                    google_api_key=api_key,
                    max_retries=0,
                )
                state.model_name = name
                logger.info("scoped_model_initialised", model=name)
            except Exception as exc:
                logger.warning("scoped_model_init_failed", model=name, error=str(exc))
                self._rotate_scoped_candidate(state, exc)

        if state.model is None:
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

    def _rotate_scoped_candidate(self, state: _ScopedModelState, exc: Exception) -> None:
        """Rotate a workspace-specific candidate chain without touching global state."""
        err_msg = str(exc).lower()
        if any(kw in err_msg for kw in ("429", "quota", "rate limit", "resource exhausted")):
            state.had_quota_error = True

        old_name = state.candidates.pop(0) if state.candidates else state.model_name
        state.model = None
        if not state.candidates:
            if state.had_quota_error:
                raise RateLimitError(
                    "All LLM candidates exhausted - quota exceeded on workspace key."
                )
            self._classify_and_raise(exc)
        logger.warning(
            "scoped_model_failover_initiated",
            failed_model=old_name,
            next_model=state.candidates[0],
            error=str(exc),
        )

    @property
    def model_name(self) -> str:
        self._ensure_model()
        return self._model_name

    def current_model_name(self, *, workspace_id: str | None = None) -> str:
        state, _api_key = self._scoped_state_and_key(workspace_id)
        if state is None:
            return self._model_name or self._settings.llm_model_name
        return state.model_name or self._settings.llm_model_name

    # ── Public API ────────────────────────────────────────────────────

    @retry(
        # RateLimitError is handled by the model failover loop, not tenacity.
        retry=retry_if_exception_type((GenerationError,)),
        stop=stop_after_attempt(2),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def invoke(self, prompt: str, *, workspace_id: str | None = None, **kwargs: Any) -> str:
        """Blocking LLM call runtime fallback logic."""
        scoped_state, api_key = self._scoped_state_and_key(workspace_id)
        if scoped_state is not None:
            while scoped_state.candidates:
                self._ensure_scoped_model(scoped_state, api_key)
                try:
                    resp = scoped_state.model.invoke(prompt, **kwargs)
                    return resp.content if hasattr(resp, "content") else str(resp)
                except Exception as exc:
                    self._rotate_scoped_candidate(scoped_state, exc)
            raise GenerationError("All LLM candidates exhausted on scoped invoke.")

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
    def invoke_messages(
        self,
        messages: list[BaseMessage],
        *,
        workspace_id: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Invoke with a list of LangChain messages."""
        scoped_state, api_key = self._scoped_state_and_key(workspace_id)
        if scoped_state is not None:
            while scoped_state.candidates:
                self._ensure_scoped_model(scoped_state, api_key)
                try:
                    resp = scoped_state.model.invoke(messages, **kwargs)
                    return resp.content if hasattr(resp, "content") else str(resp)
                except Exception as exc:
                    self._rotate_scoped_candidate(scoped_state, exc)
            raise GenerationError("All LLM candidates exhausted on scoped invoke_messages.")

        while self._candidates:
            self._ensure_model()
            try:
                resp = self._model.invoke(messages, **kwargs)  # type: ignore[union-attr]
                return resp.content if hasattr(resp, "content") else str(resp)  # type: ignore
            except Exception as exc:
                self._rotate_candidate(exc)
        raise GenerationError("All LLM candidates exhausted on invoke_messages.")

    async def stream(
        self,
        prompt: str,
        *,
        workspace_id: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """Async streaming with failover on the first chunk."""
        scoped_state, api_key = self._scoped_state_and_key(workspace_id)
        if scoped_state is not None:
            while scoped_state.candidates:
                self._ensure_scoped_model(scoped_state, api_key)
                try:
                    iterator = scoped_state.model.astream(prompt, **kwargs)
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
                    self._rotate_scoped_candidate(scoped_state, exc)
            raise GenerationError("All LLM candidates exhausted on scoped stream.")

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
        self,
        messages: list[BaseMessage],
        *,
        workspace_id: str | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[str]:
        """Async streaming with message list."""
        scoped_state, api_key = self._scoped_state_and_key(workspace_id)
        if scoped_state is not None:
            while scoped_state.candidates:
                self._ensure_scoped_model(scoped_state, api_key)
                try:
                    iterator = scoped_state.model.astream(messages, **kwargs)
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
                    self._rotate_scoped_candidate(scoped_state, exc)
            raise GenerationError("All LLM candidates exhausted on scoped stream_messages.")

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
