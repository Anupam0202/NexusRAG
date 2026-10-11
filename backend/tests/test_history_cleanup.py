"""History cleanup never confirms unverified durable or local deletion."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.repositories.messages import MessageRepository


class PrivateCleanupFailure(Exception):
    def __str__(self):
        raise AssertionError("Private provider detail must not be rendered")


@pytest.fixture
def history_cleanup_context(monkeypatch):
    repository = SimpleNamespace(clear_session=AsyncMock(return_value=3))
    factory = MagicMock(return_value=repository)
    chain = SimpleNamespace(clear_session=MagicMock())
    audit = AsyncMock()
    logger = MagicMock()
    monkeypatch.setattr(routes, "MessageRepository", factory)
    monkeypatch.setattr(routes, "_record_audit_event", audit)
    monkeypatch.setattr(routes, "logger", logger)
    workspace = WorkspaceContext(
        workspace_id="workspace-one", role=WorkspaceRole.VIEWER,
        user=CurrentUser(id="actor-one", email="actor@example.invalid",
                         role="authenticated", claims={}),
    )
    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co",
                        supabase_anon_key="synthetic-anon",
                        supabase_service_role_key="synthetic-service")
    return SimpleNamespace(repository=repository, factory=factory, chain=chain,
                           audit=audit, logger=logger, workspace=workspace,
                           settings=settings)


@pytest.mark.asyncio
async def test_history_cleanup_durable_failure_preserves_memory_and_success_audit(history_cleanup_context):
    context = history_cleanup_context
    context.repository.clear_session.side_effect = PrivateCleanupFailure()
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session("session-one", workspace=context.workspace,
                                   settings=context.settings, chain=context.chain)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Conversation cleanup could not be confirmed."
    context.chain.clear_session.assert_not_called()
    context.audit.assert_not_awaited()
    context.repository.clear_session.assert_awaited_once_with(
        workspace_id="workspace-one", session_id="session-one")
    assert context.logger.warning.call_args.kwargs == {
        "workspace_id": "workspace-one", "stage": "durable"}


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [None, False, True, -1, 1.5, "3", {}])
async def test_history_cleanup_rejects_unconfirmed_count_before_memory(history_cleanup_context, count):
    context = history_cleanup_context
    context.repository.clear_session.return_value = count
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session("session-one", workspace=context.workspace,
                                   settings=context.settings, chain=context.chain)
    assert raised.value.status_code == 503
    context.chain.clear_session.assert_not_called()
    context.audit.assert_not_awaited()
    context.repository.clear_session.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 3])
async def test_history_cleanup_confirms_durable_before_local_and_audit(history_cleanup_context, count):
    context = history_cleanup_context
    order = []

    async def delete(**kwargs):
        order.append("durable")
        return count

    context.repository.clear_session.side_effect = delete
    context.chain.clear_session.side_effect = lambda *a, **kw: order.append("memory")
    context.audit.side_effect = lambda **kw: order.append("audit")
    result = await routes.clear_session("session-one", workspace=context.workspace,
                                       settings=context.settings, chain=context.chain)
    assert order == ["durable", "memory", "audit"]
    assert result["success"] is True and result["durable_messages_deleted"] == count
    context.chain.clear_session.assert_called_once_with("session-one", workspace_id="workspace-one")
    assert context.audit.await_args.kwargs["action"] == "chat.session_cleared"
    assert context.audit.await_args.kwargs["metadata"] == {"durable_messages_deleted": count}


@pytest.mark.asyncio
async def test_history_cleanup_local_failure_does_not_claim_complete(history_cleanup_context):
    context = history_cleanup_context
    context.chain.clear_session.side_effect = PrivateCleanupFailure()
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session("session-one", workspace=context.workspace,
                                   settings=context.settings, chain=context.chain)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Conversation cleanup could not be confirmed."
    context.repository.clear_session.assert_awaited_once()
    context.audit.assert_not_awaited()
    assert context.logger.warning.call_args.kwargs == {
        "workspace_id": "workspace-one", "stage": "memory"}


@pytest.mark.asyncio
async def test_history_cleanup_demo_uses_local_only(history_cleanup_context):
    context = history_cleanup_context
    result = await routes.clear_session("session-one", workspace=None,
                                       settings=context.settings, chain=context.chain)
    assert result["success"] is True and result["durable_messages_deleted"] == 0
    context.factory.assert_not_called()
    context.chain.clear_session.assert_called_once()


@pytest.mark.asyncio
async def test_history_cleanup_cancellation_never_clears_memory(history_cleanup_context):
    import asyncio

    context = history_cleanup_context
    context.repository.clear_session.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await routes.clear_session("session-one", workspace=context.workspace,
                                   settings=context.settings, chain=context.chain)
    context.chain.clear_session.assert_not_called()
    context.audit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [None, {}, [None], [True], [{"role": "user"}],
    [{"workspace_id": "other", "session_id": "session-one"}],
    [{"workspace_id": "workspace-one", "session_id": "other"}],
])
async def test_history_cleanup_repository_rejects_unconfirmed_deleted_rows(rows):
    transport = SimpleNamespace(table_delete=AsyncMock(return_value=rows))
    repository = MessageRepository(transport)
    with pytest.raises(ValueError, match="Unconfirmed history cleanup response"):
        await repository.clear_session(workspace_id="workspace-one", session_id="session-one")
    transport.table_delete.assert_awaited_once_with("chat_messages",
        query="workspace_id=eq.workspace-one&session_id=eq.session-one")


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [[], [
    {"workspace_id": "workspace-one", "session_id": "session-one"},
    {"workspace_id": "workspace-one", "session_id": "session-one"},
]])
async def test_history_cleanup_repository_confirms_exact_scope_and_count(rows):
    repository = MessageRepository(SimpleNamespace(table_delete=AsyncMock(return_value=rows)))
    assert await repository.clear_session(workspace_id="workspace-one",
                                          session_id="session-one") == len(rows)
