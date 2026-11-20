"""Actual Python handlers must authorize before effects and confirm atomic turns."""

import asyncio
import copy
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from fastapi import HTTPException, WebSocketDisconnect
from starlette.websockets import WebSocketState

from config.settings import Settings
from src.api import routes, websocket
from src.api.auth import CurrentUser, WorkspaceContext, WorkspaceRole
from src.api.models import QueryRequest
from src.repositories.messages import MessageRepository

WORKSPACE = "11111111-1111-4111-8111-111111111111"
SESSION = "22222222-2222-4222-8222-222222222222"
ACTOR = "33333333-3333-4333-8333-333333333333"
FOREIGN = "44444444-4444-4444-8444-444444444444"


class TurnTransport:
    def __init__(self, *, owner=ACTOR, failure=False):
        self.owner = owner
        self.failure = failure
        self.events = []
        self.writes = []
        self.revision = 4

    async def table_select(self, *args, **kwargs):
        return [{"id": SESSION, "workspace_id": WORKSPACE, "user_id": self.owner,
                 "visibility": "private", "revision": self.revision, "deleted_at": None}]

    async def table_insert(self, table, body, **kwargs):
        if self.failure and body.get("role") == "assistant":
            raise RuntimeError("synthetic second-write failure")
        self.writes.append(body)
        return [body]

    async def rpc(self, name, payload, **kwargs):
        self.events.append((name, copy.deepcopy(payload)))
        assert name == "stage_backend_private_turn"
        return [{"workspace_id": payload["p_workspace"], "session_id": payload["p_session"],
                 "revision": payload["p_revision"], "history_epoch": payload["p_epoch"], "state": "STAGED"}]

    async def rpc_as_user(self, name, payload, **kwargs):
        assert kwargs == {"access_token": "synthetic.user.token"}
        self.events.append((name, copy.deepcopy(payload)))
        if name == "read_backend_private_turn_context":
            if self.owner != ACTOR:
                return []
            return [{"workspace_id": payload["p_workspace"], "session_id": payload["p_session"],
                     "actor_id": ACTOR, "revision": self.revision, "history_epoch": 0, "history": []}]
        assert name == "commit_backend_private_turn"
        if self.failure:
            raise RuntimeError("synthetic atomic transaction rollback")
        if self.owner != ACTOR:
            return []
        self.revision += 1
        return [{"workspace_id": payload["p_workspace"], "session_id": payload["p_session"],
                 "state": "COMMITTED", "revision": self.revision, "history_epoch": 1, "messages_written": 2}]


class SerialSocket:
    client_state = WebSocketState.CONNECTED

    def __init__(self, body, transport):
        self.body = body
        self.transport = transport
        self.sent = []
        self.received = False

    async def accept(self):
        pass

    async def close(self, **kwargs):
        self.client_state = WebSocketState.DISCONNECTED

    async def receive_text(self):
        if self.received:
            raise WebSocketDisconnect()
        self.received = True
        return json.dumps(self.body)

    async def send_json(self, frame):
        self.transport.events.append(("frame", frame["type"]))
        self.sent.append(json.loads(json.dumps(frame)))


@pytest.fixture
def turn_case(monkeypatch):
    transport = TurnTransport()
    repository = MessageRepository(transport)
    for module in (routes, websocket):
        monkeypatch.setattr(module, "MessageRepository", lambda: repository)
        monkeypatch.setattr(module, "persist_provider_health_snapshot", AsyncMock())
        monkeypatch.setattr(module, "get_telemetry_recorder", lambda: telemetry)
    monkeypatch.setattr(routes, "_record_audit_event", AsyncMock())
    telemetry = SimpleNamespace(record_llm_usage=AsyncMock(), record_audit_event=AsyncMock())
    result = {"answer": "synthetic answer", "sources": [{"filename": "synthetic.txt",
        "content": "synthetic evidence"}], "query_type": "general", "confidence": 0.5,
        "response_time_seconds": 0.01, "metadata": {}}
    chain = SimpleNamespace(query=MagicMock(return_value=result), llm=SimpleNamespace(_router=None))
    settings = Settings(_env_file=None, enforce_tenant_quotas=False,
        supabase_url="https://synthetic.invalid", supabase_anon_key="synthetic-public",
        supabase_service_role_key="synthetic-service")
    workspace = WorkspaceContext(WORKSPACE,
        CurrentUser(ACTOR, None, "authenticated", {}, access_token="synthetic.user.token"),
        WorkspaceRole.VIEWER)
    monkeypatch.setattr(websocket, "get_settings", lambda: settings)
    monkeypatch.setattr(websocket, "get_rag_chain", lambda: chain)
    monkeypatch.setattr(websocket, "_receive_workspace_auth", AsyncMock(return_value=workspace))
    return SimpleNamespace(transport=transport, repository=repository, chain=chain,
                           settings=settings, workspace=workspace, telemetry=telemetry)


@pytest.mark.asyncio
async def test_rest_denies_foreign_owner_before_quota_model_or_privileged_write(turn_case, monkeypatch):
    turn_case.transport.owner = FOREIGN
    quota = MagicMock(return_value=SimpleNamespace(usage=AsyncMock(return_value={}), assert_chat_allowed=MagicMock()))
    monkeypatch.setattr(routes, "TenantQuotaEnforcer", quota)
    with pytest.raises(HTTPException) as failure:
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert failure.value.status_code == 403
    quota.assert_not_called()
    turn_case.chain.query.assert_not_called()
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_rest_atomic_failure_never_reports_success_or_a_partial_pair(turn_case):
    turn_case.transport.failure = True
    with pytest.raises(HTTPException) as failure:
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert failure.value.status_code == 503
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_rest_viewer_own_turn_canonicalizes_and_confirms_revision(turn_case):
    response = await routes.chat(QueryRequest(question="synthetic question",
        session_id="{" + SESSION.upper() + "}"), workspace=turn_case.workspace,
        settings=turn_case.settings, chain=turn_case.chain)
    assert response.metadata["session_id"] == SESSION
    assert response.metadata["session_revision"] == 5
    assert [name for name, _ in turn_case.transport.events] == [
        "read_backend_private_turn_context", "read_backend_private_turn_context",
        "stage_backend_private_turn", "commit_backend_private_turn"]
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_websocket_foreign_owner_never_generates_or_emits_done(turn_case):
    turn_case.transport.owner = FOREIGN
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    await websocket.chat_stream(socket)
    assert [frame["type"] for frame in socket.sent] == ["error"]
    turn_case.chain.query.assert_not_called()
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_websocket_done_is_serialized_after_atomic_receipt_with_revision(turn_case):
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    await websocket.chat_stream(socket)
    frames = [frame for frame in socket.sent if frame["type"] == "done"]
    assert len(frames) == 1
    assert frames[0]["metadata"]["session_id"] == SESSION
    assert frames[0]["metadata"]["session_revision"] == 5
    order = [name if name != "frame" else value for name, value in turn_case.transport.events]
    assert order.index("commit_backend_private_turn") < order.index("done")


@pytest.mark.asyncio
async def test_websocket_commit_failure_emits_only_safe_error_not_done(turn_case):
    turn_case.transport.failure = True
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    await websocket.chat_stream(socket)
    assert [frame["type"] for frame in socket.sent] == ["error"]
    assert "synthetic" not in socket.sent[0]["content"]
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_websocket_absent_session_uses_one_durable_uuid_before_generation(turn_case):
    socket = SerialSocket({"question": "synthetic question"}, turn_case.transport)
    await websocket.chat_stream(socket)
    done = next(frame for frame in socket.sent if frame["type"] == "done")
    session = done["metadata"]["session_id"]
    assert str(UUID(session)) == session
    assert turn_case.chain.query.call_args.kwargs["session_id"] == session
    assert all(payload.get("p_session") == session for name, payload in turn_case.transport.events
               if name.endswith("private_turn") or name.endswith("turn_context"))


@pytest.mark.asyncio
async def test_rest_revocation_between_generation_and_commit_is_denied(turn_case):
    def generate(*args, **kwargs):
        turn_case.transport.owner = FOREIGN
        return {"answer": "synthetic answer", "sources": [{"content": "evidence", "filename": "test.txt"}],
                "metadata": {}}
    turn_case.chain.query.side_effect = generate
    with pytest.raises(HTTPException) as failure:
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert failure.value.status_code == 403
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("revision", True), ("revision", "4"),
    ("revision", 2**53), ("history_epoch", -1), ("actor_id", FOREIGN), ("history", {}),
    ("history", [{"role": "assistant", "content": "x" * 5001}])])
async def test_private_context_rejects_malformed_authority_before_staging(turn_case, field, value):
    original = turn_case.transport.rpc_as_user

    async def malformed(name, payload, **kwargs):
        result = await original(name, payload, **kwargs)
        result[0][field] = value
        return result

    turn_case.transport.rpc_as_user = malformed
    with pytest.raises(ValueError):
        await turn_case.repository.read_turn_context(workspace_id=WORKSPACE, session_id=SESSION,
            user_id=ACTOR, access_token="synthetic.user.token")
    assert [name for name, _ in turn_case.transport.events] == ["read_backend_private_turn_context"]


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("state", "UNKNOWN"), ("revision", True),
    ("revision", 4), ("history_epoch", "1"), ("messages_written", True),
    ("messages_written", 1), ("workspace_id", FOREIGN), ("session_id", FOREIGN)])
async def test_rest_malformed_commit_never_returns_success_or_retries(turn_case, field, value):
    original = turn_case.transport.rpc_as_user

    async def malformed(name, payload, **kwargs):
        result = await original(name, payload, **kwargs)
        if name == "commit_backend_private_turn":
            result[0][field] = value
        return result

    turn_case.transport.rpc_as_user = malformed
    with pytest.raises(HTTPException) as failure:
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert failure.value.status_code == 503
    assert [name for name, _ in turn_case.transport.events].count("commit_backend_private_turn") == 1
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
async def test_generation_usage_survives_unconfirmed_rest_commit(turn_case):
    turn_case.transport.failure = True
    with pytest.raises(HTTPException):
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    turn_case.telemetry.record_llm_usage.assert_awaited_once()
    usage = turn_case.telemetry.record_llm_usage.call_args.kwargs
    assert usage["output_tokens"] > 0
    assert usage["success"] is True  # generation succeeded, persistence did not


@pytest.mark.asyncio
async def test_websocket_authority_failure_is_actionable_without_fake_usage(turn_case):
    turn_case.transport.owner = FOREIGN
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    await websocket.chat_stream(socket)
    assert socket.sent[0]["error_code"] == "CONVERSATION_UNAVAILABLE"
    assert socket.sent[0]["status"] == 403
    turn_case.telemetry.record_llm_usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_websocket_usage_survives_unconfirmed_commit(turn_case):
    turn_case.transport.failure = True
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    await websocket.chat_stream(socket)
    turn_case.telemetry.record_llm_usage.assert_awaited_once()
    usage = turn_case.telemetry.record_llm_usage.call_args.kwargs
    assert usage["output_tokens"] > 0 and usage["success"] is True
    assert socket.sent[0]["error_code"] == "CONVERSATION_UNCONFIRMED"
    assert socket.sent[0]["status"] == 503


@pytest.mark.asyncio
async def test_commit_cancellation_is_not_converted_to_success_or_privileged_retry(turn_case):
    original = turn_case.transport.rpc_as_user

    async def cancel(name, payload, **kwargs):
        if name == "commit_backend_private_turn":
            raise asyncio.CancelledError()
        return await original(name, payload, **kwargs)

    turn_case.transport.rpc_as_user = cancel
    with pytest.raises(asyncio.CancelledError):
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert turn_case.transport.writes == []


@pytest.mark.asyncio
@pytest.mark.parametrize("protocol", ["rest", "websocket"])
async def test_authority_lost_during_quota_await_never_reaches_generation(turn_case, monkeypatch, protocol):
    async def quota_read(**kwargs):
        turn_case.transport.owner = FOREIGN
        return {}

    quota = SimpleNamespace(usage=quota_read, assert_chat_allowed=MagicMock())
    module = routes if protocol == "rest" else websocket
    monkeypatch.setattr(module, "TenantQuotaEnforcer", lambda _settings: quota)
    if protocol == "rest":
        with pytest.raises(HTTPException) as failure:
            await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
                workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
        assert failure.value.status_code == 403
    else:
        socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
        await websocket.chat_stream(socket)
        assert socket.sent[0]["status"] == 403
    turn_case.chain.query.assert_not_called()
    assert [name for name, _ in turn_case.transport.events].count("read_backend_private_turn_context") == 2
    assert not any(name == "stage_backend_private_turn" for name, _ in turn_case.transport.events)


@pytest.mark.asyncio
async def test_disconnected_during_generation_skips_commit_but_records_usage(turn_case):
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    original = turn_case.chain.query.return_value

    def disconnect(*args, **kwargs):
        socket.client_state = WebSocketState.DISCONNECTED
        return original

    turn_case.chain.query.side_effect = disconnect
    await websocket.chat_stream(socket)
    assert not any(name == "commit_backend_private_turn" for name, _ in turn_case.transport.events)
    assert socket.sent == []
    turn_case.telemetry.record_llm_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_delivery_lost_after_commit_does_not_erase_durable_turn_or_usage(turn_case):
    socket = SerialSocket({"question": "synthetic question", "session_id": SESSION}, turn_case.transport)
    socket.send_json = AsyncMock(side_effect=WebSocketDisconnect())
    await websocket.chat_stream(socket)
    assert turn_case.transport.revision == 5
    assert socket.sent == []
    turn_case.telemetry.record_llm_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_same_revision_with_changed_history_projection_conflicts(turn_case):
    original = turn_case.transport.rpc_as_user
    reads = 0

    async def changed(name, payload, **kwargs):
        nonlocal reads
        result = await original(name, payload, **kwargs)
        if name == "read_backend_private_turn_context":
            reads += 1
            result[0]["history"] = [{"role": "assistant", "content": "Source withheld" if reads > 1 else "Synthetic source marker"}]
        return result

    turn_case.transport.rpc_as_user = changed
    with pytest.raises(HTTPException) as failure:
        await routes.chat(QueryRequest(question="synthetic question", session_id=SESSION),
            workspace=turn_case.workspace, settings=turn_case.settings, chain=turn_case.chain)
    assert failure.value.status_code == 409
    turn_case.chain.query.assert_not_called()
