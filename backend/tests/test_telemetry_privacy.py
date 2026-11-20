"""Offline failure probes; no real credentials or persistent-log acceptance."""

from unittest.mock import MagicMock

import pytest

from config.settings import Settings
from src.telemetry import events

MARKER = "synthetic-private-telemetry-marker"


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["usage", "audit", "summary", "list"])
async def test_persistence_failures_do_not_log_private_transport_text(
    monkeypatch, operation
):
    logger = MagicMock()
    monkeypatch.setattr(events, "logger", logger)

    class UnavailableRepository:
        async def record_event(self, **kwargs):
            raise RuntimeError(MARKER)

        async def list_events(self, **kwargs):
            raise RuntimeError(MARKER)

    recorder = events.TelemetryRecorder(
        usage_repository=UnavailableRepository(),
        audit_repository=UnavailableRepository(),
        settings=Settings(_env_file=None),
    )
    scope = {"workspace_id": "offline-workspace", "persist": True}
    if operation == "usage":
        await recorder.record_llm_usage(**scope)
    elif operation == "audit":
        await recorder.record_audit_event(**scope, action="fixture")
    elif operation == "summary":
        await recorder.analytics_summary(**scope)
    else:
        await recorder.list_audit_events(**scope)
    logger.warning.assert_called_once()
    assert logger.warning.call_args.kwargs["error_type"] == "RuntimeError"
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.parametrize("key", ["error", "error_message", "exception"])
def test_private_error_metadata_is_redacted_without_hiding_safe_codes(key):
    value = events._clean_metadata({
        key: MARKER,
        "error_type": "RuntimeError",
        "error_code": "PROVIDER_UNAVAILABLE",
    })
    assert value[key] == events.REDACTED
    assert value["error_type"] == "RuntimeError"
    assert value["error_code"] == "PROVIDER_UNAVAILABLE"
    assert MARKER not in str(value)


def test_deeply_nested_credentials_are_not_stringified_past_the_depth_limit():
    value = {"api_key": MARKER}
    for _ in range(8):
        value = {"nested": value}
    assert MARKER not in str(events._clean_metadata(value))


def test_opaque_metadata_never_invokes_private_string_methods():
    class PrivateObject:
        def __str__(self):
            raise AssertionError("Private stringification must not be called.")

    assert events._clean_metadata({"opaque": PrivateObject()}) == {
        "opaque": events.REDACTED,
    }


def test_opaque_metadata_keys_are_not_stringified_or_used_as_public_labels():
    class PrivateKey:
        def __str__(self):
            raise AssertionError("Private key stringification must not be called.")

    value = events._clean_metadata({PrivateKey(): MARKER})
    assert value == {"_redacted_non_string_key_0": events.REDACTED}
    assert MARKER not in str(value)