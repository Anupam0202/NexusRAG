"""Supabase REST client contract tests."""

from __future__ import annotations

import pytest

from config.settings import Settings
from src.infrastructure.supabase_client import SupabaseClient


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
            supabase_service_role_key="service",
        )
    )

    await client.delete_object("workspace/document/report.pdf")

    assert calls[0]["url"] == "https://project.supabase.co/storage/v1/object/documents"
    assert calls[0]["json"] == {"prefixes": ["workspace/document/report.pdf"]}
