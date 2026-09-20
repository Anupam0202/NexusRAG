"""Privacy-safe OpenTelemetry/OpenLineage-compatible event contracts."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Mapping


FORBIDDEN_ATTRIBUTE_FRAGMENTS = (
    "prompt", "document.body", "source.excerpt", "token", "cookie", "credential",
    "signed_url", "service_role", "qdrant_key", "gemini_key", "authorization",
)


@dataclass(frozen=True, slots=True)
class TraceEvent:
    trace_id: str
    span_id: str
    name: str
    recorded_at: datetime
    workspace_id: str
    attributes: Mapping[str, str | int | float | bool]

    def __post_init__(self) -> None:
        if not all((self.trace_id, self.span_id, self.name, self.workspace_id)):
            raise ValueError("Trace identity and workspace are required")
        if self.recorded_at.tzinfo is None:
            raise ValueError("Trace timestamps must be timezone-aware")
        keys = tuple(key.lower() for key in self.attributes)
        if any(fragment in key for key in keys for fragment in FORBIDDEN_ATTRIBUTE_FRAGMENTS):
            raise ValueError("Sensitive trace attributes are prohibited")

    def otel_attributes(self) -> dict[str, str | int | float | bool]:
        return {
            "service.name": "nexusrag",
            "nexusrag.workspace_id": self.workspace_id,
            **dict(self.attributes),
        }


def openlineage_event(
    event: TraceEvent,
    *,
    input_ids: tuple[str, ...],
    output_ids: tuple[str, ...],
) -> dict[str, object]:
    return {
        "eventType": "COMPLETE",
        "eventTime": event.recorded_at.isoformat(),
        "run": {"runId": event.trace_id},
        "job": {"namespace": "nexusrag", "name": event.name},
        "inputs": [{"namespace": "nexusrag", "name": item} for item in input_ids],
        "outputs": [{"namespace": "nexusrag", "name": item} for item in output_ids],
    }