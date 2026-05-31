"""Authentication boundary tests."""

from __future__ import annotations

from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from config.settings import get_settings
from src.infrastructure.supabase_client import get_supabase_client


class FakeSupabaseClient:
    def __init__(self, *, workspace_id: str, role: str) -> None:
        self.workspace_id = workspace_id
        self.role = role
        self.last_query = ""

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict]:
        self.last_query = query
        assert table == "workspace_members"
        assert service_role is True
        return [{"workspace_id": self.workspace_id, "role": self.role}]


@pytest.fixture
def enterprise_auth_env(monkeypatch):
    jwt_secret = "test-secret-with-at-least-thirty-two-bytes"
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", jwt_secret)
    monkeypatch.setenv("ENABLE_ANONYMOUS_DEMO", "false")
    get_settings.cache_clear()
    get_supabase_client.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()
        get_supabase_client.cache_clear()


def test_auth_me_requires_bearer_token(test_client: TestClient) -> None:
    response = test_client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("get", "/api/v1/documents", {}),
        (
            "post",
            "/api/v1/documents/upload",
            {"files": {"file": ("auth.txt", b"auth", "text/plain")}},
        ),
        ("delete", "/api/v1/documents/auth.txt", {}),
        ("post", "/api/v1/chat", {"json": {"question": "hello"}}),
        ("post", "/api/v1/chat/sessions/test/clear", {}),
        ("get", "/api/v1/settings", {}),
        ("patch", "/api/v1/settings", {"json": {"retrieval_top_k": 3}}),
        ("post", "/api/v1/apikey", {"json": {"api_key": "x" * 20}}),
        ("get", "/api/v1/apikey", {}),
        ("get", "/api/v1/analytics/summary", {}),
        ("get", "/api/v1/audit", {}),
    ],
)
def test_enterprise_routes_require_bearer_token(
    test_client: TestClient,
    enterprise_auth_env,
    method: str,
    path: str,
    kwargs: dict,
) -> None:
    response = getattr(test_client, method)(path, **kwargs)

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


def test_enterprise_routes_accept_nexus_workspace_header(
    test_client: TestClient,
    enterprise_auth_env,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeSupabaseClient(workspace_id=workspace_id, role="viewer")
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase
    token = jwt.encode(
        {"sub": user_id, "email": "reader@example.com", "aud": "authenticated"},
        "test-secret-with-at-least-thirty-two-bytes",
        algorithm="HS256",
    )

    response = test_client.get(
        "/api/v1/documents",
        headers={
            "Authorization": f"Bearer {token}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 200
    assert f"workspace_id=eq.{workspace_id}" in fake_supabase.last_query


def test_enterprise_write_routes_enforce_workspace_role(
    test_client: TestClient,
    enterprise_auth_env,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    app.dependency_overrides[get_supabase_client] = lambda: FakeSupabaseClient(
        workspace_id=workspace_id,
        role="viewer",
    )
    token = jwt.encode(
        {"sub": user_id, "aud": "authenticated"},
        "test-secret-with-at-least-thirty-two-bytes",
        algorithm="HS256",
    )

    response = test_client.patch(
        "/api/v1/settings",
        json={"retrieval_top_k": 3},
        headers={
            "Authorization": f"Bearer {token}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient workspace permissions."


def test_enterprise_websocket_requires_access_token(
    test_client: TestClient,
    enterprise_auth_env,
) -> None:
    with test_client.websocket_connect("/ws/chat") as websocket:
        websocket.send_json({"type": "auth", "workspace_id": str(uuid4())})
        frame = websocket.receive_json()
        assert frame["type"] == "error"
        assert frame["error_code"] == "AUTH_REQUIRED"
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_text()
