"""Workspace API tests."""

from __future__ import annotations

from uuid import uuid4

import httpx
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
        self.updates: list[tuple[str, dict, str]] = []
        self.deletes: list[tuple[str, str]] = []
        self.target_user_id = str(uuid4())
        self.target_email = "member@example.com"
        self.target_role = "viewer"
        self.target_is_member = False

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict]:
        self.select_queries.append((table, query))
        assert service_role is True
        if table == "profiles":
            return [
                {
                    "id": self.target_user_id,
                    "email": self.target_email,
                    "display_name": "Member",
                    "avatar_url": None,
                }
            ]
        if table != "workspace_members":
            raise AssertionError(f"unexpected table_select {table}")

        if "profiles(" in query:
            return [
                {
                    "user_id": self.target_user_id,
                    "role": self.target_role,
                    "created_at": "2026-06-01T00:00:00Z",
                    "profiles": {
                        "id": self.target_user_id,
                        "email": self.target_email,
                        "display_name": "Member",
                        "avatar_url": None,
                    },
                }
            ]

        if "workspaces(" in query or "workspaces!inner(id,name" in query:
            return [
                {
                    "workspace_id": self.workspace_id,
                    "role": self.role,
                    "created_at": "2026-06-01T00:00:00Z",
                    "workspaces": {
                        "id": self.workspace_id,
                        "name": "Acme Research",
                        "lifecycle_state": "active",
                        "slug": "acme-research",
                        "plan": "free",
                        "owner_id": self.user_id,
                        "created_at": "2026-06-01T00:00:00Z",
                        "updated_at": "2026-06-01T00:00:00Z",
                    },
                }
            ]

        if self.target_user_id in query and self.target_is_member:
            return [
                {
                    "workspace_id": self.workspace_id,
                    "user_id": self.target_user_id,
                    "role": self.target_role,
                }
            ]
        if self.user_id in query:
            return [
                {
                    "workspace_id": self.workspace_id,
                    "user_id": self.user_id,
                    "role": self.role,
                }
            ]
        return []

    async def table_count(
        self, table: str, *, query: str, service_role: bool = True
    ) -> int:
        assert table == "workspace_members"
        assert service_role is True
        assert query in {
            f"select=user_id&workspace_id=eq.{self.workspace_id}",
            f"select=workspace_id,workspaces!inner(id)&user_id=eq.{self.user_id}&workspaces.lifecycle_state=eq.active",
        }
        return 1

    async def rpc(self, name, payload, *, service_role=True):
        assert name == "nexus_invitation_version"
        assert service_role is True
        return {"version": "039"}

    async def table_insert(
        self,
        table: str,
        payload: dict,
        *,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict]:
        self.inserts.append((table, payload))
        assert service_role is True
        if table == "audit_events":
            return [{"id": str(uuid4()), **payload}]
        if table == "workspace_members":
            return [{"created_at": "2026-06-01T00:00:00Z", **payload}]
        assert table == "workspaces"
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

    async def table_update(
        self,
        table: str,
        payload: dict,
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict]:
        self.updates.append((table, payload, query))
        assert service_role is True
        return [
            {
                "workspace_id": self.workspace_id,
                "user_id": self.target_user_id,
                **payload,
            }
        ]

    async def table_delete(
        self,
        table: str,
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict]:
        self.deletes.append((table, query))
        assert service_role is True
        return [{"workspace_id": self.workspace_id, "user_id": self.target_user_id}]


def _supabase_http_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request(
        "GET", "https://example.supabase.co/rest/v1/workspace_members"
    )
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(
        f"Supabase returned HTTP {status_code}",
        request=request,
        response=response,
    )


class RejectingSupabase:
    async def table_count(self, *args, **kwargs) -> int:
        raise _supabase_http_error(401)

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict]:
        raise _supabase_http_error(401)

    async def table_upsert(self, *args, **kwargs) -> list[dict]:
        raise _supabase_http_error(401)


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
    fake_supabase.target_is_member = True
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


@pytest.mark.parametrize(
    ("method", "path", "kwargs"),
    [
        ("get", "/api/v1/workspaces", {}),
        ("get", "/api/v1/workspaces/current", {}),
        ("post", "/api/v1/workspaces", {"json": {"name": "Acme Research"}}),
    ],
)
def test_workspace_routes_report_rejected_supabase_backend_credentials(
    test_client: TestClient,
    enterprise_auth_env: str,
    method: str,
    path: str,
    kwargs: dict,
) -> None:
    from main import app

    user_id = str(uuid4())
    app.dependency_overrides[get_supabase_client] = lambda: RejectingSupabase()

    response = getattr(test_client, method)(
        path,
        headers={"Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}"},
        **kwargs,
    )

    assert response.status_code == 503
    assert response.json()["detail"] == (
        "Supabase backend persistence credentials are not authorized for this project."
    )


def test_system_status_marks_supabase_data_api_unauthorized(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    app.dependency_overrides[get_supabase_client] = lambda: RejectingSupabase()

    response = test_client.get("/api/v1/status")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["settings"]["supabase_data_api_reachable"] is False
    assert body["settings"]["supabase_data_api_status"] == "unauthorized"


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
    assert any(table == "workspace_members" for table, _ in fake_supabase.inserts)
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
    assert body["members"][0]["email"] == "member@example.com"


def test_admin_can_add_existing_profile_to_workspace(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.post(
        "/api/v1/workspaces/current/members",
        json={"email_or_user_id": fake_supabase.target_email, "role": "editor"},
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 201
    assert response.json()["user_id"] == fake_supabase.target_user_id
    assert response.json()["role"] == "editor"
    assert (
        "workspace_members",
        {
            "workspace_id": workspace_id,
            "user_id": fake_supabase.target_user_id,
            "role": "editor",
        },
    ) in fake_supabase.inserts
    assert any(
        table == "audit_events"
        and payload["action"] == "workspace.member_added"
        and payload["resource_id"] == fake_supabase.target_user_id
        for table, payload in fake_supabase.inserts
    )


@pytest.mark.parametrize("existing_role", ["owner", "admin", "editor", "viewer"])
def test_add_member_rejects_existing_workspace_members(
    test_client: TestClient,
    enterprise_auth_env: str,
    existing_role: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    fake_supabase.target_role = existing_role
    fake_supabase.target_is_member = True
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.post(
        "/api/v1/workspaces/current/members",
        json={"email_or_user_id": fake_supabase.target_email, "role": "viewer"},
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "This user is already a workspace member."
    assert not any(
        table == "workspace_members" for table, _, _ in fake_supabase.upserts
    )


def test_admin_can_update_non_owner_member_role(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    fake_supabase.target_is_member = True
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.patch(
        f"/api/v1/workspaces/current/members/{fake_supabase.target_user_id}",
        json={"role": "editor"},
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 200
    assert response.json()["role"] == "editor"
    assert fake_supabase.updates == [
        (
            "workspace_members",
            {"role": "editor"},
            f"workspace_id=eq.{workspace_id}&user_id=eq.{fake_supabase.target_user_id}",
        )
    ]


def test_owner_membership_cannot_be_removed(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    fake_supabase.target_role = "owner"
    fake_supabase.target_is_member = True
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.delete(
        f"/api/v1/workspaces/current/members/{fake_supabase.target_user_id}",
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "The workspace owner cannot be removed."
    assert fake_supabase.deletes == []


def test_workspace_manager_cannot_remove_themselves(
    test_client: TestClient,
    enterprise_auth_env: str,
) -> None:
    from main import app

    workspace_id = str(uuid4())
    user_id = str(uuid4())
    fake_supabase = FakeWorkspaceSupabase(workspace_id=workspace_id, user_id=user_id)
    app.dependency_overrides[get_supabase_client] = lambda: fake_supabase

    response = test_client.delete(
        f"/api/v1/workspaces/current/members/{user_id}",
        headers={
            "Authorization": f"Bearer {_token(user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": workspace_id,
        },
    )

    assert response.status_code == 409
    assert (
        response.json()["detail"]
        == "You cannot remove yourself from the active workspace."
    )
    assert fake_supabase.deletes == []


class PagedWorkspaceSupabase(FakeWorkspaceSupabase):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        from uuid import UUID

        self.roster = [
            {
                "user_id": str(UUID(int=index)),
                "role": "viewer",
                "profiles": {"email": f"member{index}@example.com"},
            }
            for index in range(1, 206)
        ]
        self.roster_read = False
        self.revoke_after_read = False
        self.count_unavailable = False

    async def table_select(self, table, *, query="select=*", service_role=True):
        if table == "workspace_members" and "profiles(" in query:
            from urllib.parse import parse_qs

            filters = parse_qs(query)
            assert filters["workspace_id"] == [f"eq.{self.workspace_id}"]
            assert filters["order"] == ["user_id.asc"]
            self.select_queries.append((table, query))
            self.roster_read = True
            cursor = filters.get("user_id", ["gt."])[0].removeprefix("gt.")
            return [row for row in self.roster if row["user_id"] > cursor][
                : int(filters["limit"][0])
            ]
        if self.roster_read and self.revoke_after_read and self.user_id in query:
            return []
        return await super().table_select(table, query=query, service_role=service_role)

    async def table_count(self, table, *, query, service_role=True):
        await super().table_count(table, query=query, service_role=service_role)
        if self.count_unavailable:
            raise ValueError("Exact count unavailable")
        return len(self.roster)


def test_members_keyset_pages_report_exact_workspace_total(
    test_client, enterprise_auth_env
):
    from main import app

    fake = PagedWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    app.dependency_overrides[get_supabase_client] = lambda: fake
    headers = {
        "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}",
        "X-Nexus-Workspace-Id": fake.workspace_id,
    }
    cursor = None
    all_ids = []
    for expected_size in (100, 100, 5):
        response = test_client.get(
            "/api/v1/workspaces/current/members",
            headers=headers,
            params={"after": cursor} if cursor else {},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 205 and body["total_is_exact"] is True
        assert len(body["members"]) == expected_size
        all_ids.extend(row["user_id"] for row in body["members"])
        cursor = body["next_after"]
    assert cursor is None
    assert len(set(all_ids)) == 205
    assert all_ids == sorted(all_ids)


@pytest.mark.parametrize(
    "params",
    [
        {"after": "x&workspace_id=eq.foreign"},
        {"limit": 0},
        {"limit": 101},
        {"limit": "many"},
    ],
)
def test_members_reject_invalid_page_inputs(test_client, enterprise_auth_env, params):
    from main import app

    fake = FakeWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces/current/members",
        params=params,
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": fake.workspace_id,
        },
    )
    assert response.status_code == 422
    assert not any("profiles(" in query for _, query in fake.select_queries)


@pytest.mark.parametrize(
    "fault, status", [("revoke_after_read", 403), ("count_unavailable", 503)]
)
def test_members_fail_closed_after_revocation_or_unknown_count(
    test_client, enterprise_auth_env, fault, status
):
    from main import app

    fake = PagedWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    setattr(fake, fault, True)
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces/current/members",
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": fake.workspace_id,
        },
    )
    assert response.status_code == status
    assert "members" not in response.json()


@pytest.mark.parametrize("role", ["owner", "admin", "editor", "viewer"])
def test_all_authorized_member_roles_can_read_bounded_inventory(
    test_client, enterprise_auth_env, role
):
    from main import app

    fake = FakeWorkspaceSupabase(
        workspace_id=str(uuid4()), user_id=str(uuid4()), role=role
    )
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces/current/members",
        params={"limit": 1},
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": fake.workspace_id,
        },
    )
    assert response.status_code == 200
    assert response.json()["total_is_exact"] is True
    assert len(response.json()["members"]) == 1
    assert any("limit=2" in query for _, query in fake.select_queries)


def test_invalid_member_records_are_not_silently_omitted(
    test_client, enterprise_auth_env
):
    from main import app

    fake = FakeWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    fake.target_role = "unknown"
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces/current/members",
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}",
            "X-Nexus-Workspace-Id": fake.workspace_id,
        },
    )
    assert response.status_code == 503
    assert "members" not in response.json()


@pytest.mark.parametrize(
    "params", [{"after": "foreign&user_id=eq.other"}, {"limit": 0}, {"limit": 101}]
)
def test_workspace_inventory_rejects_invalid_page_inputs(
    test_client, enterprise_auth_env, params
):
    from main import app

    fake = FakeWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces",
        params=params,
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}"
        },
    )
    assert response.status_code == 422


def test_workspace_inventory_and_default_discovery_filter_active_authority(
    test_client, enterprise_auth_env
):
    from main import app

    fake = FakeWorkspaceSupabase(workspace_id=str(uuid4()), user_id=str(uuid4()))
    app.dependency_overrides[get_supabase_client] = lambda: fake
    headers = {"Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}"}
    inventory = test_client.get("/api/v1/workspaces", headers=headers)
    assert inventory.status_code == 200
    assert inventory.json()["total_is_exact"] is True
    assert inventory.json()["total"] == 1
    assert inventory.json()["next_after"] is None
    current = test_client.get("/api/v1/workspaces/current", headers=headers)
    assert current.status_code == 200
    assert all(
        "workspaces.lifecycle_state=eq.active" in query
        for table, query in fake.select_queries
        if table == "workspace_members"
    )
    assert any(
        "order=workspace_id.asc&limit=51" in query for _, query in fake.select_queries
    )


class PagedWorkspaceInventory(FakeWorkspaceSupabase):
    def __init__(self, user_id):
        super().__init__(
            workspace_id="00000000-0000-4000-8000-000000000001", user_id=user_id
        )
        self.rows = [
            {
                "workspace_id": f"00000000-0000-4000-8000-{number:012x}",
                "role": "viewer",
                "workspaces": {
                    "id": f"00000000-0000-4000-8000-{number:012x}",
                    "name": f"Research {number}",
                    "slug": f"research-{number}",
                    "lifecycle_state": "active",
                },
            }
            for number in range(1, 206)
        ]
        self.count = 205
        self.fault = None

    async def table_count(self, table, *, query, service_role=True):
        assert f"user_id=eq.{self.user_id}" in query
        assert "workspaces.lifecycle_state=eq.active" in query
        assert "select=workspace_id,workspaces!inner(id)" in query
        assert "workspace_id=gt." not in query
        return self.count

    async def table_select(self, table, *, query="select=*", service_role=True):
        from urllib.parse import parse_qs

        assert table == "workspace_members"
        assert f"user_id=eq.{self.user_id}" in query
        assert "workspaces.lifecycle_state=eq.active" in query
        params = parse_qs(query)
        assert params["order"] == ["workspace_id.asc"]
        page_size = int(params["limit"][0])
        after = params.get("workspace_id", ["gt."])[0][3:]
        rows = [row for row in self.rows if row["workspace_id"] > after][:page_size]
        if self.fault == "inactive":
            rows[-1]["workspaces"]["lifecycle_state"] = "tombstoned"
        elif self.fault == "foreign_id":
            rows[-1]["workspaces"]["id"] = str(uuid4())
        elif self.fault == "role":
            rows[-1]["role"] = "superuser"
        elif self.fault == "oversize":
            rows = self.rows
        elif self.fault == "malformed":
            rows[-1] = None
        return rows


def test_workspace_inventory_three_pages_preserve_exact_actor_total(
    test_client, enterprise_auth_env
):
    from main import app

    fake = PagedWorkspaceInventory(str(uuid4()))
    app.dependency_overrides[get_supabase_client] = lambda: fake
    headers = {"Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}"}
    seen, after = [], None
    for expected_size in (100, 100, 5):
        params = {"limit": 100}
        if after:
            params["after"] = after
        response = test_client.get("/api/v1/workspaces", headers=headers, params=params)
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 205 and body["total_is_exact"] is True
        assert len(body["workspaces"]) == expected_size
        seen.extend(workspace["id"] for workspace in body["workspaces"])
        after = body["next_after"]
    assert after is None
    assert len(set(seen)) == 205
    assert seen == sorted(seen)


@pytest.mark.parametrize("count", [None, True, -1, 2**53, "205"])
def test_workspace_inventory_unknown_or_unsafe_totals_fail_closed(
    test_client, enterprise_auth_env, count
):
    from main import app

    fake = PagedWorkspaceInventory(str(uuid4()))
    fake.count = count
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces",
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}"
        },
    )
    assert response.status_code == 503
    assert "workspaces" not in response.json()


@pytest.mark.parametrize(
    "fault", ["inactive", "foreign_id", "role", "oversize", "malformed"]
)
def test_workspace_inventory_invalid_lookahead_is_not_accepted(
    test_client, enterprise_auth_env, fault
):
    from main import app

    fake = PagedWorkspaceInventory(str(uuid4()))
    fake.fault = fault
    app.dependency_overrides[get_supabase_client] = lambda: fake
    response = test_client.get(
        "/api/v1/workspaces",
        params={"limit": 100},
        headers={
            "Authorization": f"Bearer {_token(fake.user_id, enterprise_auth_env)}"
        },
    )
    assert response.status_code == 503
    assert "workspaces" not in response.json()
