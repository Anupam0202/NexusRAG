"""Shared helpers for Supabase repository implementations."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from src.infrastructure.supabase_client import SupabaseClient, get_supabase_client


def encoded(value: str) -> str:
    """Encode a value for PostgREST filter syntax."""
    return quote(value, safe="")


def eq_filter(column: str, value: str) -> str:
    return f"{column}=eq.{encoded(value)}"


def and_query(*filters: str) -> str:
    return "&".join(filter(None, filters))


def first_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return rows[0] if rows else None


class SupabaseRepository:
    def __init__(self, supabase: SupabaseClient | None = None) -> None:
        self._supabase = supabase or get_supabase_client()
