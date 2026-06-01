"""Configuration compatibility tests."""

from __future__ import annotations

import pytest

from config.settings import get_settings

SUPABASE_ENV_KEYS = (
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_JWKS_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
)


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_supabase_vercel_aliases_activate_enterprise_auth(monkeypatch) -> None:
    for key in SUPABASE_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "service-role-key")
    monkeypatch.setenv("ENABLE_ANONYMOUS_DEMO", "false")
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.supabase_url == "https://project.supabase.co"
    assert settings.supabase_anon_key == "publishable-key"
    assert settings.supabase_service_role_key == "service-role-key"
    assert settings.supabase_jwks_url == (
        "https://project.supabase.co/auth/v1/.well-known/jwks.json"
    )
    assert settings.supabase_configured is True
    assert settings.supabase_auth_configured is True
    assert settings.auth_required is True


def test_supabase_jwt_secret_prevents_implicit_jwks(monkeypatch) -> None:
    for key in SUPABASE_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "jwt-secret")
    monkeypatch.setenv("ENABLE_ANONYMOUS_DEMO", "false")
    get_settings.cache_clear()

    settings = get_settings()

    assert settings.supabase_jwt_secret == "jwt-secret"
    assert settings.supabase_jwks_url == ""
    assert settings.auth_required is True
