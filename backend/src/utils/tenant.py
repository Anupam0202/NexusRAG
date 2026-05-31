"""Tenant helpers shared by demo and enterprise code paths."""

from __future__ import annotations

DEFAULT_WORKSPACE_ID = "00000000-0000-0000-0000-000000000000"


def normalize_workspace_id(workspace_id: str | None) -> str:
    value = (workspace_id or "").strip()
    return value or DEFAULT_WORKSPACE_ID
