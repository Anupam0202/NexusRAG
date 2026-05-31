"""Authentication boundary tests."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_auth_me_requires_bearer_token(test_client: TestClient) -> None:
    response = test_client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."
