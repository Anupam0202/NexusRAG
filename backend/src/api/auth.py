"""Supabase authentication and workspace dependencies.

The current RAG routes still run in compatibility mode. These dependencies are
the enterprise boundary for the next migration step: every document, chunk,
chat session, and setting will be scoped by the returned workspace context.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field

from config.settings import Settings, get_settings
from src.infrastructure.supabase_client import (
    SupabaseClient,
    SupabaseNotConfiguredError,
    get_supabase_client,
)
from src.utils.tenant import DEFAULT_WORKSPACE_ID

JWT_ALGORITHMS = ("RS256", "ES256", "HS256")
AUTHENTICATED_AUDIENCE = "authenticated"
WORKSPACE_HEADER = "X-Nexus-Workspace-Id"
LEGACY_WORKSPACE_HEADER = "X-Workspace-ID"


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    role: str
    claims: dict[str, Any]
    is_demo: bool = False


@dataclass(frozen=True)
class WorkspaceContext:
    workspace_id: str
    user: CurrentUser
    role: WorkspaceRole


class CurrentUserResponse(BaseModel):
    id: str
    email: str | None = None
    role: str
    is_demo: bool = False


class WorkspaceContextResponse(BaseModel):
    workspace_id: str
    role: WorkspaceRole
    user_id: str


class WorkspaceCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    slug: str | None = Field(default=None, min_length=3, max_length=63)


class WorkspaceSummaryResponse(BaseModel):
    id: str
    name: str
    slug: str
    plan: str = "free"
    role: WorkspaceRole
    owner_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceSummaryResponse]
    total: int


class WorkspaceMemberResponse(BaseModel):
    user_id: str
    email: str | None = None
    display_name: str | None = None
    avatar_url: str | None = None
    role: WorkspaceRole
    created_at: str | None = None


class WorkspaceMembersResponse(BaseModel):
    workspace_id: str
    members: list[WorkspaceMemberResponse]
    total: int


class WorkspaceMemberCreateRequest(BaseModel):
    email_or_user_id: str = Field(..., min_length=3, max_length=320)
    role: Literal["admin", "editor", "viewer"] = "viewer"


class WorkspaceMemberUpdateRequest(BaseModel):
    role: Literal["admin", "editor", "viewer"]


router = APIRouter(prefix="/auth", tags=["auth"])
workspace_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _missing_bearer_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Missing bearer token.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _slugify_workspace(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    if not slug:
        slug = "workspace"
    if len(slug) < 3:
        slug = f"{slug}-workspace"
    slug = slug[:63].strip("-")
    if len(slug) < 3:
        slug = "workspace"
    return slug


def _workspace_summary(
    workspace: dict[str, Any],
    *,
    role: WorkspaceRole | str,
) -> WorkspaceSummaryResponse:
    parsed_role = role if isinstance(role, WorkspaceRole) else WorkspaceRole(str(role))
    return WorkspaceSummaryResponse(
        id=str(workspace["id"]),
        name=str(workspace["name"]),
        slug=str(workspace["slug"]),
        plan=str(workspace.get("plan") or "free"),
        role=parsed_role,
        owner_id=str(workspace["owner_id"]) if workspace.get("owner_id") else None,
        created_at=str(workspace["created_at"]) if workspace.get("created_at") else None,
        updated_at=str(workspace["updated_at"]) if workspace.get("updated_at") else None,
    )


def _demo_workspace_summary() -> WorkspaceSummaryResponse:
    return WorkspaceSummaryResponse(
        id=DEFAULT_WORKSPACE_ID,
        name="Demo Workspace",
        slug="demo-workspace",
        plan="demo",
        role=WorkspaceRole.OWNER,
        owner_id="00000000-0000-0000-0000-000000000000",
    )


def _member_response(
    *,
    user_id: str,
    role: WorkspaceRole,
    profile: dict[str, Any] | None = None,
    created_at: str | None = None,
) -> WorkspaceMemberResponse:
    profile = profile or {}
    return WorkspaceMemberResponse(
        user_id=user_id,
        email=profile.get("email") if isinstance(profile.get("email"), str) else None,
        display_name=(
            profile.get("display_name") if isinstance(profile.get("display_name"), str) else None
        ),
        avatar_url=(
            profile.get("avatar_url") if isinstance(profile.get("avatar_url"), str) else None
        ),
        role=role,
        created_at=created_at,
    )


def _assert_member_manageable(
    *,
    actor_role: WorkspaceRole,
    target_role: WorkspaceRole,
    action: str,
) -> None:
    if target_role == WorkspaceRole.OWNER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The workspace owner cannot be {action}.",
        )
    if actor_role == WorkspaceRole.ADMIN and target_role == WorkspaceRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the workspace owner can manage administrators.",
        )


async def _record_member_audit(
    *,
    supabase: SupabaseClient,
    context: WorkspaceContext,
    action: str,
    target_user_id: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    from src.repositories.audit import AuditRepository

    try:
        await AuditRepository(supabase).record_event(
            action=action,
            workspace_id=context.workspace_id,
            user_id=context.user.id,
            resource_type="workspace_member",
            resource_id=target_user_id,
            metadata=metadata,
        )
    except Exception:
        # Membership mutations must not fail solely because telemetry storage is unavailable.
        return


def _enterprise_auth_not_configured_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "Enterprise authentication is not configured. Configure Supabase "
            "backend variables, or set ENABLE_ANONYMOUS_DEMO=true only for "
            "local/demo mode."
        ),
    )


def select_workspace_id(
    x_nexus_workspace_id: str | None = None,
    x_workspace_id: str | None = None,
) -> str | None:
    """Prefer the enterprise workspace header, with legacy fallback."""
    workspace_id = (x_nexus_workspace_id or x_workspace_id or "").strip()
    return workspace_id or None


def validate_workspace_id(workspace_id: str, *, header_name: str = WORKSPACE_HEADER) -> None:
    try:
        UUID(workspace_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{header_name} must be a valid UUID.",
        ) from exc


def _decode_supabase_jwt(token: str, settings: Settings) -> dict[str, Any]:
    try:
        import jwt
        from jwt import PyJWKClient
    except ImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT verification dependency is not installed.",
        ) from exc

    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
        if algorithm not in JWT_ALGORITHMS:
            raise jwt.InvalidAlgorithmError("Unsupported Supabase JWT algorithm.")

        if algorithm == "HS256":
            if not settings.supabase_jwt_secret:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Supabase legacy JWT verification is not configured.",
                )
            key: Any = settings.supabase_jwt_secret
        else:
            if not settings.supabase_jwks_url:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Supabase JWKS verification is not configured.",
                )
            key = PyJWKClient(settings.supabase_jwks_url).get_signing_key_from_jwt(token).key

        return jwt.decode(
            token,
            key,
            algorithms=[algorithm],
            audience=AUTHENTICATED_AUDIENCE,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Supabase session.",
        ) from exc

    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Supabase JWT verification is not configured.",
    )


def authenticate_supabase_token(token: str, settings: Settings) -> CurrentUser:
    claims = _decode_supabase_jwt(token, settings)
    subject = claims.get("sub")
    if not isinstance(subject, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase session is missing a user id.",
        )

    try:
        UUID(subject)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supabase session has an invalid user id.",
        ) from exc

    return CurrentUser(
        id=subject,
        email=claims.get("email") if isinstance(claims.get("email"), str) else None,
        role=str(claims.get("role") or ""),
        claims=claims,
    )


async def get_current_user(
    request: Request,
    authorization: str | None = Header(None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = _extract_bearer_token(authorization)
    if not token:
        if settings.enable_anonymous_demo:
            user = CurrentUser(
                id="00000000-0000-0000-0000-000000000000",
                email=None,
                role="demo",
                claims={},
                is_demo=True,
            )
            request.state.user_id = user.id
            return user
        raise _missing_bearer_error()

    user = authenticate_supabase_token(token, settings)
    request.state.user_id = user.id
    return user


async def resolve_workspace_context(
    user: CurrentUser,
    workspace_id: str | None,
    supabase: SupabaseClient,
) -> WorkspaceContext:
    if user.is_demo:
        return WorkspaceContext(
            workspace_id=DEFAULT_WORKSPACE_ID,
            user=user,
            role=WorkspaceRole.OWNER,
        )

    if workspace_id:
        validate_workspace_id(workspace_id)
        query = (
            f"select=workspace_id,role&workspace_id=eq.{workspace_id}"
            f"&user_id=eq.{user.id}&limit=1"
        )
    else:
        query = f"select=workspace_id,role&user_id=eq.{user.id}&limit=1"

    try:
        rows = await supabase.table_select("workspace_members", query=query)
    except SupabaseNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase is required for authenticated workspace access.",
        ) from exc

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is not a member of the requested workspace.",
        )

    row = rows[0]
    try:
        role = WorkspaceRole(str(row["role"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Workspace membership has an invalid role.",
        ) from exc

    return WorkspaceContext(workspace_id=str(row["workspace_id"]), user=user, role=role)


async def get_workspace_context(
    request: Request,
    x_nexus_workspace_id: str | None = Header(None, alias=WORKSPACE_HEADER),
    x_workspace_id: str | None = Header(None, alias=LEGACY_WORKSPACE_HEADER),
    user: CurrentUser = Depends(get_current_user),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceContext:
    workspace_id = select_workspace_id(x_nexus_workspace_id, x_workspace_id)
    context = await resolve_workspace_context(user, workspace_id, supabase)
    request.state.workspace_id = context.workspace_id
    request.state.user_id = context.user.id
    return context


def require_workspace_role(*allowed_roles: WorkspaceRole):
    allowed = set(allowed_roles)

    async def dependency(
        context: WorkspaceContext = Depends(get_workspace_context),
    ) -> WorkspaceContext:
        if context.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient workspace permissions.",
            )
        return context

    return dependency


def require_enterprise_workspace_role(*allowed_roles: WorkspaceRole):
    """Enforce workspace RBAC only when enterprise auth is fully enabled."""
    allowed = set(allowed_roles)

    async def dependency(
        request: Request,
        authorization: str | None = Header(None),
        x_nexus_workspace_id: str | None = Header(None, alias=WORKSPACE_HEADER),
        x_workspace_id: str | None = Header(None, alias=LEGACY_WORKSPACE_HEADER),
        settings: Settings = Depends(get_settings),
        supabase: SupabaseClient = Depends(get_supabase_client),
    ) -> WorkspaceContext | None:
        if settings.enable_anonymous_demo:
            request.state.workspace_id = DEFAULT_WORKSPACE_ID
            return None
        if not settings.supabase_configured or not settings.supabase_auth_configured:
            raise _enterprise_auth_not_configured_error()

        token = _extract_bearer_token(authorization)
        if not token:
            raise _missing_bearer_error()

        user = authenticate_supabase_token(token, settings)
        workspace_id = select_workspace_id(x_nexus_workspace_id, x_workspace_id)
        context = await resolve_workspace_context(user, workspace_id, supabase)
        request.state.workspace_id = context.workspace_id
        request.state.user_id = context.user.id
        if context.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient workspace permissions.",
            )
        return context

    return dependency


@router.get("/me", response_model=CurrentUserResponse)
async def read_current_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_demo=user.is_demo,
    )


@workspace_router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    user: CurrentUser = Depends(get_current_user),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceListResponse:
    if user.is_demo:
        workspace = _demo_workspace_summary()
        return WorkspaceListResponse(workspaces=[workspace], total=1)

    from src.repositories.workspaces import WorkspaceRepository

    try:
        rows = await WorkspaceRepository(supabase).list_for_user(user.id)
    except SupabaseNotConfiguredError as exc:
        raise _enterprise_auth_not_configured_error() from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to load workspaces from Supabase.",
        ) from exc

    workspaces: list[WorkspaceSummaryResponse] = []
    for row in rows:
        workspace = row.get("workspaces")
        if isinstance(workspace, dict) and workspace.get("id"):
            try:
                workspaces.append(_workspace_summary(workspace, role=row.get("role", "viewer")))
            except (KeyError, ValueError):
                continue

    return WorkspaceListResponse(workspaces=workspaces, total=len(workspaces))


@workspace_router.post(
    "",
    response_model=WorkspaceSummaryResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_workspace(
    payload: WorkspaceCreateRequest,
    user: CurrentUser = Depends(get_current_user),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceSummaryResponse:
    if user.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo mode cannot create durable workspaces.",
        )

    from src.repositories.workspaces import WorkspaceRepository

    repo = WorkspaceRepository(supabase)
    slug = _slugify_workspace(payload.slug or payload.name)

    try:
        await repo.ensure_profile(user_id=user.id, email=user.email)
        workspace = await repo.create_workspace(
            name=payload.name.strip(),
            slug=slug,
            owner_id=user.id,
        )
    except SupabaseNotConfiguredError as exc:
        raise _enterprise_auth_not_configured_error() from exc
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        if status_code == status.HTTP_409_CONFLICT:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Workspace slug is already in use.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to create workspace in Supabase.",
        ) from exc

    return _workspace_summary(workspace, role=WorkspaceRole.OWNER)


@workspace_router.get("/current", response_model=WorkspaceContextResponse)
async def read_current_workspace(
    context: WorkspaceContext = Depends(get_workspace_context),
) -> WorkspaceContextResponse:
    return WorkspaceContextResponse(
        workspace_id=context.workspace_id,
        role=context.role,
        user_id=context.user.id,
    )


@workspace_router.get("/current/members", response_model=WorkspaceMembersResponse)
async def list_current_workspace_members(
    context: WorkspaceContext = Depends(
        require_workspace_role(
            WorkspaceRole.OWNER,
            WorkspaceRole.ADMIN,
            WorkspaceRole.EDITOR,
            WorkspaceRole.VIEWER,
        )
    ),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceMembersResponse:
    if context.user.is_demo:
        member = WorkspaceMemberResponse(
            user_id=context.user.id,
            email=context.user.email,
            display_name="Demo user",
            role=WorkspaceRole.OWNER,
        )
        return WorkspaceMembersResponse(
            workspace_id=context.workspace_id,
            members=[member],
            total=1,
        )

    from src.repositories.workspaces import WorkspaceRepository

    try:
        rows = await WorkspaceRepository(supabase).list_members(context.workspace_id)
    except SupabaseNotConfiguredError as exc:
        raise _enterprise_auth_not_configured_error() from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to load workspace members from Supabase.",
        ) from exc

    members: list[WorkspaceMemberResponse] = []
    for row in rows:
        profile = row.get("profiles") if isinstance(row.get("profiles"), dict) else {}
        try:
            role = WorkspaceRole(str(row["role"]))
        except (KeyError, ValueError):
            continue
        member_user_id = row.get("user_id") or profile.get("id")
        if not member_user_id:
            continue
        members.append(
            WorkspaceMemberResponse(
                user_id=str(member_user_id),
                email=profile.get("email") if isinstance(profile.get("email"), str) else None,
                display_name=(
                    profile.get("display_name")
                    if isinstance(profile.get("display_name"), str)
                    else None
                ),
                avatar_url=(
                    profile.get("avatar_url")
                    if isinstance(profile.get("avatar_url"), str)
                    else None
                ),
                role=role,
                created_at=str(row["created_at"]) if row.get("created_at") else None,
            )
        )

    return WorkspaceMembersResponse(
        workspace_id=context.workspace_id,
        members=members,
        total=len(members),
    )


@workspace_router.post(
    "/current/members",
    response_model=WorkspaceMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_current_workspace_member(
    payload: WorkspaceMemberCreateRequest,
    context: WorkspaceContext = Depends(
        require_workspace_role(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
    ),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceMemberResponse:
    if context.user.is_demo:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo mode cannot manage durable workspace members.",
        )

    from src.repositories.workspaces import WorkspaceRepository

    repo = WorkspaceRepository(supabase)
    try:
        profile = await repo.find_profile(payload.email_or_user_id)
        if not profile or not profile.get("id"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No existing NexusRAG user matches that email or user ID.",
            )
        role = WorkspaceRole(payload.role)
        if context.role == WorkspaceRole.ADMIN and role == WorkspaceRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the workspace owner can add administrators.",
            )
        existing = await repo.get_membership(
            workspace_id=context.workspace_id,
            user_id=str(profile["id"]),
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This user is already a workspace member.",
            )
        membership = await repo.add_member(
            workspace_id=context.workspace_id,
            user_id=str(profile["id"]),
            role=role,
        )
        await _record_member_audit(
            supabase=supabase,
            context=context,
            action="workspace.member_added",
            target_user_id=str(profile["id"]),
            metadata={"role": role.value},
        )
    except HTTPException:
        raise
    except SupabaseNotConfiguredError as exc:
        raise _enterprise_auth_not_configured_error() from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to add the workspace member.",
        ) from exc

    return _member_response(
        user_id=str(profile["id"]),
        role=role,
        profile=profile,
        created_at=str(membership["created_at"]) if membership.get("created_at") else None,
    )


@workspace_router.patch(
    "/current/members/{user_id}",
    response_model=WorkspaceMemberResponse,
)
async def update_current_workspace_member(
    user_id: str,
    payload: WorkspaceMemberUpdateRequest,
    context: WorkspaceContext = Depends(
        require_workspace_role(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
    ),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceMemberResponse:
    validate_workspace_id(user_id, header_name="user_id")
    from src.repositories.workspaces import WorkspaceRepository

    repo = WorkspaceRepository(supabase)
    try:
        membership = await repo.get_membership(
            workspace_id=context.workspace_id,
            user_id=user_id,
        )
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
        target_role = WorkspaceRole(str(membership["role"]))
        _assert_member_manageable(
            actor_role=context.role,
            target_role=target_role,
            action="changed",
        )
        next_role = WorkspaceRole(payload.role)
        if context.role == WorkspaceRole.ADMIN and next_role == WorkspaceRole.ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the workspace owner can assign administrators.",
            )
        updated = await repo.update_member_role(
            workspace_id=context.workspace_id,
            user_id=user_id,
            role=next_role,
        )
        profile = await repo.find_profile(user_id)
        await _record_member_audit(
            supabase=supabase,
            context=context,
            action="workspace.member_role_updated",
            target_user_id=user_id,
            metadata={"previous_role": target_role.value, "role": next_role.value},
        )
    except HTTPException:
        raise
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Workspace membership has an invalid role.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to update the workspace member.",
        ) from exc

    return _member_response(
        user_id=user_id,
        role=next_role,
        profile=profile,
        created_at=str(updated["created_at"]) if updated and updated.get("created_at") else None,
    )


@workspace_router.delete("/current/members/{user_id}")
async def remove_current_workspace_member(
    user_id: str,
    context: WorkspaceContext = Depends(
        require_workspace_role(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)
    ),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> dict[str, Any]:
    validate_workspace_id(user_id, header_name="user_id")
    if user_id == context.user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot remove yourself from the active workspace.",
        )
    from src.repositories.workspaces import WorkspaceRepository

    repo = WorkspaceRepository(supabase)
    try:
        membership = await repo.get_membership(
            workspace_id=context.workspace_id,
            user_id=user_id,
        )
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found.")
        target_role = WorkspaceRole(str(membership["role"]))
        _assert_member_manageable(
            actor_role=context.role,
            target_role=target_role,
            action="removed",
        )
        removed = await repo.remove_member(workspace_id=context.workspace_id, user_id=user_id)
        await _record_member_audit(
            supabase=supabase,
            context=context,
            action="workspace.member_removed",
            target_user_id=user_id,
            metadata={"previous_role": target_role.value},
        )
    except HTTPException:
        raise
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Workspace membership has an invalid role.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to remove the workspace member.",
        ) from exc

    return {"success": True, "removed": removed, "user_id": user_id}
