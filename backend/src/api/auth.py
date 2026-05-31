"""Supabase authentication and workspace dependencies.

The current RAG routes still run in compatibility mode. These dependencies are
the enterprise boundary for the next migration step: every document, chunk,
chat session, and setting will be scoped by the returned workspace context.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from config.settings import Settings, get_settings
from src.infrastructure.supabase_client import (
    SupabaseClient,
    SupabaseNotConfiguredError,
    get_supabase_client,
)

JWT_ALGORITHMS = ("RS256", "ES256", "HS256")
AUTHENTICATED_AUDIENCE = "authenticated"


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


router = APIRouter(prefix="/auth", tags=["auth"])
workspace_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


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
        if settings.supabase_jwks_url:
            signing_key = PyJWKClient(settings.supabase_jwks_url).get_signing_key_from_jwt(token)
            return jwt.decode(
                token,
                signing_key.key,
                algorithms=list(JWT_ALGORITHMS),
                audience=AUTHENTICATED_AUDIENCE,
            )

        if settings.supabase_jwt_secret:
            return jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=list(JWT_ALGORITHMS),
                audience=AUTHENTICATED_AUDIENCE,
            )
    except jwt.InvalidAudienceError:
        key: Any
        if settings.supabase_jwks_url:
            key = PyJWKClient(settings.supabase_jwks_url).get_signing_key_from_jwt(token).key
        else:
            key = settings.supabase_jwt_secret
        return jwt.decode(
            token,
            key,
            algorithms=list(JWT_ALGORITHMS),
            options={"verify_aud": False},
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


async def get_current_user(
    authorization: str | None = Header(None),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    token = _extract_bearer_token(authorization)
    if not token:
        if settings.enable_anonymous_demo:
            return CurrentUser(
                id="00000000-0000-0000-0000-000000000000",
                email=None,
                role="demo",
                claims={},
                is_demo=True,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

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


async def get_workspace_context(
    x_workspace_id: str | None = Header(None),
    user: CurrentUser = Depends(get_current_user),
    supabase: SupabaseClient = Depends(get_supabase_client),
) -> WorkspaceContext:
    if user.is_demo:
        return WorkspaceContext(
            workspace_id="00000000-0000-0000-0000-000000000000",
            user=user,
            role=WorkspaceRole.OWNER,
        )

    if x_workspace_id:
        try:
            UUID(x_workspace_id)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="X-Workspace-ID must be a valid UUID.",
            ) from exc
        query = (
            f"select=workspace_id,role&workspace_id=eq.{x_workspace_id}"
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


@router.get("/me", response_model=CurrentUserResponse)
async def read_current_user(user: CurrentUser = Depends(get_current_user)) -> CurrentUserResponse:
    return CurrentUserResponse(
        id=user.id,
        email=user.email,
        role=user.role,
        is_demo=user.is_demo,
    )


@workspace_router.get("/current", response_model=WorkspaceContextResponse)
async def read_current_workspace(
    context: WorkspaceContext = Depends(get_workspace_context),
) -> WorkspaceContextResponse:
    return WorkspaceContextResponse(
        workspace_id=context.workspace_id,
        role=context.role,
        user_id=context.user.id,
    )
