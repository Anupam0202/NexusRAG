"""Private history reads never use service credentials or cached fallback."""

from dataclasses import replace
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import HTTPException

from config.settings import Settings
from src.api import routes
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.infrastructure.supabase_client import SupabaseClient, SupabaseNotConfiguredError
from src.repositories.messages import MessageRepository

WORKSPACE = "11111111-1111-4111-8111-111111111111"
SESSION = "a1111111-1111-4111-8111-111111111111"


class PrivateReadFailure(Exception):
    def __str__(self):
        raise AssertionError("Private exception detail must not be rendered")


@pytest.fixture
def private_read_context(monkeypatch):
    repository = SimpleNamespace(list_authorized_messages=AsyncMock(return_value=[]))
    factory = MagicMock(return_value=repository)
    chain = SimpleNamespace(get_session_history=MagicMock(return_value=[
        {"role": "assistant", "content": "another actor's cached history"}]))
    logger = MagicMock()
    monkeypatch.setattr(routes, "MessageRepository", factory)
    monkeypatch.setattr(routes, "logger", logger)
    # This fixture represents the already-validated inbound credential, not a live token.
    user = CurrentUser(id="actor-one", email=None, role="authenticated", claims={},
                       access_token="synthetic.user.token")
    workspace = WorkspaceContext(workspace_id="workspace-one", user=user,
                                 role=WorkspaceRole.VIEWER)
    settings = Settings(_env_file=None, supabase_url="https://example.supabase.co",
                        supabase_anon_key="sb_publishable_synthetic",
                        supabase_service_role_key="sb_secret_synthetic")
    return SimpleNamespace(repository=repository, factory=factory, chain=chain,
                           logger=logger, workspace=workspace, settings=settings)


@pytest.mark.asyncio
async def test_private_read_empty_rls_result_never_restores_cached_history(private_read_context):
    c = private_read_context
    response = await routes.list_session_messages("session-one", workspace=c.workspace,
                                                  settings=c.settings, chain=c.chain)
    assert response.messages == [] and response.total == 0
    c.chain.get_session_history.assert_not_called()
    c.repository.list_authorized_messages.assert_awaited_once_with(
        workspace_id="workspace-one", session_id="session-one",
        access_token="synthetic.user.token")


@pytest.mark.asyncio
async def test_private_read_failure_is_static_and_never_falls_back(private_read_context):
    c = private_read_context
    c.repository.list_authorized_messages.side_effect = PrivateReadFailure()
    with pytest.raises(HTTPException) as raised:
        await routes.list_session_messages("session-one", workspace=c.workspace,
                                           settings=c.settings, chain=c.chain)
    assert raised.value.status_code == 503
    assert raised.value.detail == "Conversation history is unavailable. Please retry."
    c.chain.get_session_history.assert_not_called()
    assert c.logger.warning.call_args.kwargs == {"workspace_id": "workspace-one"}


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", ["credential", "configuration"])
async def test_private_read_missing_authority_never_becomes_local_demo(private_read_context, missing):
    c = private_read_context
    if missing == "credential":
        c.workspace = replace(c.workspace, user=replace(c.workspace.user, access_token=None))
    else:
        c.settings = Settings(_env_file=None)
    with pytest.raises(HTTPException) as raised:
        await routes.list_session_messages("session-one", workspace=c.workspace,
                                           settings=c.settings, chain=c.chain)
    assert raised.value.status_code == 503
    c.chain.get_session_history.assert_not_called()
    c.repository.list_authorized_messages.assert_not_awaited()


@pytest.mark.asyncio
async def test_private_read_returns_only_authorized_durable_records(private_read_context):
    c = private_read_context
    c.repository.list_authorized_messages.return_value = [
        {"role": "user", "content": "own durable question", "sources": [], "metadata": {}}]
    response = await routes.list_session_messages("session-one", workspace=c.workspace,
                                                  settings=c.settings, chain=c.chain)
    assert response.total == 1 and response.messages[0].content == "own durable question"
    c.chain.get_session_history.assert_not_called()


@pytest.mark.asyncio
async def test_private_read_cancellation_propagates_without_memory(private_read_context):
    import asyncio

    c = private_read_context
    c.repository.list_authorized_messages.side_effect = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await routes.list_session_messages("session-one", workspace=c.workspace,
                                           settings=c.settings, chain=c.chain)
    c.chain.get_session_history.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [None, {}, [None], [True], [{"content": "unscoped"}],
    [{"workspace_id": "other", "session_id": SESSION}],
    [{"workspace_id": WORKSPACE, "session_id": "other"}]])
async def test_authorized_repository_rejects_unscoped_or_malformed_receipts(rows):
    transport = SimpleNamespace(rpc_as_user=AsyncMock(return_value=rows))
    repo = MessageRepository(transport)
    with pytest.raises(ValueError, match="Unconfirmed history read response"):
        await repo.list_authorized_messages(workspace_id=WORKSPACE,
            session_id=SESSION, access_token="synthetic.user.token")
    transport.rpc_as_user.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("rows", [[], [{"workspace_id": WORKSPACE,
    "session_id": SESSION, "content": "authorized"}]])
async def test_authorized_repository_preserves_rls_result_and_scope(rows):
    transport = SimpleNamespace(rpc_as_user=AsyncMock(return_value=rows))
    repo = MessageRepository(transport)
    assert await repo.list_authorized_messages(workspace_id=WORKSPACE,
        session_id=SESSION, access_token="synthetic.user.token") == rows
    transport.rpc_as_user.assert_awaited_once_with("read_private_history",
        {"p_workspace": WORKSPACE, "p_session": SESSION, "p_limit": 50},
        access_token="synthetic.user.token")


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [200, 401, 403, 500])
@pytest.mark.parametrize("public_key", ["sb_publishable_synthetic", "legacy-public"])
async def test_user_read_transport_never_retries_with_service_credentials(monkeypatch, status, public_key):
    calls = []

    class Transport:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            return httpx.Response(status, json=[], request=httpx.Request(method, url))

    monkeypatch.setattr("src.infrastructure.supabase_client.httpx.AsyncClient",
                        lambda **_: Transport())
    client = SupabaseClient(Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key=public_key, supabase_service_role_key="sb_secret_synthetic",
        supabase_legacy_service_role_key="synthetic-legacy-service"))
    if status == 200:
        assert await client.rpc_as_user("read_private_history", {},
            access_token="synthetic.user.token") == []
    else:
        with pytest.raises(httpx.HTTPStatusError):
            await client.rpc_as_user("read_private_history", {},
                access_token="synthetic.user.token")
    assert calls == [("POST", "https://example.supabase.co/rest/v1/rpc/read_private_history", {
        "headers": {"apikey": public_key, "Authorization": "Bearer synthetic.user.token",
                    "Content-Type": "application/json"}, "json": {}})]


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "", " bad", "bad\r\nInjected: value", "bad\x00token"])
async def test_user_read_missing_or_malformed_credential_never_opens_transport(monkeypatch, token):
    constructor = MagicMock()
    monkeypatch.setattr("src.infrastructure.supabase_client.httpx.AsyncClient", constructor)
    client = SupabaseClient(Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key="public", supabase_service_role_key="sb_secret_synthetic"))
    with pytest.raises(ValueError, match="User credential is required"):
        await client.rpc_as_user("read_private_history", {}, access_token=token)
    constructor.assert_not_called()


def test_validated_user_credential_is_not_in_repr(monkeypatch):
    from src.api.auth import authenticate_supabase_token

    monkeypatch.setattr("src.api.auth._decode_supabase_jwt", lambda *_: {
        "sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"})
    user = authenticate_supabase_token("synthetic.user.token", Settings(_env_file=None))
    assert user.access_token == "synthetic.user.token"
    assert "synthetic.user.token" not in repr(user)


@pytest.mark.asyncio
@pytest.mark.parametrize("payload", [None, {}, "[]", False])
async def test_user_read_transport_rejects_non_list_json(monkeypatch, payload):
    class Transport:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def request(self, method, url, **kwargs):
            return httpx.Response(200, content=json.dumps(payload).encode(),
                                  request=httpx.Request(method, url))

    monkeypatch.setattr("src.infrastructure.supabase_client.httpx.AsyncClient", lambda **_: Transport())
    client = SupabaseClient(Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key="public", supabase_service_role_key="sb_secret_synthetic"))
    with pytest.raises(ValueError, match="Unconfirmed user read response"):
        await client.rpc_as_user("read_private_history", {}, access_token="synthetic.user.token")


@pytest.mark.asyncio
async def test_user_read_rejects_secret_key_in_public_configuration(monkeypatch):
    constructor = MagicMock()
    monkeypatch.setattr("src.infrastructure.supabase_client.httpx.AsyncClient", constructor)
    client = SupabaseClient(Settings(_env_file=None, supabase_url="https://example.supabase.co",
        supabase_anon_key="sb_secret_wrong_public", supabase_service_role_key="sb_secret_synthetic"))
    with pytest.raises(SupabaseNotConfiguredError, match="A public API key is required"):
        await client.rpc_as_user("read_private_history", {}, access_token="synthetic.user.token")
    constructor.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("alternate", [SESSION.upper(), SESSION.replace("-", "")])
async def test_authorized_read_normalizes_uuid_input(alternate):
    rows = [{"workspace_id": WORKSPACE, "session_id": SESSION}]
    transport = SimpleNamespace(rpc_as_user=AsyncMock(return_value=rows))
    assert await MessageRepository(transport).list_authorized_messages(
        workspace_id=WORKSPACE.replace("-", ""), session_id=alternate,
        access_token="synthetic.user.token") == rows
    transport.rpc_as_user.assert_awaited_once_with("read_private_history",
        {"p_workspace": WORKSPACE, "p_session": SESSION, "p_limit": 50},
        access_token="synthetic.user.token")


@pytest.mark.asyncio
@pytest.mark.parametrize("limit", [None, True, 0, 101, "50"])
async def test_authorized_read_rejects_bad_limit_before_transport(limit):
    transport = SimpleNamespace(rpc_as_user=AsyncMock())
    with pytest.raises(ValueError):
        await MessageRepository(transport).list_authorized_messages(
            workspace_id=WORKSPACE, session_id=SESSION,
            access_token="synthetic.user.token", limit=limit)
    transport.rpc_as_user.assert_not_called()


@pytest.mark.parametrize("authorization", ["Bearer synthetic.invalid", "Bearer expired", "", "Basic invalid"])
def test_bearer_request_never_downgrades_to_demo(monkeypatch, authorization):
    from fastapi import FastAPI, Depends
    from fastapi.testclient import TestClient
    from src.api import auth

    app = FastAPI()
    settings = Settings(_env_file=None, enable_anonymous_demo=True,
        supabase_url="https://example.supabase.co", supabase_anon_key="public",
        supabase_service_role_key="sb_secret_synthetic", supabase_jwt_secret="synthetic-signing-key")
    app.dependency_overrides[auth.get_settings] = lambda: settings
    app.dependency_overrides[auth.get_supabase_client] = lambda: SimpleNamespace()
    def reject(*_):
        raise HTTPException(status_code=401, detail="Invalid token")
    monkeypatch.setattr(auth, "authenticate_supabase_token", reject)

    @app.get("/guard")
    def guard(context=Depends(auth.require_enterprise_workspace_role(WorkspaceRole.VIEWER))):
        return {"demo": context is None}

    with TestClient(app) as client:
        assert client.get("/guard").json() == {"demo": True}
        response = client.get("/guard", headers={"Authorization": authorization})
    assert response.status_code == 401


def test_valid_bearer_demo_mode_still_checks_workspace_and_role(monkeypatch):
    from fastapi import FastAPI, Depends
    from fastapi.testclient import TestClient
    from src.api import auth

    app = FastAPI()
    settings = Settings(_env_file=None, enable_anonymous_demo=True,
        supabase_url="https://example.supabase.co", supabase_anon_key="public",
        supabase_service_role_key="sb_secret_synthetic", supabase_jwt_secret="synthetic-signing-key")
    app.dependency_overrides[auth.get_settings] = lambda: settings
    app.dependency_overrides[auth.get_supabase_client] = lambda: SimpleNamespace()
    user = CurrentUser(id="actor", email=None, role="authenticated", claims={},
                       access_token="synthetic.user.token")
    context = WorkspaceContext(workspace_id=WORKSPACE, user=user, role=WorkspaceRole.VIEWER)
    lookup = AsyncMock(return_value=context)
    monkeypatch.setattr(auth, "authenticate_supabase_token", lambda *_: user)
    monkeypatch.setattr(auth, "resolve_workspace_context", lookup)

    @app.get("/guard")
    def guard(context=Depends(auth.require_enterprise_workspace_role(WorkspaceRole.VIEWER))):
        return {"demo": context is None, "workspace": context.workspace_id}

    with TestClient(app) as client:
        response = client.get("/guard", headers={"Authorization": "Bearer synthetic.user.token",
                                                 "X-Nexus-Workspace-Id": WORKSPACE})
    assert response.status_code == 200 and response.json() == {"demo": False, "workspace": WORKSPACE}
    lookup.assert_awaited_once()

