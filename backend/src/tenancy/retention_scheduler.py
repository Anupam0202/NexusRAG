"""Durable retention schedule processor."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

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
    lease_lost: int = 0
    documents_deleted: int = 0
    chat_sessions_deleted: int = 0


class RetentionLeaseLost(RuntimeError):
    """The current durable claim could not authorize its schedule write."""


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
            lease_expires_at = row.get("retention_lease_expires_at")
            valid_lease = False
            if (
                type(row.get("retention_lease_owner")) is str
                and row["retention_lease_owner"] == worker_id
                and type(lease_expires_at) is str
            ):
                try:
                    expires = datetime.fromisoformat(lease_expires_at.replace("Z", "+00:00"))
                    valid_lease = expires.tzinfo is not None and expires > datetime.now(UTC)
                except (ValueError, TypeError):
                    pass
            if not valid_lease:
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
                if not await self._settings.finish_retention_claim(
                    workspace_id=workspace_id,
                    worker_id=worker_id,
                    lease_expires_at=lease_expires_at,
                    retention_days=retention_days,
                    succeeded=True,
                ):
                    raise RetentionLeaseLost()
                summary.completed += 1
            except RetentionLeaseLost:
                summary.failed += 1
                summary.lease_lost += 1
                logger.warning("retention_lease_lost", workspace_id=workspace_id)
            except Exception as exc:
                summary.failed += 1
                try:
                    scheduled = await self._settings.finish_retention_claim(
                        workspace_id=workspace_id,
                        worker_id=worker_id,
                        lease_expires_at=lease_expires_at,
                        retention_days=retention_days,
                        succeeded=False,
                    )
                    if not scheduled:
                        summary.lease_lost += 1
                        raise RetentionLeaseLost()
                except Exception as retry_exc:
                    # Failed/ambiguous writes prove neither retry scheduling
                    # nor lease release. Never fall back to an unfenced upsert.
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
