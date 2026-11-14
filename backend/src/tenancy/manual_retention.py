"""Manual cleanup owns a workspace claim; schedule writes use exact-claim fencing."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


class ManualRetentionError(RuntimeError):
    def __init__(self, code: str, *, result: Any = None, retry_scheduled: bool = False):
        super().__init__(code)
        self.code = code
        self.result = result
        self.retry_scheduled = retry_scheduled


async def run_manual_retention(*, settings: Any, lifecycle: Any,
                               workspace_id: str, actor_id: str, worker_id: str) -> Any:
    try:
        claim = await settings.claim_workspace_retention(
            workspace_id=workspace_id, actor_id=actor_id, worker_id=worker_id,
        )
    except Exception:
        raise ManualRetentionError("CLAIM_UNCONFIRMED") from None
    if claim is None:
        raise ManualRetentionError("CLAIM_UNAVAILABLE")
    expires_at = claim.get("retention_lease_expires_at") if type(claim) is dict else None
    days = claim.get("retention_days") if type(claim) is dict else None
    valid_expiry = False
    if type(expires_at) is str:
        try:
            expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            valid_expiry = expires.tzinfo is not None and expires > datetime.now(UTC)
        except ValueError:
            pass
    if (type(claim) is not dict or claim.get("workspace_id") != workspace_id
            or claim.get("retention_lease_owner") != worker_id
            or claim.get("retention_enabled") is not True
            or type(days) is not int or not 1 <= days <= 3650 or not valid_expiry):
        raise ManualRetentionError("INVALID_CLAIM")

    scope = dict(workspace_id=workspace_id, worker_id=worker_id,
                 lease_expires_at=expires_at, retention_days=days)
    result = None
    try:
        result = await lifecycle.apply_retention(workspace_id=workspace_id, retention_days=days)
    except Exception:
        pass
    # Cancellation is a BaseException and propagates, leaving the lease intact.
    succeeded = result is not None and not result.failures
    try:
        finished = await settings.finish_retention_claim(**scope, succeeded=succeeded)
    except Exception:
        raise ManualRetentionError("FINISH_UNCONFIRMED", result=result) from None
    if type(finished) is not bool:
        raise ManualRetentionError("FINISH_UNCONFIRMED", result=result)
    if not finished:
        raise ManualRetentionError("LEASE_LOST", result=result)
    if not succeeded:
        raise ManualRetentionError("CLEANUP_FAILED", result=result, retry_scheduled=True)
    return result
