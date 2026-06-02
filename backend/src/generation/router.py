"""Workspace-aware LLM routing, health, and quota primitives."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any

from config.settings import Settings
from src.generation.provider_keys import GEMINI_PROVIDER, get_provider_key_manager, key_fingerprint
from src.utils.exceptions import GenerationError


class ProviderMode(StrEnum):
    SERVER_DEFAULT_KEY = "server_default_key"
    WORKSPACE_BYOK_KEY = "workspace_byok_key"
    EXTRACTIVE_ONLY = "extractive_only"


@dataclass(frozen=True)
class ModelPolicy:
    max_input_tokens: int = 24_000
    max_output_tokens: int = 8_192
    workspace_daily_token_limit: int = 250_000
    user_daily_token_limit: int = 75_000
    circuit_breaker_failures: int = 2
    circuit_breaker_cooldown_seconds: int = 300

    def estimate_tokens(self, value: str) -> int:
        # Conservative approximation for quota guards without a tokenizer dependency.
        return max(1, len(value) // 4)


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    model: str
    mode: ProviderMode
    api_key_fingerprint: str
    max_input_tokens: int
    max_output_tokens: int


@dataclass
class ProviderHealth:
    provider: str
    model: str
    mode: ProviderMode
    consecutive_failures: int = 0
    quota_exhausted: bool = False
    last_error_code: str | None = None
    circuit_open_until: datetime | None = None
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def circuit_open(self) -> bool:
        return bool(self.circuit_open_until and self.circuit_open_until > datetime.now(UTC))


@dataclass
class UsageRecord:
    workspace_id: str
    user_id: str | None
    provider: str
    model: str
    input_tokens: int
    output_tokens: int
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


class ProviderUsageLedger:
    """Small in-memory quota guard used before durable billing is introduced."""

    def __init__(self, policy: ModelPolicy | None = None) -> None:
        self._policy = policy or ModelPolicy()
        self._records: list[UsageRecord] = []

    def _today(self) -> list[UsageRecord]:
        today = datetime.now(UTC).date()
        return [record for record in self._records if record.created_at.date() == today]

    def can_consume(
        self,
        *,
        workspace_id: str,
        user_id: str | None,
        input_tokens: int,
        output_tokens: int,
    ) -> bool:
        requested = input_tokens + output_tokens
        today = self._today()
        workspace_total = sum(
            record.input_tokens + record.output_tokens
            for record in today
            if record.workspace_id == workspace_id
        )
        user_total = sum(
            record.input_tokens + record.output_tokens
            for record in today
            if user_id and record.user_id == user_id
        )
        return (
            workspace_total + requested <= self._policy.workspace_daily_token_limit
            and user_total + requested <= self._policy.user_daily_token_limit
        )

    def record(self, record: UsageRecord) -> None:
        self._records.append(record)


class LLMRouter:
    """Choose provider/model candidates without mutating global key state."""

    def __init__(
        self,
        settings: Settings,
        *,
        policy: ModelPolicy | None = None,
        usage_ledger: ProviderUsageLedger | None = None,
    ) -> None:
        self.settings = settings
        self.policy = policy or ModelPolicy(max_output_tokens=settings.llm_max_tokens)
        self.usage_ledger = usage_ledger or ProviderUsageLedger(self.policy)
        self._health: dict[tuple[str, str, ProviderMode, str], ProviderHealth] = {}

    def model_candidates(self) -> list[str]:
        fallbacks = (
            self.settings.llm_fallback_models.split(",")
            if hasattr(self.settings, "llm_fallback_models")
            else []
        )
        candidates_raw = getattr(self.settings, "fallback_models", fallbacks)
        candidates = [self.settings.llm_model_name] + [
            name.strip() for name in candidates_raw if name.strip()
        ]
        return list(dict.fromkeys(candidates))

    def effective_api_key(self, *, workspace_id: str | None) -> str:
        return get_provider_key_manager().effective_api_key(
            workspace_id=workspace_id,
            provider=GEMINI_PROVIDER,
            settings=self.settings,
        )

    def mode_for_workspace(self, *, workspace_id: str | None, api_key: str) -> ProviderMode:
        if not api_key:
            return ProviderMode.EXTRACTIVE_ONLY
        if workspace_id and api_key != self.settings.google_api_key:
            return ProviderMode.WORKSPACE_BYOK_KEY
        return ProviderMode.SERVER_DEFAULT_KEY

    def configs_for_workspace(self, *, workspace_id: str | None) -> list[ProviderConfig]:
        api_key = self.effective_api_key(workspace_id=workspace_id)
        mode = self.mode_for_workspace(workspace_id=workspace_id, api_key=api_key)
        if mode == ProviderMode.EXTRACTIVE_ONLY:
            return []
        fingerprint = key_fingerprint(api_key)
        return [
            ProviderConfig(
                provider=GEMINI_PROVIDER,
                model=model,
                mode=mode,
                api_key_fingerprint=fingerprint,
                max_input_tokens=self.policy.max_input_tokens,
                max_output_tokens=self.policy.max_output_tokens,
            )
            for model in self.model_candidates()
            if self.is_available(
                provider=GEMINI_PROVIDER,
                model=model,
                mode=mode,
                api_key_fingerprint=fingerprint,
            )
        ]

    def ensure_prompt_allowed(
        self,
        prompt: str,
        *,
        workspace_id: str | None,
        user_id: str | None = None,
    ) -> None:
        input_tokens = self.policy.estimate_tokens(prompt)
        if input_tokens > self.policy.max_input_tokens:
            raise GenerationError(
                f"Prompt is too large for the configured model policy ({input_tokens} tokens)."
            )
        scoped_workspace = workspace_id or "default"
        if not self.usage_ledger.can_consume(
            workspace_id=scoped_workspace,
            user_id=user_id,
            input_tokens=input_tokens,
            output_tokens=self.policy.max_output_tokens,
        ):
            raise GenerationError("Workspace or user LLM quota has been reached.")

    def _health_key(
        self,
        *,
        provider: str,
        model: str,
        mode: ProviderMode,
        api_key_fingerprint: str,
    ) -> tuple[str, str, ProviderMode, str]:
        return (provider, model, mode, api_key_fingerprint)

    def health_for(self, config: ProviderConfig) -> ProviderHealth:
        key = self._health_key(
            provider=config.provider,
            model=config.model,
            mode=config.mode,
            api_key_fingerprint=config.api_key_fingerprint,
        )
        if key not in self._health:
            self._health[key] = ProviderHealth(
                provider=config.provider,
                model=config.model,
                mode=config.mode,
            )
        return self._health[key]

    def is_available(
        self,
        *,
        provider: str,
        model: str,
        mode: ProviderMode,
        api_key_fingerprint: str,
    ) -> bool:
        health = self._health.get(
            self._health_key(
                provider=provider,
                model=model,
                mode=mode,
                api_key_fingerprint=api_key_fingerprint,
            )
        )
        return not health or not health.circuit_open

    def record_success(self, config: ProviderConfig) -> None:
        health = self.health_for(config)
        health.consecutive_failures = 0
        health.quota_exhausted = False
        health.last_error_code = None
        health.circuit_open_until = None
        health.updated_at = datetime.now(UTC)

    def record_failure(self, config: ProviderConfig, exc: Exception) -> None:
        health = self.health_for(config)
        message = str(exc).lower()
        is_quota = any(
            marker in message for marker in ("429", "quota", "rate limit", "resource exhausted")
        )
        health.consecutive_failures += 1
        health.quota_exhausted = is_quota
        health.last_error_code = "quota" if is_quota else "provider_error"
        health.updated_at = datetime.now(UTC)
        if (
            is_quota
            or health.consecutive_failures >= self.policy.circuit_breaker_failures
        ):
            health.circuit_open_until = datetime.now(UTC) + timedelta(
                seconds=self.policy.circuit_breaker_cooldown_seconds
            )

    def health_snapshot(self) -> list[dict[str, Any]]:
        return [
            {
                "provider": health.provider,
                "model": health.model,
                "mode": health.mode.value,
                "consecutive_failures": health.consecutive_failures,
                "quota_exhausted": health.quota_exhausted,
                "last_error_code": health.last_error_code,
                "circuit_open": health.circuit_open,
                "circuit_open_until": (
                    health.circuit_open_until.isoformat()
                    if health.circuit_open_until
                    else None
                ),
            }
            for health in self._health.values()
        ]
