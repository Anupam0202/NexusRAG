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
    invalid: int = 0
    retry_schedule_failed: int = 0
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
            # RPC records are JSON values, not conversion hooks or authority to
            # enable retention by truthiness. Invalid rows never reach cleanup.
            if type(row) is not dict:
                summary.invalid += 1
                logger.warning("retention_record_invalid", code="INVALID_RETENTION_RECORD")
                continue
            workspace_id = row.get("workspace_id")
            enabled = row.get("retention_enabled")
            retention_days = row.get("retention_days")
            if (
                type(workspace_id) is not str
                or not workspace_id
                or workspace_id != workspace_id.strip()
            ):
                summary.invalid += 1
                logger.warning("retention_record_invalid", code="INVALID_RETENTION_RECORD")
                continue
            if enabled is False:
                summary.skipped += 1
                continue
            if enabled is not True or type(retention_days) is not int or retention_days < 1:
                summary.invalid += 1
                logger.warning("retention_record_invalid", code="INVALID_RETENTION_RECORD")
                continue
            try:
                result = await self._lifecycle.apply_retention(
                    workspace_id=workspace_id,
                    retention_days=retention_days,
                )
                # These are lifecycle-reported operations, including partial
                # cleanup. A schedule write failure cannot undo their execution.
                summary.documents_deleted += result.documents_deleted
                summary.chat_sessions_deleted += result.chat_sessions_deleted
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
            except Exception as exc:
                summary.failed += 1
                try:
                    await self._settings.upsert_settings(
                        workspace_id=workspace_id,
                        values={
                            "next_retention_at": (now + timedelta(hours=1)).isoformat(),
                            "retention_lease_owner": None,
                            "retention_lease_expires_at": None,
                        },
                    )
                except Exception as retry_exc:
                    # Failed/ambiguous writes prove neither retry scheduling
                    # nor lease release. Record uncertainty and continue rows.
                    summary.retry_schedule_failed += 1
                    logger.warning(
                        "retention_retry_schedule_failed",
                        workspace_id=workspace_id,
                        error_type=type(retry_exc).__name__,
                    )
                logger.warning(
                    "retention_schedule_failed",
                    workspace_id=workspace_id,
                    error_type=type(exc).__name__,
                )
        return summary
