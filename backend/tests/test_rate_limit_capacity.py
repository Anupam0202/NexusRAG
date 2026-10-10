"""Offline, deterministic bounds; not distributed/live load acceptance."""

import json
import asyncio

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from src.api.middleware import RateLimitMiddleware


def limiter(*, rpm=2, max_clients=2):
    observed = [100.0]
    middleware = RateLimitMiddleware(
        FastAPI(), rpm=rpm, max_clients=max_clients, clock=lambda: observed[0]
    )
    return middleware, observed


async def admitted(middleware, ip):
    request = Request(
        {"type": "http", "method": "GET", "path": "/", "headers": [], "client": (ip, 1)}
    )

    async def next_handler(_request):
        await asyncio.sleep(0)
        return JSONResponse({"ok": True})

    return await middleware.dispatch(request, next_handler)


@pytest.mark.asyncio
async def test_address_churn_is_bounded_and_cannot_evict_live_history():
    middleware, _ = limiter()
    assert (await admitted(middleware, "first")).status_code == 200
    assert (await admitted(middleware, "first")).status_code == 200
    assert (await admitted(middleware, "second")).status_code == 200
    for number in range(100):
        response = await admitted(middleware, f"new-{number}")
        assert response.status_code == 429
        assert json.loads(response.body)["code"] == "RATE_LIMIT_CAPACITY_REACHED"
    assert len(middleware._buckets) == 2
    assert (await admitted(middleware, "first")).status_code == 429


@pytest.mark.asyncio
async def test_idle_clients_expire_exactly_at_window_boundary():
    middleware, clock = limiter(max_clients=1)
    await admitted(middleware, "first")
    clock[0] = 159.9
    response = await admitted(middleware, "second")
    assert response.status_code == 429 and response.headers["Retry-After"] == "1"
    clock[0] = 160
    assert (await admitted(middleware, "second")).status_code == 200
    assert list(middleware._buckets) == ["second"]


@pytest.mark.asyncio
async def test_denied_traffic_does_not_extend_idle_lifetime_or_reorder_history():
    middleware, clock = limiter(rpm=1)
    await admitted(middleware, "first")
    clock[0] = 110
    await admitted(middleware, "second")
    clock[0] = 159
    assert (await admitted(middleware, "first")).status_code == 429
    assert list(middleware._buckets) == ["first", "second"]
    clock[0] = 160
    assert (await admitted(middleware, "third")).status_code == 200
    assert list(middleware._buckets) == ["second", "third"]


@pytest.mark.asyncio
async def test_window_pruning_preserves_newer_admissions_and_remaining_count():
    middleware, clock = limiter(rpm=2)
    await admitted(middleware, "first")
    clock[0] = 130
    await admitted(middleware, "first")
    clock[0] = 160
    response = await admitted(middleware, "first")
    assert response.status_code == 200
    assert response.headers["X-RateLimit-Remaining"] == "0"
    denied = await admitted(middleware, "first")
    assert denied.status_code == 429 and denied.headers["Retry-After"] == "30"
    assert list(middleware._buckets["first"]) == [130, 160]


@pytest.mark.parametrize("rpm,capacity", [(0, 1), (-1, 1), (1, 0), (1, -1)])
def test_invalid_local_limiter_configuration_fails_closed(rpm, capacity):
    with pytest.raises(ValueError):
        limiter(rpm=rpm, max_clients=capacity)


@pytest.mark.asyncio
async def test_concurrent_requests_reserve_before_awaiting_downstream():
    middleware, _ = limiter(rpm=2)
    responses = await asyncio.gather(
        *(admitted(middleware, "same-client") for _ in range(16))
    )
    assert sum(response.status_code == 200 for response in responses) == 2
    assert sum(response.status_code == 429 for response in responses) == 14
    assert len(middleware._buckets["same-client"]) == 2


@pytest.mark.asyncio
async def test_slow_response_cannot_resurrect_an_expired_client_bucket():
    middleware, clock = limiter(max_clients=1)
    entered = asyncio.Event()
    release = asyncio.Event()
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [],
            "client": ("old", 1),
        }
    )

    async def slow_handler(_request):
        entered.set()
        await release.wait()
        return JSONResponse({"ok": True})

    task = asyncio.create_task(middleware.dispatch(request, slow_handler))
    await entered.wait()
    clock[0] = 160
    assert (await admitted(middleware, "new")).status_code == 200
    release.set()
    assert (await task).status_code == 200
    assert list(middleware._buckets) == ["new"]
