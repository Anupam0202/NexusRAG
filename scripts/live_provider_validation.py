# Exact-head release evidence; bounded, disposable, and paired with authenticated gateway validation.
"""Bounded disposable Qdrant and Gemini verification for protected CI.

This script never prints credentials, never reads customer data, uses one small
synthetic Gemini request, and deletes its temporary Qdrant collection.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import signal
import sys
import uuid
from urllib import error, parse, request


class ProviderHttpError(RuntimeError):
    def __init__(self, status: int, retry_after: str | None = None) -> None:
        super().__init__(f"provider request failed with HTTP {status}")
        self.status = status
        self.retry_after = retry_after


class ProviderConnectionError(RuntimeError):
    """Transport failure without URLs, request bodies or credential values."""


def _safe_retry_after(value: str | None) -> str | None:
    if value and re.fullmatch(r"[0-9]{1,5}", value) and int(value) <= 86400:
        return str(int(value))
    return None


def _unwind_on_sigterm(signum: int, _frame: object) -> None:
    raise SystemExit(128 + signum)


def _required(name: str, *aliases: str) -> str:
    for candidate in (name, *aliases):
        value = os.environ.get(candidate, "").strip()
        if value:
            return value
    raise RuntimeError(f"BLOCKED: missing protected secret {name}")


def _json_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict | None = None,
    timeout: int = 30,
) -> tuple[int, dict]:
    payload = None if body is None else json.dumps(body).encode()
    safe_headers = {"Content-Type": "application/json", **(headers or {})}
    req = request.Request(url, data=payload, method=method, headers=safe_headers)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise RuntimeError("provider response exceeds verification capacity")
            result = json.loads(raw or b"{}")
            if not isinstance(result, dict):
                raise RuntimeError("provider response must be a JSON object")
            return response.status, result
    except error.HTTPError as exc:
        # Do not include response bodies: providers may echo request metadata.
        raise ProviderHttpError(exc.code, exc.headers.get("Retry-After")) from None
    except error.URLError as exc:
        raise ProviderConnectionError(
            f"provider connection failed: {type(exc.reason).__name__}"
        ) from None
    except (TimeoutError, ConnectionError) as exc:
        raise ProviderConnectionError(
            f"provider connection failed: {type(exc).__name__}"
        ) from None


def validate_qdrant() -> dict:
    base = _required("QDRANT_URL").rstrip("/")
    api_key = _required("QDRANT_API_KEY")
    run_id = re.sub(r"[^a-z0-9_]", "_", os.environ.get("GITHUB_RUN_ID", uuid.uuid4().hex).lower())
    attempt = re.sub(r"[^a-z0-9_]", "_", os.environ.get("GITHUB_RUN_ATTEMPT", "1").lower())
    prefix = re.sub(
        r"[^a-z0-9_-]",
        "-",
        os.environ.get("QDRANT_COLLECTION_PREFIX", "nexusrag-ci").lower(),
    )
    # Preserve the unique run/attempt suffix; truncating the whole name can
    # turn an oversized prefix into a reused collection deletion target.
    if not run_id or len(run_id) > 40 or not attempt or len(attempt) > 10:
        raise RuntimeError("BLOCKED: Qdrant fixture run identity is invalid")
    suffix = f"-{run_id}-{attempt}"
    prefix = prefix[:180 - len(suffix)]
    if not prefix.strip("-_"):
        raise RuntimeError("BLOCKED: Qdrant fixture prefix is empty")
    collection = f"{prefix}{suffix}"
    endpoint = f"{base}/collections/{parse.quote(collection, safe='-_')}"
    headers = {"api-key": api_key}
    # Mark it for cleanup before the request: a transport timeout may happen
    # after Qdrant accepted the create but before the client received a reply.
    cleanup_needed = True
    try:
        _json_request(
            "PUT",
            endpoint,
            headers=headers,
            body={"vectors": {"size": 4, "distance": "Cosine"}},
        )
        for field_name in ("workspace_id", "version_id", "index_generation"):
            _json_request(
                "PUT",
                f"{endpoint}/index?wait=true",
                headers=headers,
                body={"field_name": field_name, "field_schema": "keyword"},
            )
        _json_request(
            "PUT",
            f"{endpoint}/points?wait=true",
            headers=headers,
            body={
                "points": [
                    {
                        "id": 1,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-a",
                            "version_id": "v1",
                            "index_generation": "g1",
                        },
                    },
                    {
                        "id": 2,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-b",
                            "version_id": "v2",
                            "index_generation": "g1",
                        },
                    },
                    {
                        "id": 3,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-a",
                            "version_id": "v2",
                            "index_generation": "g1",
                        },
                    },
                    {
                        "id": 4,
                        "vector": [1.0, 0.0, 0.0, 0.0],
                        "payload": {
                            "workspace_id": "ci-workspace-a",
                            "version_id": "v1",
                            "index_generation": "g2",
                        },
                    },
                ]
            },
        )
        _, result = _json_request(
            "POST",
            f"{endpoint}/points/query",
            headers=headers,
            body={
                "query": [1.0, 0.0, 0.0, 0.0],
                "limit": 10,
                "with_payload": True,
                "filter": {
                    "must": [
                        {"key": "workspace_id", "match": {"value": "ci-workspace-a"}},
                        {"key": "version_id", "match": {"value": "v1"}},
                        {"key": "index_generation", "match": {"value": "g1"}},
                    ]
                },
            },
        )
        points = (result.get("result") or {}).get("points", [])
        expected_payload = {
            "workspace_id": "ci-workspace-a", "version_id": "v1",
            "index_generation": "g1",
        }
        if len(points) != 1 or points[0].get("payload") != expected_payload:
            raise RuntimeError("Qdrant tenant/version isolation probe failed")
        return {
            "state": "READY",
            "synthetic_points": 4,
            "isolated_results": 1,
            "temporary_collection_deleted": True,
        }
    except Exception as exc:
        raise RuntimeError(f"QDRANT_VALIDATION_FAILED:{exc}") from None
    finally:
        if cleanup_needed:
            try:
                # Keep the cleanup request within the runner's cancellation
                # grace period and treat "not found" as already-clean.
                _, deleted = _json_request("DELETE", endpoint, headers=headers, timeout=5)
                if deleted.get("result") is not True:
                    raise RuntimeError("Qdrant cleanup acknowledgement is unverified")
            except ProviderHttpError as exc:
                if exc.status != 404:
                    raise
            else:
                # A deletion acknowledgement is not proof of absence.
                try:
                    _json_request("GET", endpoint, headers=headers, timeout=2)
                except ProviderHttpError as exc:
                    if exc.status != 404:
                        raise
                else:
                    raise RuntimeError("Qdrant temporary collection remains after deletion")


def validate_gemini() -> dict:
    api_key = _required("GOOGLE_API_KEY")
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{parse.quote(model, safe='.-_')}:generateContent"
    )
    try:
        _, result = _json_request(
            "POST",
            url,
            headers={"x-goog-api-key": api_key},
            body={
                "contents": [
                    {
                        "role": "user",
                        "parts": [
                            {
                                "text": (
                                    "Synthetic CI probe; contains no customer data. "
                                    "Return exactly NEXUSRAG_GEMINI_OK."
                                )
                            }
                        ],
                    }
                ],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": 128,
                    "candidateCount": 1,
                    "thinkingConfig": {"thinkingBudget": 0},
                },
            },
        )
    except ProviderHttpError as exc:
        if exc.status == 429:
            return {
                "state": "QUOTA_EXHAUSTED",
                "next_state": "TRY_AFTER_RESET",
                "retry_after": _safe_retry_after(exc.retry_after),
                "model": model,
                "customer_data_sent": False,
                "paid_fallback": False,
            }
        if exc.status in {401, 403, 404} or 500 <= exc.status <= 599:
            return {
                "state": "PROVIDER_UNAVAILABLE",
                "reason": (
                    "AUTHORIZATION_FAILED" if exc.status in {401, 403}
                    else "MODEL_UNAVAILABLE" if exc.status == 404
                    else "PROVIDER_HTTP_FAILURE"
                ),
                "http_status": exc.status,
                "retry_after": _safe_retry_after(exc.retry_after),
                "model": model,
                "automatic_retry": False,
                "usage_status": "UNKNOWN",
                "customer_data_sent": False,
                "paid_fallback": False,
            }
        raise RuntimeError(f"GEMINI_VALIDATION_FAILED:{exc}") from None
    except ProviderConnectionError:
        # A lost response may still have consumed provider resources. Do not
        # replay metered POSTs or declare zero usage to make a check green.
        return {
            "state": "PROVIDER_UNAVAILABLE",
            "reason": "TRANSPORT_FAILURE",
            "model": model,
            "automatic_retry": False,
            "usage_status": "UNKNOWN",
            "customer_data_sent": False,
            "paid_fallback": False,
        }
    except Exception as exc:
        raise RuntimeError(f"GEMINI_VALIDATION_FAILED:{exc}") from None
    text = "".join(
        part.get("text", "")
        for candidate in result.get("candidates", [])
        for part in candidate.get("content", {}).get("parts", [])
    )
    if "NEXUSRAG_GEMINI_OK" not in text:
        raise RuntimeError("Gemini synthetic response marker was not observed")
    usage = result.get("usageMetadata", {})
    return {
        "state": "READY",
        "model": model,
        "prompt_tokens": usage.get("promptTokenCount"),
        "response_tokens": usage.get("candidatesTokenCount"),
        "customer_data_sent": False,
        "paid_fallback": False,
    }


def main() -> int:
    # Convert runner cancellation into normal unwinding so validate_qdrant's
    # finally block gets a chance to delete its isolated collection.
    signal.signal(signal.SIGTERM, _unwind_on_sigterm)
    if os.environ.get("LIVE_EXTERNAL_VALIDATION") != "true":
        raise RuntimeError("BLOCKED: LIVE_EXTERNAL_VALIDATION=true is required")
    provider = os.environ.get("PROVIDER_UNDER_TEST", "all").strip().lower()
    if provider not in {"all", "qdrant", "gemini"}:
        raise RuntimeError("BLOCKED: PROVIDER_UNDER_TEST must be all, qdrant, or gemini")
    report = {
        "profile": "ZERO_COST_LOW_TRAFFIC",
        "validated_at": datetime.now(timezone.utc).isoformat(),
    }
    if provider in {"all", "qdrant"}:
        report["qdrant"] = validate_qdrant()
    if provider in {"all", "gemini"}:
        report["gemini"] = validate_gemini()
    output = Path(os.environ.get("VALIDATION_REPORT", "artifacts/live-provider-validation.json"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    states = [
        value.get("state", "BLOCKED")
        for key, value in report.items()
        if key in {"qdrant", "gemini"} and isinstance(value, dict)
    ]
    print(
        f"provider={provider} state={','.join(states)} "
        "customer_data_sent=false paid_fallback=false"
    )
    # Persist degraded/quota receipts, but require genuine availability for
    # the exact-head release context. QUOTA_EXHAUSTED is not a green check.
    return 0 if states and all(state == "READY" for state in states) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        safe_error = str(exc).replace("\r", " ").replace("\n", " ")[:300]
        failure_output = Path(
            os.environ.get("VALIDATION_REPORT", "artifacts/live-provider-validation.json")
        )
        failure_output.parent.mkdir(parents=True, exist_ok=True)
        failure_output.write_text(
            json.dumps(
                {
                    "profile": "ZERO_COST_LOW_TRAFFIC",
                    "validated_at": datetime.now(timezone.utc).isoformat(),
                    "state": "BLOCKED",
                    "reason": safe_error,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n"
        )
        print(f"::error title=Live provider validation::{safe_error}", file=sys.stderr)
        raise SystemExit(1)