"""Deterministic AI-safety screening; retrieved content is always data."""
from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import re


class SafetyFinding(StrEnum):
    DIRECT_INJECTION = "DIRECT_INJECTION"
    INDIRECT_INJECTION = "INDIRECT_INJECTION"
    SECRET_EXTRACTION = "SECRET_EXTRACTION"
    SYSTEM_PROMPT_EXTRACTION = "SYSTEM_PROMPT_EXTRACTION"
    TOOL_ABUSE = "TOOL_ABUSE"
    UNSAFE_LINK = "UNSAFE_LINK"
    PASSIVE_TRACKING = "PASSIVE_TRACKING"
    MALICIOUS_METADATA = "MALICIOUS_METADATA"


@dataclass(frozen=True, slots=True)
class SafetyAssessment:
    findings: tuple[SafetyFinding, ...]
    treat_as_data: bool
    tool_execution_allowed: bool
    review_required: bool


PATTERNS = (
    (SafetyFinding.DIRECT_INJECTION, re.compile(r"\b(ignore|override)\b.{0,40}\b(instruction|policy|system)\b", re.I)),
    (
        SafetyFinding.SECRET_EXTRACTION,
        re.compile(
            r"(?:\b(api key|password|token|credential|secret)\b.{0,40}\b(show|print|reveal|return|extract)\b"
            r"|\b(show|print|reveal|return|extract)\b.{0,40}\b(api key|password|token|credential|secret)\b)",
            re.I,
        ),
    ),
    (SafetyFinding.SYSTEM_PROMPT_EXTRACTION, re.compile(r"\b(system prompt|hidden instruction|developer message)\b", re.I)),
    (SafetyFinding.TOOL_ABUSE, re.compile(r"\b(delete|destroy|transfer|purchase|execute shell|run command)\b", re.I)),
    (SafetyFinding.UNSAFE_LINK, re.compile(r"(?:javascript:|data:text/html|file://)", re.I)),
    (SafetyFinding.PASSIVE_TRACKING, re.compile(r"<img[^>]+(?:pixel|track|beacon|1x1)", re.I)),
)


def assess_untrusted_content(text: str, *, metadata: dict[str, str] | None = None) -> SafetyAssessment:
    findings = [finding for finding, pattern in PATTERNS if pattern.search(text)]
    if metadata and any(PATTERNS[0][1].search(value) for value in metadata.values()):
        findings.append(SafetyFinding.MALICIOUS_METADATA)
    unique = tuple(dict.fromkeys(findings))
    return SafetyAssessment(
        unique,
        treat_as_data=True,
        tool_execution_allowed=False,
        review_required=bool(unique),
    )