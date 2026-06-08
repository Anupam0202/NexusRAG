"""Supabase REST client contract tests."""

from __future__ import annotations

import pytest

from config.settings import Settings
from src.infrastructure.supabase_client import SupabaseClient


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
