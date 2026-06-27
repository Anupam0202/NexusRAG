"""Supabase REST client contract tests."""

from __future__ import annotations

import pytest

from config.settings import Settings
from src.infrastructure.supabase_client import SupabaseClient, SupabaseNotConfiguredError


def test_modern_secret_key_is_not_sent_as_bearer_token() -> None:
    client = SupabaseClient(
        Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="sb_publishable_public",
            supabase_service_role_key="sb_secret_private",
        )
    )

    headers = client.auth_headers()

    assert headers["apikey"] == "sb_secret_private"
    assert "Authorization" not in headers


def test_legacy_service_role_key_remains_a_bearer_token() -> None:
    client = SupabaseClient(
        Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="legacy-anon",
            supabase_service_role_key="legacy-service-role",
        )
    )

    headers = client.auth_headers()

    assert headers["Authorization"] == "Bearer legacy-service-role"


@pytest.mark.asyncio
async def test_service_role_requests_fall_back_to_legacy_key_after_rejected_secret(
    monkeypatch,
) -> None:
    calls: list[dict] = []

    class FakeResponse:
        def __init__(self, status_code: int, payload: list[dict] | None = None) -> None:
            self.status_code = status_code
            self._payload = payload or []
            self.content = b"[]" if payload is not None else b""
            self.request = None

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise AssertionError("The client should retry before surfacing 401")

        def json(self):
            return self._payload

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url: str, **kwargs):
            calls.append({"url": url, **kwargs})
            if len(calls) == 1:
                return FakeResponse(401)
            return FakeResponse(200, [{"id": "profile-1"}])

    monkeypatch.setattr(
        "src.infrastructure.supabase_client.httpx.AsyncClient",
        lambda **_kwargs: FakeAsyncClient(),
    )
    client = SupabaseClient(
        Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="anon",
            supabase_service_role_key="stale-secret",
            supabase_legacy_service_role_key="valid-legacy-service-role",
        )
    )

    rows = await client.table_select("profiles", query="select=id&limit=1")

    assert rows == [{"id": "profile-1"}]
    assert len(calls) == 2
    assert calls[0]["headers"]["apikey"] == "stale-secret"
    assert calls[1]["headers"]["apikey"] == "valid-legacy-service-role"
    assert calls[1]["headers"]["Authorization"] == "Bearer valid-legacy-service-role"


def test_public_key_in_service_role_slot_is_rejected() -> None:
    client = SupabaseClient(
        Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="sb_publishable_public",
            supabase_service_role_key="sb_publishable_public",
        )
    )

    assert client.is_configured is False
    with pytest.raises(SupabaseNotConfiguredError):
        client.auth_headers()


@pytest.mark.asyncio
async def test_delete_object_uses_storage_remove_contract(monkeypatch) -> None:
    calls: list[dict] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class FakeAsyncClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def delete(self, url: str, **kwargs):
            calls.append({"url": url, **kwargs})
            return FakeResponse()

    monkeypatch.setattr(
        "src.infrastructure.supabase_client.httpx.AsyncClient",
        lambda **_kwargs: FakeAsyncClient(),
    )
    client = SupabaseClient(
        Settings(
            supabase_url="https://project.supabase.co",
            supabase_anon_key="anon",
            supabase_service_role_key="sb_secret_private",
        )
    )

    await client.delete_object("workspace/document/report.pdf")

    assert calls[0]["url"] == "https://project.supabase.co/storage/v1/object/documents"
    assert calls[0]["json"] == {"prefixes": ["workspace/document/report.pdf"]}
    assert calls[0]["headers"]["apikey"] == "sb_secret_private"
    assert "Authorization" not in calls[0]["headers"]
