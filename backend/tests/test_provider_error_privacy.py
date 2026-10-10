"""Synthetic private markers only; no credential/provider or live-log probe."""

import json
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from langchain_core.documents import Document
from pydantic import BaseModel, ConfigDict, Field

from src.api import middleware
from src.api import routes
from src.api import websocket as ws_api
from config.settings import Settings
from src.generation import llm
from src.generation import chain as chain_module
from src.generation.chain import RAGChain
from src.generation.llm import LLMProvider
from src.repositories import provider_health
from src.retrieval.retriever import QueryType
from src.utils.exceptions import GenerationError, RAGException, RateLimitError

MARKER = "synthetic-private-provider-marker"


class PrivateRequestFixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_key: str = Field(max_length=4)


@pytest.mark.parametrize(
    "payload",
    [
        {"api_key": MARKER},
        {"api_key": "test", MARKER: "private"},
        '{"api_key": "' + MARKER,
    ],
)
def test_validation_errors_never_reflect_inputs_or_unknown_fields(monkeypatch, payload):
    logger = MagicMock()
    monkeypatch.setattr(middleware, "logger", logger)
    app = FastAPI()
    middleware.register_exception_handlers(app)

    @app.post("/private-fixture")
    async def private_fixture(body: PrivateRequestFixture):
        return {"ok": True}

    with TestClient(app) as client:
        if isinstance(payload, str):
            response = client.post(
                "/private-fixture",
                content=payload,
                headers={"Content-Type": "application/json"},
            )
        else:
            response = client.post("/private-fixture", json=payload)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid request. Check the entered fields."}
    assert MARKER not in response.text
    assert MARKER not in str(logger.mock_calls)


def test_rate_limit_error_constructs_the_specific_code_and_preserves_details():
    error = RateLimitError("Provider quota reached.", details={"retry_after": 60})
    assert isinstance(error, GenerationError)
    assert error.code == "RATE_LIMIT_ERROR"
    assert error.to_dict()["details"] == {"retry_after": 60}


@pytest.mark.parametrize(
    "description,expected_type,code",
    [
        ("429 quota", RateLimitError, "RATE_LIMIT_ERROR"),
        ("resource exhausted", RateLimitError, "RATE_LIMIT_ERROR"),
        ("401 provider", GenerationError, "GENERATION_ERROR"),
        ("403 provider", GenerationError, "GENERATION_ERROR"),
        ("network failure", GenerationError, "GENERATION_ERROR"),
    ],
)
def test_provider_classification_does_not_reflect_raw_provider_text(
    description, expected_type, code
):
    with pytest.raises(expected_type) as caught:
        LLMProvider._classify_and_raise(RuntimeError(description + " " + MARKER))
    assert caught.value.code == code
    assert MARKER not in str(caught.value)
    assert MARKER not in json.dumps(caught.value.to_dict())


@pytest.mark.asyncio
async def test_generic_handler_never_logs_or_returns_arbitrary_exception_text(
    monkeypatch,
):
    logger = MagicMock()
    monkeypatch.setattr(middleware, "logger", logger)
    app = FastAPI()
    middleware.register_exception_handlers(app)
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    response = await app.exception_handlers[Exception](request, RuntimeError(MARKER))
    assert response.status_code == 500
    assert MARKER not in response.body.decode()
    assert logger.error.call_args.kwargs == {"type": "RuntimeError"}
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.asyncio
async def test_constructed_rate_limit_maps_to_429_without_logging_message(monkeypatch):
    logger = MagicMock()
    monkeypatch.setattr(middleware, "logger", logger)
    app = FastAPI()
    middleware.register_exception_handlers(app)
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    error = RateLimitError("Provider quota reached.")
    response = await app.exception_handlers[RAGException](request, error)
    assert response.status_code == 429
    assert json.loads(response.body)["code"] == "RATE_LIMIT_ERROR"
    assert logger.error.call_args.kwargs == {
        "code": "RATE_LIMIT_ERROR",
        "type": "RateLimitError",
    }


@pytest.mark.parametrize("scoped", [False, True])
def test_initialization_and_failover_logs_exclude_provider_text(monkeypatch, scoped):
    logger = MagicMock()
    monkeypatch.setattr(llm, "logger", logger)
    calls = []

    def model_factory(**kwargs):
        calls.append(kwargs["model"])
        if len(calls) == 1:
            raise RuntimeError(MARKER)
        return object()

    monkeypatch.setitem(
        sys.modules,
        "langchain_google_genai",
        SimpleNamespace(ChatGoogleGenerativeAI=model_factory),
    )
    provider = LLMProvider(
        Settings(
            _env_file=None,
            google_api_key="synthetic-offline-key",
            llm_model_name="fixture-primary",
            llm_fallback_models="fixture-fallback",
        )
    )
    if scoped:
        state = llm._ScopedModelState(
            workspace_id="11111111-1111-4111-8111-111111111111",
            api_key_fingerprint="synthetic-fingerprint",
            candidates=["fixture-primary", "fixture-fallback"],
        )
        provider._ensure_scoped_model(state, "synthetic-offline-scoped-key")
        assert state.model is not None
    else:
        provider._ensure_model()
        assert provider._model is not None
    assert calls == ["fixture-primary", "fixture-fallback"]
    assert MARKER not in str(logger.mock_calls)
    assert all(
        "error" not in call.kwargs and "message" not in call.kwargs
        for call in logger.warning.call_args_list
    )


@pytest.mark.asyncio
async def test_failed_health_persistence_does_not_log_raw_transport_text(monkeypatch):
    logger = MagicMock()
    monkeypatch.setattr(provider_health, "logger", logger)

    class UnavailablePersistence:
        async def upsert_snapshot(self, **kwargs):
            raise RuntimeError(MARKER)

    monkeypatch.setattr(
        provider_health, "ProviderHealthRepository", UnavailablePersistence
    )
    chain = SimpleNamespace(llm=SimpleNamespace(_router=None))
    assert (
        await provider_health.persist_provider_health_snapshot(
            chain, workspace_id="11111111-1111-4111-8111-111111111111", persist=True
        )
        == 0
    )
    assert MARKER not in str(logger.mock_calls)
    assert logger.warning.call_args.kwargs["error_type"] == "RuntimeError"


@pytest.mark.parametrize(
    "description,status_code",
    [("401 provider", 400), ("quota 429", 400), ("network failure", 503)],
)
def test_key_verification_denies_unknown_failures_without_logging_input(
    monkeypatch, description, status_code
):
    logger = MagicMock()
    monkeypatch.setattr(routes, "logger", logger)
    with pytest.raises(HTTPException) as caught:
        routes._raise_api_key_validation_error(RuntimeError(description + " " + MARKER))
    assert caught.value.status_code == status_code
    assert MARKER not in str(caught.value.detail)
    assert MARKER not in str(logger.mock_calls)


def test_missing_key_validation_libraries_fail_closed(monkeypatch):
    logger = MagicMock()
    monkeypatch.setattr(routes, "logger", logger)
    monkeypatch.setitem(sys.modules, "google.genai", None)
    monkeypatch.setitem(sys.modules, "google.generativeai", None)
    with pytest.raises(HTTPException) as caught:
        routes._validate_provider_api_key("gemini", MARKER)
    assert caught.value.status_code == 503
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.asyncio
@pytest.mark.parametrize("libraries_missing", [False, True])
async def test_unverified_key_is_not_activated_or_stored(
    monkeypatch, libraries_missing
):
    manager_factory = MagicMock()
    monkeypatch.setattr(routes, "get_provider_key_manager", manager_factory)
    if libraries_missing:
        monkeypatch.setitem(sys.modules, "google.genai", None)
        monkeypatch.setitem(sys.modules, "google.generativeai", None)
    else:
        client = SimpleNamespace(
            models=SimpleNamespace(
                list=MagicMock(side_effect=RuntimeError("network " + MARKER))
            )
        )
        monkeypatch.setitem(
            sys.modules, "google.genai", SimpleNamespace(Client=lambda **kwargs: client)
        )
    with pytest.raises(HTTPException) as caught:
        await routes.set_api_key(
            routes.ApiKeyRequest(api_key=MARKER, provider="gemini"),
            workspace=None,
            settings=Settings(_env_file=None),
        )
    assert caught.value.status_code == 503
    manager_factory.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["query", "durable_documents", "stream"])
async def test_generation_fallback_never_persists_or_logs_provider_text(
    monkeypatch, mode
):
    logger = MagicMock()
    monkeypatch.setattr(chain_module, "logger", logger)
    documents = [
        Document(
            page_content="Synthetic public evidence.",
            metadata={"filename": "fixture.txt"},
        )
    ]

    class FailedModel:
        _model_name = "offline-fixture"

        def invoke_messages(self, messages):
            raise RuntimeError(MARKER)

        async def stream_messages(self, messages):
            raise RuntimeError(MARKER)
            yield  # Deliberately model an async generator failing before output.

    monkeypatch.setattr(chain_module, "get_llm_provider", FailedModel)
    chain = RAGChain(vector_store=SimpleNamespace(), settings=Settings(_env_file=None))
    chain._retriever = SimpleNamespace(
        retrieve=lambda *args, **kwargs: {
            "documents": documents,
            "query_type": QueryType.SPECIFIC,
            "k_used": 1,
            "transformed_queries": [],
        }
    )
    if mode == "query":
        result = chain.query("Explain synthetic evidence")
        metadata = result["metadata"]
    elif mode == "durable_documents":
        result = chain.answer_from_documents("Explain synthetic evidence", documents)
        metadata = result["metadata"]
    else:
        result = [frame async for frame in chain.stream("Explain synthetic evidence")]
        metadata = next(
            frame["metadata"] for frame in result if frame["type"] == "done"
        )
    assert metadata["generation_fallback"] is True
    assert MARKER not in json.dumps(result)
    assert MARKER not in str(logger.mock_calls)


@pytest.mark.parametrize("mode", ["validation", "provider_failure", "quota_failure"])
def test_actual_websocket_error_frames_and_audit_never_echo_private_inputs(
    monkeypatch, mode
):
    logger = MagicMock()
    telemetry = SimpleNamespace(
        record_llm_usage=AsyncMock(),
        record_audit_event=AsyncMock(),
    )
    quota = SimpleNamespace(
        usage=AsyncMock(return_value={}), assert_chat_allowed=MagicMock()
    )
    monkeypatch.setattr(ws_api, "logger", logger)
    monkeypatch.setattr(ws_api, "_receive_workspace_auth", AsyncMock(return_value=None))
    monkeypatch.setattr(ws_api, "get_rag_chain", lambda: SimpleNamespace())
    monkeypatch.setattr(ws_api, "get_settings", lambda: Settings(_env_file=None))
    monkeypatch.setattr(ws_api, "TenantQuotaEnforcer", lambda settings: quota)
    monkeypatch.setattr(ws_api, "get_telemetry_recorder", lambda: telemetry)
    monkeypatch.setattr(
        ws_api, "persist_provider_health_snapshot", AsyncMock(return_value=0)
    )
    failure = ("429 " if mode == "quota_failure" else "") + MARKER
    query = AsyncMock(side_effect=RuntimeError(failure))
    monkeypatch.setattr(ws_api, "query_chat_with_durable_fallback", query)
    app = FastAPI()
    app.include_router(ws_api.router)
    with TestClient(app) as client, client.websocket_connect("/ws/chat") as socket:
        payload = {"question": "Explain the synthetic fixture"}
        if mode == "validation":
            payload["top_k"] = MARKER
        socket.send_json(payload)
        response = socket.receive_json()
    assert response["type"] == "error"
    assert MARKER not in json.dumps(response)
    assert MARKER not in str(logger.mock_calls)
    assert MARKER not in str(telemetry.record_audit_event.call_args_list)
    if mode == "validation":
        query.assert_not_called()
    else:
        query.assert_awaited_once()
        assert response["error_code"] == (
            "QUOTA_EXCEEDED" if mode == "quota_failure" else "RESEARCH_REQUEST_FAILED"
        )
