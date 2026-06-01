"""Workspace API tests."""

from __future__ import annotations

from uuid import uuid4

import jwt
import pytest
from fastapi.testclient import TestClient

from config.settings import get_settings
from src.infrastructure.supabase_client import get_supabase_client


class FakeWorkspaceSupabase:
    def __init__(self, *, workspace_id: str, user_id: str, role: str = "admin") -> None:
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.role = role
        self.select_queries: list[tuple[str, str]] = []
        self.inserts: list[tuple[str, dict]] = []
        self.upserts: list[tuple[str, dict, str | None]] = []

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict]:
        self.select_queries.append((table, query))
        assert service_role is True
        if table != "workspace_members":
            raise AssertionError(f"unexpected table_select {table}")

        if "profiles(" in query:
            return [
                {
                    "user_id": self.user_id,
                    "role": self.role,
                    "created_at": "2026-06-01T00:00:00Z",
                    "profiles": {
                        "id": self.user_id,
                        "email": "owner@example.com",
                        "display_name": "Owner",
                        "avatar_url": None,
                    },
                }
            ]

        if "workspaces(" in query:
            return [
                {
                    "role": self.role,
                    "created_at": "2026-06-01T00:00:00Z",
                    "workspaces": {
                        "id": self.workspace_id,
                        "name": "Acme Research",
                        "slug": "acme-research",
                        "plan": "free",
                        "owner_id": self.user_id,
                        "created_at": "2026-06-01T00:00:00Z",
                        "updated_at": "2026-06-01T00:00:00Z",
                    },
                }
            ]

        return [{"workspace_id": self.workspace_id, "role": self.role}]

    async def table_insert(
        self,
        table: str,
        payload: dict,
        *,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict]:
        self.inserts.append((table, payload))
        assert table == "workspaces"
        assert service_role is True
        return [
            {
                "id": self.workspace_id,
                "created_at": "2026-06-01T00:00:00Z",
                "updated_at": "2026-06-01T00:00:00Z",
                **payload,
            }
        ]

    async def table_upsert(
        self,
        table: str,
        payload: dict,
        *,
        on_conflict: str | None = None,
        service_role: bool = True,
        prefer: str = "resolution=merge-duplicates,return=representation",
    ) -> list[dict]:
        self.upserts.append((table, payload, on_conflict))
        assert service_role is True
        return [payload]


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
        yield jwt_secret
    finally:
        get_settings.cache_clear()
        get_supabase_client.cache_clear()


def _token(user_id: str, secret: str) -> str:
    return jwt.encode(
        {"sub": user_id, "email": "owner@example.com", "aud": "authenticated"},
        secret,
        algorithm="HS256",
    )


def test_list_workspaces_returns_user_memberships(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.get(
        "/api/v1/workspaces",
        headers={"Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["workspaces"][0]["id"] == workspace_id
    assert body["workspaces"][0]["role"] == "admin"


def test_create_workspace_ensures_profile_and_owner_membership(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.post(
        "/api/v1/workspaces",
        json={"name": "Acme Research!"},
        headers={"Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == workspace_id
    assert body["slug"] == "acme-research"
    assert body["role"] == "owner"
    assert (
        "profiles",
        {"id": user_id, "email": "owner@example.com"},
        "id",
    ) in fake_supabase.upserts
    assert any(table == "workspace_members" for table, _, _ in fake_supabase.upserts)
    assert any(table == "workspace_settings" for table, _, _ in fake_supabase.upserts)


def test_list_current_workspace_members_returns_profiles(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.get(
        "/api/v1/workspaces/current/members",
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["workspace_id"] == workspace_id
    assert body["total"] == 1
    assert body["members"][0]["email"] == "owner@example.com"
