"""Workspace-scoped usage and audit telemetry.

The public demo can run without Supabase, so telemetry always records to a
bounded in-memory store first. Enterprise workspaces can additionally persist
the same sanitized events to Supabase.
"""

from __future__ import annotations

import math
import threading
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

from src.repositories.audit import AuditRepository
from src.repositories.usage import UsageRepository
from src.utils.logger import get_logger
from src.utils.tenant import normalize_workspace_id

logger = get_logger(__name__)

MAX_IN_MEMORY_EVENTS = 5000
REDACTED = "[redacted]"
SENSITIVE_METADATA_KEYS = ("api_key", "authorization", "secret", "token", "password")


@dataclass(frozen=True)
class LLMUsageEvent:
    workspace_id: str
    user_id: str | None
    provider: str
    model: str
    operation: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    success: bool
    error_code: str | None
    created_at: datetime


@dataclass(frozen=True)
class AuditEvent:
    workspace_id: str
    user_id: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    metadata: dict[str, Any]
    created_at: datetime


def estimate_tokens(*parts: str | None) -> int:
    """Cheap, provider-agnostic token estimate for analytics and budgets."""
    chars = sum(len(part or "") for part in parts)
    if chars <= 0:
        return 0
    return max(1, math.ceil(chars / 4))


def _clean_metadata(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return str(value)[:300]
    if isinstance(value, dict):
        clean: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if any(marker in key_text.lower() for marker in SENSITIVE_METADATA_KEYS):
                clean[key_text] = REDACTED
            else:
                clean[key_text] = _clean_metadata(item, depth=depth + 1)
        return clean
    if isinstance(value, (list, tuple, set)):
        return [_clean_metadata(item, depth=depth + 1) for item in list(value)[:25]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:500]
    return str(value)[:300]


def _coerce_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


class TelemetryRecorder:
    def __init__(
        self,
        *,
        usage_repository: UsageRepository | None = None,
        audit_repository: AuditRepository | None = None,
    ) -> None:
        self._usage_repository = usage_repository
        self._audit_repository = audit_repository
        self._usage_events: deque[LLMUsageEvent] = deque(maxlen=MAX_IN_MEMORY_EVENTS)
        self._audit_events: deque[AuditEvent] = deque(maxlen=MAX_IN_MEMORY_EVENTS)
        self._lock = threading.RLock()

    async def record_llm_usage(
        self,
        *,
        workspace_id: str | None,
        user_id: str | None = None,
        provider: str = "gemini",
        model: str = "",
        operation: str = "chat.query",
        input_tokens: int = 0,
        output_tokens: int = 0,
        latency_ms: int = 0,
        success: bool = True,
        error_code: str | None = None,
        persist: bool = False,
    ) -> LLMUsageEvent:
        event = LLMUsageEvent(
            workspace_id=normalize_workspace_id(workspace_id),
            user_id=user_id,
            provider=provider,
            model=model,
            operation=operation,
            input_tokens=max(0, int(input_tokens or 0)),
            output_tokens=max(0, int(output_tokens or 0)),
            latency_ms=max(0, int(latency_ms or 0)),
            success=bool(success),
            error_code=error_code,
            created_at=datetime.now(UTC),
        )
        with self._lock:
            self._usage_events.append(event)

        if persist:
            try:
                await (self._usage_repository or UsageRepository()).record_event(
                    workspace_id=event.workspace_id,
                    user_id=event.user_id,
                    provider=event.provider,
                    model=event.model,
                    operation=event.operation,
                    input_tokens=event.input_tokens,
                    output_tokens=event.output_tokens,
                    latency_ms=event.latency_ms,
                    success=event.success,
                    error_code=event.error_code,
                )
            except Exception as exc:
                logger.warning(
                    "usage_telemetry_persist_failed",
                    workspace_id=event.workspace_id,
                    operation=event.operation,
                    error=str(exc)[:300],
                )
        return event

    async def record_audit_event(
        self,
        *,
        workspace_id: str | None,
        user_id: str | None = None,
        action: str,
        resource_type: str | None = None,
        resource_id: str | None = None,
        metadata: dict[str, Any] | None = None,
        persist: bool = False,
    ) -> AuditEvent:
        event = AuditEvent(
            workspace_id=normalize_workspace_id(workspace_id),
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            metadata=_clean_metadata(metadata or {}),
            created_at=datetime.now(UTC),
        )
        with self._lock:
            self._audit_events.append(event)

        if persist:
            try:
                await (self._audit_repository or AuditRepository()).record_event(
                    action=event.action,
                    workspace_id=event.workspace_id,
                    user_id=event.user_id,
                    resource_type=event.resource_type,
                    resource_id=event.resource_id,
                    metadata=event.metadata,
                )
            except Exception as exc:
                logger.warning(
                    "audit_telemetry_persist_failed",
                    workspace_id=event.workspace_id,
                    action=event.action,
                    error=str(exc)[:300],
                )
        return event

    async def analytics_summary(
        self,
        *,
        workspace_id: str | None,
        persist: bool = False,
    ) -> dict[str, Any]:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        if persist:
            try:
                usage_rows = await (self._usage_repository or UsageRepository()).list_events(
                    workspace_id=scoped_workspace_id
                )
                audit_rows = await (self._audit_repository or AuditRepository()).list_events(
                    workspace_id=scoped_workspace_id
                )
                if usage_rows or audit_rows:
                    return self._summarize_persisted(usage_rows, audit_rows)
            except Exception as exc:
                logger.warning(
                    "telemetry_summary_persisted_failed",
                    workspace_id=scoped_workspace_id,
                    error=str(exc)[:300],
                )

        with self._lock:
            usage = [
                event for event in self._usage_events if event.workspace_id == scoped_workspace_id
            ]
            audit = [
                event for event in self._audit_events if event.workspace_id == scoped_workspace_id
            ]
        return self._summarize_memory(usage, audit)

    async def list_audit_events(
        self,
        *,
        workspace_id: str | None,
        persist: bool = False,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        scoped_workspace_id = normalize_workspace_id(workspace_id)
        safe_limit = max(1, min(int(limit or 50), 200))

        if persist:
            try:
                rows = await (self._audit_repository or AuditRepository()).list_events(
                    workspace_id=scoped_workspace_id,
                    limit=safe_limit,
                )
                return [self._audit_row_payload(row) for row in rows[:safe_limit]]
            except Exception as exc:
                logger.warning(
                    "audit_events_persisted_list_failed",
                    workspace_id=scoped_workspace_id,
                    error=str(exc)[:300],
                )

        with self._lock:
            events = [
                event
                for event in self._audit_events
                if event.workspace_id == scoped_workspace_id
            ]
        events.sort(key=lambda event: event.created_at, reverse=True)
        return [self._audit_event_payload(event) for event in events[:safe_limit]]

    @staticmethod
    def _audit_event_payload(event: AuditEvent) -> dict[str, Any]:
        return {
            "id": None,
            "workspace_id": event.workspace_id,
            "user_id": event.user_id,
            "action": event.action,
            "resource_type": event.resource_type,
            "resource_id": event.resource_id,
            "metadata": event.metadata,
            "created_at": event.created_at.isoformat(),
        }

    @staticmethod
    def _audit_row_payload(row: dict[str, Any]) -> dict[str, Any]:
        created_at = row.get("created_at")
        if isinstance(created_at, datetime):
            created_at = created_at.isoformat()
        elif created_at is not None:
            created_at = str(created_at)
        return {
            "id": row.get("id"),
            "workspace_id": str(row.get("workspace_id") or ""),
            "user_id": row.get("user_id"),
            "action": str(row.get("action") or ""),
            "resource_type": row.get("resource_type"),
            "resource_id": row.get("resource_id"),
            "metadata": _clean_metadata(row.get("metadata") or {}),
            "created_at": created_at,
        }

    def _summarize_memory(
        self,
        usage: Iterable[LLMUsageEvent],
        audit: Iterable[AuditEvent],
    ) -> dict[str, Any]:
        usage_events = list(usage)
        audit_events = list(audit)
        today = datetime.now(UTC).date().isoformat()
        latencies = [event.latency_ms for event in usage_events if event.latency_ms > 0]
        last_activity = self._latest_activity(
            [event.created_at for event in usage_events],
            [event.created_at for event in audit_events],
        )
        return {
            "llm_usage_events": len(usage_events),
            "llm_input_tokens": sum(event.input_tokens for event in usage_events),
            "llm_output_tokens": sum(event.output_tokens for event in usage_events),
            "llm_total_tokens": sum(
                event.input_tokens + event.output_tokens for event in usage_events
            ),
            "llm_successful_events": sum(1 for event in usage_events if event.success),
            "llm_error_events": sum(1 for event in usage_events if not event.success),
            "llm_fallbacks": sum(
                1
                for event in usage_events
                if (event.error_code or "").lower() == "generation_fallback"
            ),
            "llm_cache_hits": sum(
                1
                for event in usage_events
                if (event.error_code or "").lower() == "cache_hit"
            ),
            "usage_avg_latency_ms": (
                round(sum(latencies) / len(latencies)) if latencies else 0
            ),
            "usage_queries_today": sum(
                1 for event in usage_events if event.created_at.date().isoformat() == today
            ),
            "usage_tokens_today": sum(
                event.input_tokens + event.output_tokens
                for event in usage_events
                if event.created_at.date().isoformat() == today
            ),
            "audit_events": len(audit_events),
            "last_activity_at": last_activity.isoformat() if last_activity else None,
        }

    def _summarize_persisted(
        self,
        usage_rows: list[dict[str, Any]],
        audit_rows: list[dict[str, Any]],
    ) -> dict[str, Any]:
        today = datetime.now(UTC).date().isoformat()
        latencies = [
            int(row.get("latency_ms") or 0)
            for row in usage_rows
            if int(row.get("latency_ms") or 0) > 0
        ]
        usage_dates = [_coerce_datetime(row.get("created_at")) for row in usage_rows]
        audit_dates = [_coerce_datetime(row.get("created_at")) for row in audit_rows]
        last_activity = self._latest_activity(
            [value for value in usage_dates if value],
            [value for value in audit_dates if value],
        )
        return {
            "llm_usage_events": len(usage_rows),
            "llm_input_tokens": sum(int(row.get("input_tokens") or 0) for row in usage_rows),
            "llm_output_tokens": sum(int(row.get("output_tokens") or 0) for row in usage_rows),
            "llm_total_tokens": sum(
                int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0)
                for row in usage_rows
            ),
            "llm_successful_events": sum(1 for row in usage_rows if row.get("success") is True),
            "llm_error_events": sum(1 for row in usage_rows if row.get("success") is False),
            "llm_fallbacks": sum(
                1
                for row in usage_rows
                if str(row.get("error_code") or "").lower() == "generation_fallback"
            ),
            "llm_cache_hits": sum(
                1
                for row in usage_rows
                if str(row.get("error_code") or "").lower() == "cache_hit"
            ),
            "usage_avg_latency_ms": (
                round(sum(latencies) / len(latencies)) if latencies else 0
            ),
            "usage_queries_today": sum(
                1 for value in usage_dates if value and value.date().isoformat() == today
            ),
            "usage_tokens_today": sum(
                int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0)
                for row, value in zip(usage_rows, usage_dates, strict=False)
                if value and value.date().isoformat() == today
            ),
            "audit_events": len(audit_rows),
            "last_activity_at": last_activity.isoformat() if last_activity else None,
        }

    @staticmethod
    def _latest_activity(
        usage_dates: Iterable[datetime],
        audit_dates: Iterable[datetime],
    ) -> datetime | None:
        values = [*usage_dates, *audit_dates]
        return max(values) if values else None


@lru_cache(maxsize=1)
def get_telemetry_recorder() -> TelemetryRecorder:
    return TelemetryRecorder()
