"""Workspace and membership persistence."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.api.auth import WorkspaceRole
from src.repositories.base import SupabaseRepository, and_query, encoded, eq_filter, first_row


class WorkspaceRepository(SupabaseRepository):
    async def ensure_profile(
        self,
        *,
        user_id: str,
        email: str | None = None,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_upsert(
            "profiles",
            {
                "id": user_id,
                "email": email,
            },
            on_conflict="id",
        )
        return first_row(rows)

    async def get_workspace(self, workspace_id: str) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "workspaces",
            query=and_query("select=*", eq_filter("id", workspace_id), "limit=1"),
        )
        return first_row(rows)

    async def find_profile(self, email_or_user_id: str) -> dict[str, Any] | None:
        value = email_or_user_id.strip()
        try:
            UUID(value)
            column = "id"
        except ValueError:
            column = "email"
        rows = await self._supabase.table_select(
            "profiles",
            query=and_query(
                "select=id,email,display_name,avatar_url",
                f"{column}=eq.{encoded(value)}",
                "limit=1",
            ),
        )
        return first_row(rows)

    async def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "workspace_members",
            query=(
                "select=role,created_at,workspaces(id,name,slug,plan,owner_id,created_at,updated_at)&"
                f"{eq_filter('user_id', user_id)}&order=created_at.asc"
            ),
        )

    async def list_members(self, workspace_id: str) -> list[dict[str, Any]]:
        return await self._supabase.table_select(
            "workspace_members",
            query=(
                "select=user_id,role,created_at,profiles(id,email,display_name,avatar_url)&"
                f"{eq_filter('workspace_id', workspace_id)}&order=created_at.asc"
            ),
        )

    async def get_membership(
        self,
        *,
        workspace_id: str,
        user_id: str,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_select(
            "workspace_members",
            query=and_query(
                "select=workspace_id,user_id,role,created_at",
                eq_filter("workspace_id", workspace_id),
                eq_filter("user_id", user_id),
                "limit=1",
            ),
        )
        return first_row(rows)

    async def create_workspace(
        self,
        *,
        name: str,
        slug: str,
        owner_id: str,
        plan: str = "free",
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "workspaces",
            {
                "name": name,
                "slug": slug,
                "owner_id": owner_id,
                "plan": plan,
            },
        )
        workspace = rows[0]
        workspace_id = str(workspace["id"])
        await self.add_member(
            workspace_id=workspace_id,
            user_id=owner_id,
            role=WorkspaceRole.OWNER,
        )
        await self._supabase.table_upsert(
            "workspace_settings",
            {"workspace_id": workspace_id},
            on_conflict="workspace_id",
        )
        return workspace

    async def add_member(
        self,
        *,
        workspace_id: str,
        user_id: str,
        role: WorkspaceRole,
    ) -> dict[str, Any]:
        rows = await self._supabase.table_insert(
            "workspace_members",
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "role": role.value,
            },
        )
        return rows[0]

    async def remove_member(self, *, workspace_id: str, user_id: str) -> int:
        rows = await self._supabase.table_delete(
            "workspace_members",
            query=and_query(eq_filter("workspace_id", workspace_id), eq_filter("user_id", user_id)),
        )
        return len(rows)

    async def delete_workspace_members(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_delete(
            "workspace_members",
            query=eq_filter("workspace_id", workspace_id),
        )
        return len(rows)

    async def update_member_role(
        self,
        *,
        workspace_id: str,
        user_id: str,
        role: WorkspaceRole,
    ) -> dict[str, Any] | None:
        rows = await self._supabase.table_update(
            "workspace_members",
            {"role": role.value},
            query=and_query(
                eq_filter("workspace_id", workspace_id),
                eq_filter("user_id", user_id),
            ),
        )
        return first_row(rows)

    async def delete_workspace(self, *, workspace_id: str) -> int:
        rows = await self._supabase.table_delete(
            "workspaces",
            query=eq_filter("id", workspace_id),
        )
        return len(rows)
