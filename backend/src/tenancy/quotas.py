"""Workspace quota enforcement and dashboard payloads."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from config.settings import Settings
from src.telemetry.events import get_telemetry_recorder


@dataclass(frozen=True)
class QuotaLimits:
    daily_queries: int
    daily_tokens: int
    max_documents: int
    max_storage_bytes: int


@dataclass(frozen=True)
class QuotaUsage:
    queries_today: int = 0
    tokens_today: int = 0
    documents: int = 0
    storage_bytes: int = 0


class QuotaExceededError(Exception):
    """Raised when a workspace exceeds a configured quota."""

    def __init__(self, message: str, *, payload: dict[str, Any]) -> None:
        super().__init__(message)
        self.payload = payload


class TenantQuotaEnforcer:
    """Applies workspace quota limits for chat and ingestion."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.limits = QuotaLimits(
            daily_queries=settings.quota_daily_queries,
            daily_tokens=settings.quota_daily_tokens,
            max_documents=settings.quota_max_documents,
            max_storage_bytes=settings.quota_max_storage_mb * 1024 * 1024,
        )

    @property
    def enabled(self) -> bool:
        return bool(self._settings.enforce_tenant_quotas)

    async def usage(
        self,
        *,
        workspace_id: str,
        persist: bool,
        documents: list[dict[str, Any]] | None = None,
    ) -> QuotaUsage:
        summary = await get_telemetry_recorder().analytics_summary(
            workspace_id=workspace_id,
            persist=persist,
        )
        docs = documents or []
        return QuotaUsage(
            queries_today=int(summary.get("usage_queries_today") or 0),
            tokens_today=int(
                summary.get("usage_tokens_today") or summary.get("llm_total_tokens") or 0
            ),
            documents=len(docs),
            storage_bytes=sum(_safe_int(doc.get("file_size_bytes")) for doc in docs),
        )

    def assert_chat_allowed(self, usage: QuotaUsage, *, estimated_tokens: int) -> None:
        if not self.enabled:
            return
        if usage.queries_today >= self.limits.daily_queries:
            raise QuotaExceededError(
                "Daily query quota exhausted for this workspace.",
                payload=self.payload(usage),
            )
        if usage.tokens_today + max(0, int(estimated_tokens or 0)) > self.limits.daily_tokens:
            raise QuotaExceededError(
                "Daily token quota exhausted for this workspace.",
                payload=self.payload(usage),
            )

    def assert_upload_allowed(self, usage: QuotaUsage, *, file_size_bytes: int) -> None:
        if not self.enabled:
            return
        if usage.documents >= self.limits.max_documents:
            raise QuotaExceededError(
                "Document quota exhausted for this workspace.",
                payload=self.payload(usage),
            )
        if usage.storage_bytes + max(0, int(file_size_bytes or 0)) > self.limits.max_storage_bytes:
            raise QuotaExceededError(
                "Storage quota exhausted for this workspace.",
                payload=self.payload(usage),
            )

    def payload(self, usage: QuotaUsage) -> dict[str, Any]:
        limits = {
            "daily_queries": self.limits.daily_queries,
            "daily_tokens": self.limits.daily_tokens,
            "max_documents": self.limits.max_documents,
            "max_storage_bytes": self.limits.max_storage_bytes,
        }
        current = {
            "queries_today": usage.queries_today,
            "tokens_today": usage.tokens_today,
            "documents": usage.documents,
            "storage_bytes": usage.storage_bytes,
        }
        remaining = {
            "queries_today": max(self.limits.daily_queries - usage.queries_today, 0),
            "tokens_today": max(self.limits.daily_tokens - usage.tokens_today, 0),
            "documents": max(self.limits.max_documents - usage.documents, 0),
            "storage_bytes": max(self.limits.max_storage_bytes - usage.storage_bytes, 0),
        }
        return {
            "enforced": self.enabled,
            "limits": limits,
            "usage": current,
            "remaining": remaining,
        }


def _safe_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0
