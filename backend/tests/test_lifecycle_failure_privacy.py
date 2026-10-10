"""Synthetic failure receipts, not hosted deletion/retention acceptance."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.tenancy import lifecycle as lifecycle_module
from src.tenancy import retention_scheduler as scheduler_module

MARKER = "synthetic-private-lifecycle-marker"


class PrivateFailure(RuntimeError):
    def __str__(self):
        raise AssertionError("Raw failure text must never be stringified")


def make_service(monkeypatch, documents=True):
    logger, cache = MagicMock(), MagicMock()
    monkeypatch.setattr(lifecycle_module, "logger", logger)
    monkeypatch.setattr(lifecycle_module, "get_layered_cache", lambda: cache)
    docs = SimpleNamespace(
        list_documents=AsyncMock(return_value=[{"id": "synthetic-doc", "storage_path": "synthetic/path"}] if documents else []),
        delete_original=AsyncMock(), delete_document_row=AsyncMock(return_value=1),
    )
    workspaces = SimpleNamespace(delete_workspace=AsyncMock(return_value=1))
    messages = SimpleNamespace(delete_workspace_history=AsyncMock(return_value=1))
    methods = {'settings': 'delete_settings', 'api_keys': 'delete_workspace_keys', 'usage': 'delete_workspace_events',
               'billing': 'delete_workspace_daily_usage', 'provider_health': 'delete_workspace_state', 'audit': 'detach_workspace_events'}
    scoped = {key: SimpleNamespace(**{method: AsyncMock(return_value=1)}) for key, method in methods.items()}
    vectors = SimpleNamespace(delete_by_identifier=MagicMock(return_value=3))
    qdrant = SimpleNamespace(delete_document=AsyncMock(return_value=2))
    service = lifecycle_module.WorkspaceLifecycleService(documents=docs, workspaces=workspaces, messages=messages,
        vector_store=vectors, qdrant_store=qdrant, **scoped)
    return service, docs, workspaces, messages, scoped, vectors, qdrant, logger, cache


def assert_private_failure(logger, receipt, code):
    logger.warning.assert_called_once()
    kwargs = logger.warning.call_args.kwargs
    assert kwargs['error_type'] == 'PrivateFailure'
    assert 'error' not in kwargs
    assert receipt['code'] == code
    assert MARKER not in json.dumps(receipt)
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.asyncio
@pytest.mark.parametrize('stage', ['storage', 'qdrant', 'local_vectors', 'document_row'])
async def test_document_cleanup_failure_is_safe_and_never_confirms_workspace_deletion(monkeypatch, stage):
    service, docs, workspaces, messages, scoped, vectors, qdrant, logger, cache = make_service(monkeypatch)
    operation = {'storage': docs.delete_original, 'qdrant': qdrant.delete_document,
                 'local_vectors': vectors.delete_by_identifier, 'document_row': docs.delete_document_row}[stage]
    operation.side_effect = PrivateFailure(MARKER)
    result = await service.delete_workspace(workspace_id='synthetic-workspace')
    assert not result.workspace_deleted
    assert result.documents_deleted == 0
    assert len(result.failures) == 1
    assert result.failures[0]['document_id'] == 'synthetic-doc'
    assert_private_failure(logger, result.failures[0], 'DOCUMENT_CLEANUP_FAILED')
    workspaces.delete_workspace.assert_not_awaited()
    messages.delete_workspace_history.assert_not_awaited()
    cache.invalidate.assert_not_called()
    assert result.qdrant_chunks_deleted == (2 if stage in ['local_vectors', 'document_row'] else 0)
    assert result.local_chunks_deleted == (3 if stage == 'document_row' else 0)
    if stage != 'document_row': docs.delete_document_row.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('resource', ['chat_history','workspace_settings','api_keys','llm_usage_events','workspace_usage_daily','provider_health_state','audit_events'])
async def test_workspace_resource_receipts_do_not_expose_private_errors(monkeypatch, resource):
    service, docs, workspaces, messages, scoped, vectors, qdrant, logger, cache = make_service(monkeypatch, documents=False)
    operations = {'chat_history': messages.delete_workspace_history, 'workspace_settings': scoped['settings'].delete_settings,
        'api_keys': scoped['api_keys'].delete_workspace_keys, 'llm_usage_events': scoped['usage'].delete_workspace_events,
        'workspace_usage_daily': scoped['billing'].delete_workspace_daily_usage,
        'provider_health_state': scoped['provider_health'].delete_workspace_state, 'audit_events': scoped['audit'].detach_workspace_events}
    operations[resource].side_effect = PrivateFailure(MARKER)
    result = await service.delete_workspace(workspace_id='synthetic-workspace')
    assert not result.workspace_deleted
    assert len(result.failures) == 1 and result.failures[0]['resource'] == resource
    assert_private_failure(logger, result.failures[0], 'WORKSPACE_CLEANUP_FAILED')
    workspaces.delete_workspace.assert_not_awaited()
    cache.invalidate.assert_not_called()
    for op in operations.values(): op.assert_awaited_once_with(workspace_id='synthetic-workspace')


@pytest.mark.asyncio
async def test_workspace_row_failure_does_not_leak_or_invalidate_cache(monkeypatch):
    service, docs, workspaces, messages, scoped, vectors, qdrant, logger, cache = make_service(monkeypatch, documents=False)
    workspaces.delete_workspace.side_effect = PrivateFailure(MARKER)
    result = await service.delete_workspace(workspace_id='synthetic-workspace')
    assert not result.workspace_deleted
    assert result.chat_sessions_deleted == 1
    assert_private_failure(logger, result.failures[0], 'WORKSPACE_DELETE_FAILED')
    cache.invalidate.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize('stage', ['cleanup', 'success_schedule_write'])
async def test_scheduler_retry_preserves_failure_state_without_private_logging(monkeypatch, stage):
    logger = MagicMock();monkeypatch.setattr(scheduler_module, 'logger', logger)
    settings = SimpleNamespace(claim_due_retention=AsyncMock(return_value=[{'workspace_id':'synthetic-workspace','retention_enabled':True,'retention_days':30}]),upsert_settings=AsyncMock())
    life = SimpleNamespace(apply_retention=AsyncMock(return_value=SimpleNamespace(failures=[],documents_deleted=2,chat_sessions_deleted=1)))
    if stage == 'cleanup':life.apply_retention.side_effect=PrivateFailure(MARKER)
    else:settings.upsert_settings.side_effect=[PrivateFailure(MARKER),{}]
    summary = await scheduler_module.RetentionScheduler(settings=settings,lifecycle=life).run_due(worker_id='synthetic-worker')
    assert summary.failed == 1 and summary.completed == 0
    assert summary.documents_deleted == (0 if stage == "cleanup" else 2)
    assert summary.chat_sessions_deleted == (0 if stage == "cleanup" else 1)
    retry=settings.upsert_settings.await_args_list[-1].kwargs['values']
    assert 'last_retention_at' not in retry
    assert retry['next_retention_at'] and retry['retention_lease_owner'] is None and retry['retention_lease_expires_at'] is None
    logger.warning.assert_called_once()
    assert logger.warning.call_args.kwargs['error_type']=='PrivateFailure'
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation', ['retention', 'workspace_delete'])
async def test_real_route_receipt_or_audit_never_contains_private_cleanup_error(monkeypatch, operation):
    service, docs, workspaces, messages, scoped, vectors, qdrant, logger, cache = make_service(monkeypatch)
    docs.delete_original.side_effect=PrivateFailure(MARKER)
    # A real lifecycle service with fixture transports, not a counterfeit result.
    docs.list_documents.return_value[0]['created_at']='2000-01-01T00:00:00+00:00'
    service._messages.delete_sessions_before=AsyncMock(return_value=0)
    monkeypatch.setattr(routes,'WorkspaceLifecycleService',lambda **kwargs:service)
    settings_repo=SimpleNamespace(get_settings=AsyncMock(return_value={'retention_enabled':True,'retention_days':30}),upsert_settings=AsyncMock())
    monkeypatch.setattr(routes,'WorkspaceSettingsRepository',lambda:settings_repo)
    audit=AsyncMock();monkeypatch.setattr(routes,'_record_audit_event',audit)
    workspace=WorkspaceContext(workspace_id='synthetic-workspace',user=CurrentUser(id='synthetic-owner',email=None,role='authenticated',claims={}),role=WorkspaceRole.OWNER)
    settings=Settings(_env_file=None,supabase_url='https://example.invalid',supabase_anon_key='synthetic-anon',supabase_service_role_key='synthetic-service')
    chain=MagicMock()
    with pytest.raises(HTTPException) as caught:
        if operation=='retention':await routes.run_retention(workspace=workspace,settings=settings,vs=vectors)
        else:await routes.delete_current_workspace(_body=routes.WorkspaceDeleteRequest(confirmation="DELETE WORKSPACE"),workspace=workspace,settings=settings,vs=vectors,chain=chain)
    assert caught.value.status_code==502
    assert MARKER not in json.dumps(caught.value.detail)
    workspaces.delete_workspace.assert_not_awaited()
    chain.clear_cache.assert_not_called()
    if operation=='retention':
        audit.assert_awaited_once()
        receipt=audit.await_args.kwargs['metadata']['failures'][0]
    else:receipt=caught.value.detail['failures'][0]
    assert receipt['code']=='DOCUMENT_CLEANUP_FAILED'
    assert MARKER not in json.dumps(receipt)
