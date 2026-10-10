"""Manual retention has scoped RPC authority and truthful public outcomes."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.repositories.settings import WorkspaceSettingsRepository
from src.tenancy.manual_retention import ManualRetentionError


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [None, {"workspace_id": "workspace-1"}])
async def test_manual_claim_rpc_has_exact_actor_workspace_and_worker(response):
    transport = SimpleNamespace(rpc=AsyncMock(return_value=response))
    repository = WorkspaceSettingsRepository(supabase=transport)
    assert await repository.claim_workspace_retention(
        workspace_id="workspace-1", actor_id="owner-1", worker_id="manual-one",
    ) == response
    transport.rpc.assert_awaited_once_with("claim_workspace_retention", {
        "p_workspace": "workspace-1", "p_actor": "owner-1",
        "p_worker_id": "manual-one", "p_lease_seconds": 900,
    })


@pytest.mark.asyncio
@pytest.mark.parametrize("response", [True, False, [], [{}], "claimed", 1])
async def test_manual_claim_rpc_rejects_non_object_responses(response):
    repository = WorkspaceSettingsRepository(supabase=SimpleNamespace(
        rpc=AsyncMock(return_value=response),
    ))
    with pytest.raises(RuntimeError, match="Invalid manual retention claim response"):
        await repository.claim_workspace_retention(
            workspace_id="workspace-1", actor_id="owner-1", worker_id="manual-one",
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("code,status", [
    ("CLAIM_UNAVAILABLE", 409), ("LEASE_LOST", 409),
    ("CLAIM_UNCONFIRMED", 502), ("FINISH_UNCONFIRMED", 502),
])
async def test_manual_route_reports_failure_without_retry_success(monkeypatch, code, status):
    run = AsyncMock(side_effect=ManualRetentionError(code))
    audit = AsyncMock()
    monkeypatch.setattr(routes, "run_manual_retention", run)
    monkeypatch.setattr(routes, "WorkspaceSettingsRepository", lambda: object())
    monkeypatch.setattr(routes, "WorkspaceLifecycleService", lambda **kwargs: object())
    monkeypatch.setattr(routes, "_record_audit_event", audit)
    workspace = WorkspaceContext(workspace_id="workspace-1", role=WorkspaceRole.OWNER,
        user=CurrentUser(id="owner-1", email="owner@example.invalid", role="authenticated", claims={}))
    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key="synthetic-anon", supabase_service_role_key="synthetic-service")
    with pytest.raises(HTTPException) as raised:
        await routes.run_retention(workspace=workspace, settings=settings, vs=object())
    assert raised.value.status_code == status
    assert "scheduled for retry" not in raised.value.detail
    args = run.await_args.kwargs
    assert args["actor_id"] == "owner-1" and args["workspace_id"] == "workspace-1"
    assert args["worker_id"].startswith("manual-retention:")
    assert audit.await_args.kwargs["metadata"]["retry_scheduled"] is False


@pytest.mark.asyncio
async def test_manual_route_denies_demo_before_constructing_authority(monkeypatch):
    run = AsyncMock()
    monkeypatch.setattr(routes, "run_manual_retention", run)
    with pytest.raises(HTTPException) as raised:
        await routes.run_retention(workspace=None, settings=Settings(_env_file=None), vs=object())
    assert raised.value.status_code == 403
    run.assert_not_awaited()
