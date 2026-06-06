"""Durable retention schedule processor."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from src.repositories.settings import WorkspaceSettingsRepository
from src.tenancy.lifecycle import WorkspaceLifecycleService
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class RetentionSchedulerSummary:
    claimed: int = 0
    completed: int = 0
    skipped: int = 0
    failed: int = 0
    documents_deleted: int = 0
    chat_sessions_deleted: int = 0


class RetentionScheduler:
    def __init__(
        self,
        *,
        settings: WorkspaceSettingsRepository | None = None,
        lifecycle: WorkspaceLifecycleService | None = None,
    ) -> None:
        self._settings = settings or WorkspaceSettingsRepository()
        self._lifecycle = lifecycle or WorkspaceLifecycleService()

    async def run_due(
        self,
        *,
        worker_id: str,
        limit: int = 100,
        lease_seconds: int = 900,
    ) -> RetentionSchedulerSummary:
        now = datetime.now(UTC)
        rows = await self._settings.claim_due_retention(
            worker_id=worker_id,
            limit=limit,
            lease_seconds=lease_seconds,
        )
        summary = RetentionSchedulerSummary(claimed=len(rows))
        for row in rows:
            workspace_id = str(row.get("workspace_id") or "")
            retention_days = int(row.get("retention_days") or 0)
            if not workspace_id or not row.get("retention_enabled") or retention_days < 1:
                summary.skipped += 1
                continue
            try:
                result = await self._lifecycle.apply_retention(
                    workspace_id=workspace_id,
                    retention_days=retention_days,
                )
                if result.failures:
                    raise RuntimeError(f"{len(result.failures)} retention cleanup failures")
                await self._settings.upsert_settings(
                    workspace_id=workspace_id,
                    values={
                        "last_retention_at": now.isoformat(),
                        "next_retention_at": (now + timedelta(days=1)).isoformat(),
                        "retention_lease_owner": None,
                        "retention_lease_expires_at": None,
                    },
                )
                summary.completed += 1
                summary.documents_deleted += result.documents_deleted
                summary.chat_sessions_deleted += result.chat_sessions_deleted
            except Exception as exc:
                summary.failed += 1
                await self._settings.upsert_settings(
                    workspace_id=workspace_id,
                    values={
                        "next_retention_at": (now + timedelta(hours=1)).isoformat(),
                        "retention_lease_owner": None,
                        "retention_lease_expires_at": None,
                    },
                )
                logger.warning(
                    "retention_schedule_failed",
                    workspace_id=workspace_id,
                    error=str(exc)[:300],
                )
        return summary
