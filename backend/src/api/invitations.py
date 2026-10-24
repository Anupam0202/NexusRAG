"""Service-mediated invitations; codes are POST-body-only and hash-only in storage."""

import asyncio
from hashlib import sha256
import re
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.api.auth import (
    CurrentUser,
    WorkspaceContext,
    WorkspaceRole,
    get_current_user,
    require_workspace_role,
)
from src.infrastructure.supabase_client import (
    SupabaseClient,
    SupabaseNotConfiguredError,
    get_supabase_client,
)


class InvitationBodyRoute(APIRoute):
    """Bound JSON before parsing/validation; never log or echo one-time codes."""

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            if request.method != "POST":
                return await original(request)
            try:
                declared = int(request.headers.get("content-length", "0"))
            except ValueError as exc:
                raise HTTPException(400, "Invalid request length.") from exc
            if declared < 0 or declared > 4096:
                raise HTTPException(413, "Invitation request is too large.")
            received = 0
            loop = asyncio.get_running_loop()
            deadline = loop.time() + 5

            async def bounded_receive():
                nonlocal received
                try:
                    message = await asyncio.wait_for(
                        request.receive(), max(0, deadline - loop.time())
                    )
                except TimeoutError as exc:
                    raise HTTPException(
                        408, "Invitation request timed out. Retry the same code."
                    ) from exc
                received += len(message.get("body", b""))
                if received > 4096:
                    raise HTTPException(413, "Invitation request is too large.")
                return message

            bounded = Request(request.scope, receive=bounded_receive)
            try:
                return await original(bounded)
            except RequestValidationError:
                # FastAPI's default errors include rejected input values. Codes
                # and recipient addresses must not be reflected into responses.
                return JSONResponse(
                    {"detail": "Invalid invitation request."}, status_code=422
                )

        return handler


router = APIRouter(
    prefix="/workspaces",
    tags=["Workspace invitations"],
    route_class=InvitationBodyRoute,
)
management = require_workspace_role(WorkspaceRole.OWNER, WorkspaceRole.ADMIN)


class InvitationCode(BaseModel):
    model_config = ConfigDict(extra="forbid")
    token: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$", min_length=43, max_length=43)


class InvitationCreate(InvitationCode):
    recipient_email: str = Field(min_length=3, max_length=254)
    role: str = Field(pattern=r"^(admin|editor|viewer)$")
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator("recipient_email")
    @classmethod
    def email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid invitation recipient email.")
        return value


def real_actor(user: CurrentUser) -> None:
    if user.is_demo:
        raise HTTPException(403, "Invitations require an authenticated account.")


async def rpc(client: SupabaseClient, name: str, payload: dict):
    try:
        return await client.rpc(name, payload, service_role=True)
    except SupabaseNotConfiguredError as exc:
        raise HTTPException(503, "Invitation persistence is not configured.") from exc
    except httpx.HTTPStatusError as exc:
        try:
            error = exc.response.json()
        except ValueError:
            error = {}
        if not isinstance(error, dict):
            error = {}
        if error.get("code") in {"PGRST202", "42883"}:
            raise HTTPException(
                503, "Recipient-bound invitations require verified migration 040."
            ) from exc
        match = re.search(r"NR:([A-Z_]+)", str(error.get("message", "")))
        if match:
            code = match.group(1)
            status = {
                "FORBIDDEN": 403,
                "AUTH_REQUIRED": 401,
                "VERSION_CONFLICT": 409,
                "INVALID_SCOPE": 422,
                "TENANT_QUOTA_EXCEEDED": 429,
            }.get(code, 503)
            raise HTTPException(
                status,
                {
                    "code": code,
                    "message": "Authoritative storage rejected the invitation operation.",
                },
            ) from exc
        raise HTTPException(503, "Invitation persistence is unavailable.") from exc
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(
            503, "Invitation outcome is unknown. Refresh and retry with the same code."
        ) from exc


async def supported(client: SupabaseClient) -> None:
    result = await rpc(client, "nexus_invitation_version", {})
    if (
        not isinstance(result, dict)
        or result.get("version") != "040"
        or result.get("recipient_bound") is not True
        or result.get("manual_delivery") is not True
    ):
        raise HTTPException(
            503, "Recipient-bound invitations require verified migration 040."
        )


def verified(result):
    if not isinstance(result, dict) or result.get("schema_version") != "040":
        raise HTTPException(
            503, "Invitation outcome could not be verified. Refresh before retrying."
        )
    return result


@router.post("/invitations/accept")
async def accept(
    payload: InvitationCode,
    user: CurrentUser = Depends(get_current_user),
    client: SupabaseClient = Depends(get_supabase_client),
):
    real_actor(user)
    await supported(client)
    return verified(
        await rpc(
            client,
            "nexus_accept_workspace_invitation",
            {
                "p_actor": user.id,
                "p_token_hash": sha256(payload.token.encode()).hexdigest(),
            },
        )
    )


@router.get("/current/invitations")
async def inventory(
    after: UUID | None = None,
    limit: int = Query(50, ge=1, le=100),
    context: WorkspaceContext = Depends(management),
    client: SupabaseClient = Depends(get_supabase_client),
):
    real_actor(context.user)
    await supported(client)
    return verified(
        await rpc(
            client,
            "nexus_workspace_invitation",
            {
                "p_workspace": context.workspace_id,
                "p_actor": context.user.id,
                "p_operation": "list",
                "p_invitation": None,
                "p_command": {
                    "limit": limit,
                    **({"after": str(after)} if after else {}),
                },
            },
        )
    )


@router.post("/current/invitations", status_code=201)
async def create(
    payload: InvitationCreate,
    context: WorkspaceContext = Depends(management),
    client: SupabaseClient = Depends(get_supabase_client),
):
    real_actor(context.user)
    await supported(client)
    command = payload.model_dump(exclude={"token"})
    command["token_hash"] = sha256(payload.token.encode()).hexdigest()
    return verified(
        await rpc(
            client,
            "nexus_workspace_invitation",
            {
                "p_workspace": context.workspace_id,
                "p_actor": context.user.id,
                "p_operation": "create",
                "p_invitation": None,
                "p_command": command,
            },
        )
    )


@router.delete("/current/invitations/{invitation_id}")
async def revoke(
    invitation_id: UUID,
    context: WorkspaceContext = Depends(management),
    client: SupabaseClient = Depends(get_supabase_client),
):
    real_actor(context.user)
    await supported(client)
    return verified(
        await rpc(
            client,
            "nexus_workspace_invitation",
            {
                "p_workspace": context.workspace_id,
                "p_actor": context.user.id,
                "p_operation": "revoke",
                "p_invitation": str(invitation_id),
                "p_command": {},
            },
        )
    )


@router.get("/invitations/capabilities")
async def capabilities(
    user: CurrentUser = Depends(get_current_user),
    client: SupabaseClient = Depends(get_supabase_client),
):
    real_actor(user)
    try:
        await supported(client)
    except HTTPException as exc:
        if (
            exc.status_code == 503
            and exc.detail
            == "Recipient-bound invitations require verified migration 040."
        ):
            return {"invitation_supported": False, "state": "MIGRATION_REQUIRED"}
        raise
    return {
        "invitation_supported": True,
        "schema_version": "040",
        "delivery": "MANUAL_ONE_TIME_CODE",
    }
