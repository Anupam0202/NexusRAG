"""Offline API wiring; not a real OAuth/hosted database acceptance claim."""

from hashlib import sha256
import httpx
import pytest

from src.api.auth import (
    CurrentUser,
    WorkspaceContext,
    WorkspaceRole,
    get_current_user,
    get_workspace_context,
)
from src.infrastructure.supabase_client import get_supabase_client

USER = "22222222-2222-4222-8222-222222222222"
WORKSPACE = "11111111-1111-4111-8111-111111111111"
INVITATION = "33333333-3333-4333-8333-333333333333"
CODE = "a" * 43  # Explicitly synthetic; never a minted credential.


class InvitationPersistence:
    def __init__(self):
        self.calls = []
        self.supported = True
        self.denial = None
        self.malformed = False

    async def rpc(self, name, payload, *, service_role=True):
        assert service_role is True
        self.calls.append((name, payload))
        if name == "nexus_invitation_version":
            return {
                "version": "040" if self.supported else "039",
                "recipient_bound": True,
                "manual_delivery": True,
            }
        if self.denial:
            request = httpx.Request(
                "POST", "https://example.invalid/rest/v1/rpc/synthetic"
            )
            response = httpx.Response(
                400, json={"message": f"NR:{self.denial}"}, request=request
            )
            raise httpx.HTTPStatusError(
                "synthetic failure", request=request, response=response
            )
        if self.malformed:
            return {"success": True}
        if name == "nexus_accept_workspace_invitation":
            return {
                "schema_version": "040",
                "accepted": True,
                "workspace_id": WORKSPACE,
                "role": "viewer",
            }
        return {
            "schema_version": "040",
            "id": INVITATION,
            "workspace_id": WORKSPACE,
            "state": "pending",
        }


@pytest.fixture
def invitations():
    from main import app

    user = CurrentUser(
        id=USER, email="owner@example.invalid", role="authenticated", claims={}
    )
    context = WorkspaceContext(
        workspace_id=WORKSPACE, user=user, role=WorkspaceRole.OWNER
    )
    storage = InvitationPersistence()
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_workspace_context] = lambda: context
    app.dependency_overrides[get_supabase_client] = lambda: storage
    return storage, user, context


def test_recipient_acceptance_hashes_code_without_binding_existing_workspace(
    test_client, invitations
):
    storage, _, _ = invitations
    response = test_client.post(
        "/api/v1/workspaces/invitations/accept", json={"token": CODE}
    )
    assert response.status_code == 200 and response.json()["accepted"] is True
    assert storage.calls[-1] == (
        "nexus_accept_workspace_invitation",
        {"p_actor": USER, "p_token_hash": sha256(CODE.encode()).hexdigest()},
    )
    assert CODE not in str(storage.calls) and CODE not in response.text


def test_create_derives_actor_and_does_not_persist_raw_code(test_client, invitations):
    storage, _, _ = invitations
    response = test_client.post(
        "/api/v1/workspaces/current/invitations",
        json={
            "recipient_email": " Recipient@Example.invalid ",
            "role": "viewer",
            "token": CODE,
            "idempotency_key": "same-request",
        },
    )
    assert response.status_code == 201
    payload = storage.calls[-1][1]
    assert payload["p_actor"] == USER and payload["p_workspace"] == WORKSPACE
    assert payload["p_command"]["recipient_email"] == "recipient@example.invalid"
    assert payload["p_command"]["token_hash"] == sha256(CODE.encode()).hexdigest()
    assert "token" not in payload["p_command"]


@pytest.mark.parametrize(
    "body",
    [
        {"token": CODE, "p_actor": INVITATION},
        {"token": CODE, "workspace_id": WORKSPACE},
        {"token": "short"},
    ],
)
def test_acceptance_rejects_injected_authority_before_rpc(
    test_client, invitations, body
):
    storage, _, _ = invitations
    response = test_client.post("/api/v1/workspaces/invitations/accept", json=body)
    assert response.status_code == 422 and storage.calls == []


@pytest.mark.parametrize("role", [WorkspaceRole.VIEWER, WorkspaceRole.EDITOR])
def test_reader_and_editor_cannot_manage_invitations(test_client, invitations, role):
    from main import app

    storage, user, _ = invitations
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(
        workspace_id=WORKSPACE, user=user, role=role
    )
    assert test_client.get("/api/v1/workspaces/current/invitations").status_code == 403
    assert storage.calls == []


def test_missing_invitation_schema_never_performs_mutation(test_client, invitations):
    storage, _, _ = invitations
    storage.supported = False
    response = test_client.post(
        "/api/v1/workspaces/invitations/accept", json={"token": CODE}
    )
    assert response.status_code == 503 and "040" in response.json()["detail"]
    assert len(storage.calls) == 1


@pytest.mark.parametrize(
    ("denial", "status"),
    [("FORBIDDEN", 403), ("VERSION_CONFLICT", 409), ("TENANT_QUOTA_EXCEEDED", 429)],
)
def test_atomic_invitation_denials_remain_denials(
    test_client, invitations, denial, status
):
    storage, _, _ = invitations
    storage.denial = denial
    response = test_client.post(
        "/api/v1/workspaces/invitations/accept", json={"token": CODE}
    )
    assert (
        response.status_code == status and response.json()["detail"]["code"] == denial
    )


def test_unknown_storage_result_cannot_claim_success(test_client, invitations):
    storage, _, _ = invitations
    storage.malformed = True
    assert (
        test_client.post(
            "/api/v1/workspaces/invitations/accept", json={"token": CODE}
        ).status_code
        == 503
    )


@pytest.mark.parametrize(
    "query", ["limit=101", "limit=0", "after=workspace_id.gt.anything"]
)
def test_invitation_list_rejects_unbounded_or_injected_pagination(
    test_client, invitations, query
):
    storage, _, _ = invitations
    assert (
        test_client.get("/api/v1/workspaces/current/invitations?" + query).status_code
        == 422
    )
    assert storage.calls == []


def test_invitation_revoke_is_bound_to_server_context(test_client, invitations):
    storage, _, _ = invitations
    assert (
        test_client.delete(
            f"/api/v1/workspaces/current/invitations/{INVITATION}"
        ).status_code
        == 200
    )
    assert storage.calls[-1][1] == {
        "p_workspace": WORKSPACE,
        "p_actor": USER,
        "p_operation": "revoke",
        "p_invitation": INVITATION,
        "p_command": {},
    }


def test_oversized_invitation_body_is_denied_before_json_or_rpc(
    test_client, invitations
):
    storage, _, _ = invitations
    response = test_client.post(
        "/api/v1/workspaces/invitations/accept", json={"token": "x" * 5000}
    )
    assert response.status_code == 413
    assert storage.calls == []


@pytest.mark.parametrize("supported", [True, False])
def test_unbound_capability_reflects_actual_invitation_schema(
    test_client, invitations, supported
):
    storage, _, _ = invitations
    storage.supported = supported
    response = test_client.get("/api/v1/workspaces/invitations/capabilities")
    assert response.status_code == 200
    assert response.json()["invitation_supported"] is supported
    assert storage.calls == [("nexus_invitation_version", {})]


@pytest.mark.parametrize(
    "payload",
    [
        {"token": "sensitive-rejected-invitation-value"},
        {
            "token": CODE,
            "recipient_email": "sensitive-invalid-recipient",
            "role": "viewer",
            "idempotency_key": "synthetic-validation",
        },
    ],
)
def test_validation_errors_do_not_echo_invitation_inputs(
    test_client, invitations, payload
):
    storage, _, _ = invitations
    path = (
        "/api/v1/workspaces/current/invitations"
        if "recipient_email" in payload
        else "/api/v1/workspaces/invitations/accept"
    )
    response = test_client.post(path, json=payload)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid invitation request."}
    assert payload["token"] not in response.text
    assert payload.get("recipient_email", "absent-marker") not in response.text
    assert storage.calls == []
