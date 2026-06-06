from __future__ import annotations

import pytest

from config.settings import Settings
from src.telemetry.events import TelemetryRecorder


class FakeUsageRepository:
    def __init__(self) -> None:
        self.events: list[dict[str, object]] = []

    async def record_event(self, **values):
        self.events.append(values)
        return values


@pytest.mark.asyncio
async def test_telemetry_persists_configured_estimated_llm_cost() -> None:
    repository = FakeUsageRepository()
    recorder = TelemetryRecorder(
        usage_repository=repository,  # type: ignore[arg-type]
        settings=Settings(
            _env_file=None,
            llm_input_cost_usd_per_million=0.5,
            llm_output_cost_usd_per_million=1.5,
        ),
    )

    event = await recorder.record_llm_usage(
        workspace_id="workspace-1",
        input_tokens=100,
        output_tokens=20,
        persist=True,
    )

    assert event.cost_microusd == 80
    assert repository.events[0]["cost_microusd"] == 80
