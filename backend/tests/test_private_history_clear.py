"""Conversation cleanup requires a caller-bound, exact-scope durable receipt."""

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.repositories.messages import MessageRepository

WORKSPACE = "11111111-1111-4111-8111-111111111111"
SESSION = "a1111111-1111-4111-8111-111111111111"


def receipt(count=3):
    return [{"workspace_id": WORKSPACE, "session_id": SESSION,
             "success": True, "durable_messages_deleted": count}]


@pytest.fixture
def clear_context(monkeypatch):
    transport = SimpleNamespace(rpc_as_user=AsyncMock(return_value=receipt()),
        table_delete=AsyncMock(return_value=[
            {"workspace_id": WORKSPACE, "session_id": SESSION}]))
    repository = MessageRepository(transport)
    monkeypatch.setattr(routes, "MessageRepository", lambda: repository)
    audit = AsyncMock()
    monkeypatch.setattr(routes, "_record_audit_event", audit)
    chain = SimpleNamespace(clear_session=MagicMock())
    workspace = WorkspaceContext(workspace_id=WORKSPACE, role=WorkspaceRole.VIEWER,
        user=CurrentUser(id="actor-one", email=None, claims={}, role="authenticated",
                         access_token="synthetic.user.token"))
    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key="sb_publishable_synthetic",
        supabase_service_role_key="sb_secret_synthetic")
    return SimpleNamespace(transport=transport, repository=repository, audit=audit,
                           chain=chain, workspace=workspace, settings=settings)


@pytest.mark.asyncio
async def test_unrelated_member_cannot_clear_durable_or_cached_history(clear_context):
    c = clear_context
    c.transport.rpc_as_user.return_value = []  # Caller has no live owner authority.
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session(SESSION, workspace=c.workspace,
            settings=c.settings, chain=c.chain)
    assert raised.value.status_code == 404
    c.transport.table_delete.assert_not_awaited()
    c.chain.clear_session.assert_not_called()
    c.audit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["credential", "configuration"])
async def test_clear_missing_authority_never_downgrades_to_local_memory(clear_context, missing):
    c = clear_context
    if missing == "credential":
        c.workspace = replace(c.workspace, user=replace(c.workspace.user, access_token=None))
    else:
        c.settings = Settings(_env_file=None)
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session(SESSION, workspace=c.workspace,
            settings=c.settings, chain=c.chain)
    assert raised.value.status_code == 503
    c.transport.rpc_as_user.assert_not_awaited()
    c.transport.table_delete.assert_not_awaited()
    c.chain.clear_session.assert_not_called()
    c.audit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 3])
async def test_owner_clear_requires_caller_rpc_receipt_before_local_clear(clear_context, count):
    c = clear_context
    c.transport.rpc_as_user.return_value = receipt(count)
    result = await routes.clear_session(SESSION, workspace=c.workspace,
        settings=c.settings, chain=c.chain)
    assert result["success"] is True and result["durable_messages_deleted"] == count
    c.transport.rpc_as_user.assert_awaited_once_with("clear_private_history",
        {"p_workspace": WORKSPACE, "p_session": SESSION},
        access_token="synthetic.user.token")
    c.transport.table_delete.assert_not_awaited()
    c.chain.clear_session.assert_called_once_with(SESSION, workspace_id=WORKSPACE)
    c.audit.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [None, {}, [None], [True], receipt()+receipt(),
    [{"workspace_id": "other", "session_id": SESSION, "success": True,
      "durable_messages_deleted": 0}],
    [{"workspace_id": WORKSPACE, "session_id": "other", "success": True,
      "durable_messages_deleted": 0}],
    [{"workspace_id": WORKSPACE, "session_id": SESSION, "success": False,
      "durable_messages_deleted": 0}],
    [{"workspace_id": WORKSPACE, "session_id": SESSION, "durable_messages_deleted": 0}],
    *[receipt(n) for n in [None, False, True, -1, 1.5, "3", 2**53]]])
async def test_clear_rejects_ambiguous_receipt_without_memory_or_success(clear_context, rows):
    c = clear_context
    c.transport.rpc_as_user.return_value = rows
    with pytest.raises(HTTPException) as raised:
        await routes.clear_session(SESSION, workspace=c.workspace,
            settings=c.settings, chain=c.chain)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Conversation cleanup could not be confirmed."
    c.transport.table_delete.assert_not_awaited()
    c.chain.clear_session.assert_not_called()
    c.audit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("alternate", [SESSION.upper(), SESSION.replace("-", "")])
async def test_clear_repository_normalizes_uuid_without_service_fallback(clear_context, alternate):
    c = clear_context
    assert await c.repository.clear_session(workspace_id=WORKSPACE,
        session_id=alternate, access_token="synthetic.user.token") == 3
    c.transport.rpc_as_user.assert_awaited_once_with("clear_private_history",
        {"p_workspace": WORKSPACE, "p_session": SESSION},
        access_token="synthetic.user.token")
    c.transport.table_delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_clear_rpc_cancellation_never_deletes_shared_memory(clear_context):
    import asyncio

    c = clear_context
    c.transport.rpc_as_user.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await routes.clear_session(SESSION, workspace=c.workspace,
            settings=c.settings, chain=c.chain)
    c.chain.clear_session.assert_not_called()
    c.audit.assert_not_awaited()


@pytest.mark.parametrize("alternate", [SESSION.upper(), SESSION.replace("-", ""),
    "{" + SESSION + "}", "urn:uuid:" + SESSION])
def test_memory_session_aliases_share_one_clearable_key(alternate):
    from src.generation.chain import RAGChain
    from src.generation.memory import SessionMemoryStore

    assert RAGChain._session_key(WORKSPACE, alternate) == RAGChain._session_key(WORKSPACE, SESSION)
    assert RAGChain._session_key(WORKSPACE, "local-demo-session") == WORKSPACE + ":local-demo-session"
    chain = object.__new__(RAGChain)
    chain._memory_store = SessionMemoryStore()
    chain._memory_store.get(chain._session_key(WORKSPACE, alternate)).add("user", "Synthetic memory fixture")
    assert chain.get_session_history(SESSION, workspace_id=WORKSPACE)
    chain.clear_session(SESSION, workspace_id=WORKSPACE)
    assert chain.get_session_history(alternate, workspace_id=WORKSPACE) == []
