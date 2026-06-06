"""Supabase REST and Storage helper.

This module intentionally uses the existing ``httpx`` dependency instead of a
heavy global SDK singleton. It keeps Supabase access explicit, testable, and
safe to replace with a richer repository layer as the enterprise migration
continues.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import httpx

from config.settings import Settings, get_settings


class SupabaseNotConfiguredError(RuntimeError):
    """Raised when Supabase operations are requested without configuration."""


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    anon_key: str
    service_role_key: str
    storage_bucket: str

    @property
    def is_configured(self) -> bool:
        return bool(self.url and self.anon_key and self.service_role_key)


class SupabaseClient:
    """Small async client for Supabase PostgREST and Storage APIs."""

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self.config = SupabaseConfig(
            url=self._settings.supabase_url.rstrip("/"),
            anon_key=self._settings.supabase_anon_key,
            service_role_key=self._settings.supabase_service_role_key,
            storage_bucket=self._settings.supabase_storage_bucket,
        )

    @property
    def is_configured(self) -> bool:
        return self.config.is_configured

    def require_configured(self) -> None:
        if not self.is_configured:
            raise SupabaseNotConfiguredError(
                "Supabase is not configured. Set SUPABASE_URL, "
                "SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY, and "
                "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY."
            )

    def auth_headers(self, *, service_role: bool = True) -> dict[str, str]:
        self.require_configured()
        key = self.config.service_role_key if service_role else self.config.anon_key
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    async def table_select(
        self,
        table: str,
        *,
        query: str = "select=*",
        service_role: bool = True,
    ) -> list[dict[str, Any]]:
        """Read rows from a PostgREST table."""
        self.require_configured()
        url = f"{self.config.url}/rest/v1/{table}?{query}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=self.auth_headers(service_role=service_role))
            response.raise_for_status()
            data = response.json()
            return data if isinstance(data, list) else [data]

    async def table_insert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        """Insert rows into a PostgREST table."""
        self.require_configured()
        headers = {**self.auth_headers(service_role=service_role), "Prefer": prefer}
        url = f"{self.config.url}/rest/v1/{table}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json() if response.content else []
            return data if isinstance(data, list) else [data]

    async def table_upsert(
        self,
        table: str,
        payload: dict[str, Any] | list[dict[str, Any]],
        *,
        on_conflict: str | None = None,
        service_role: bool = True,
        prefer: str = "resolution=merge-duplicates,return=representation",
    ) -> list[dict[str, Any]]:
        """Upsert rows into a PostgREST table."""
        self.require_configured()
        headers = {**self.auth_headers(service_role=service_role), "Prefer": prefer}
        url = f"{self.config.url}/rest/v1/{table}"
        if on_conflict:
            url = f"{url}?on_conflict={on_conflict}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json() if response.content else []
            return data if isinstance(data, list) else [data]

    async def table_update(
        self,
        table: str,
        payload: dict[str, Any],
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        """Update rows in a PostgREST table."""
        self.require_configured()
        headers = {**self.auth_headers(service_role=service_role), "Prefer": prefer}
        url = f"{self.config.url}/rest/v1/{table}?{query}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.patch(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json() if response.content else []
            return data if isinstance(data, list) else [data]

    async def table_delete(
        self,
        table: str,
        *,
        query: str,
        service_role: bool = True,
        prefer: str = "return=representation",
    ) -> list[dict[str, Any]]:
        """Delete rows from a PostgREST table."""
        self.require_configured()
        headers = {**self.auth_headers(service_role=service_role), "Prefer": prefer}
        url = f"{self.config.url}/rest/v1/{table}?{query}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.delete(url, headers=headers)
            response.raise_for_status()
            data = response.json() if response.content else []
            return data if isinstance(data, list) else [data]

    async def rpc(
        self,
        function_name: str,
        payload: dict[str, Any],
        *,
        service_role: bool = True,
    ) -> Any:
        """Call a Supabase PostgREST RPC function."""
        self.require_configured()
        url = f"{self.config.url}/rest/v1/rpc/{function_name}"
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                url,
                json=payload,
                headers=self.auth_headers(service_role=service_role),
            )
            response.raise_for_status()
            if not response.content:
                return []
            return response.json()

    async def upload_object(
        self,
        path: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
        upsert: bool = False,
    ) -> None:
        """Upload an original document to Supabase Storage."""
        self.require_configured()
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
            "Content-Type": content_type,
            "x-upsert": "true" if upsert else "false",
        }
        url = (
            f"{self.config.url}/storage/v1/object/"
            f"{self.config.storage_bucket}/{path.lstrip('/')}"
        )
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(url, content=content, headers=headers)
            response.raise_for_status()

    async def download_object(self, path: str) -> bytes:
        """Download an object from Supabase Storage."""
        self.require_configured()
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
        }
        url = (
            f"{self.config.url}/storage/v1/object/"
            f"{self.config.storage_bucket}/{path.lstrip('/')}"
        )
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return response.content

    async def delete_object(self, path: str) -> None:
        """Delete an original document from the configured private bucket."""
        self.require_configured()
        headers = {
            "apikey": self.config.service_role_key,
            "Authorization": f"Bearer {self.config.service_role_key}",
        }
        url = (
            f"{self.config.url}/storage/v1/object/"
            f"{self.config.storage_bucket}"
        )
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.delete(
                url,
                json={"prefixes": [path.lstrip("/")]},
                headers=headers,
            )
            response.raise_for_status()


@lru_cache(maxsize=1)
def get_supabase_client() -> SupabaseClient:
    return SupabaseClient()
