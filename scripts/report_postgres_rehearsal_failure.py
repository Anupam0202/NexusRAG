"""Expose one ordinary disposable-rehearsal diagnostic through Actions annotations.

This workflow has synthetic test data and no hosted credentials. The full log
remains the evidence; this annotation makes its failure location visible when
the artifact/log download endpoint is unavailable.
"""
import argparse
import io
from pathlib import Path
import re
import shlex
from typing import NamedTuple, TextIO

PHASE = re.compile(r"NEXUS_REHEARSAL_PHASE=([a-z][a-z0-9_]{0,79})\Z")
VALID_PHASE = re.compile(r"[a-z][a-z0-9_]{0,79}\Z")
POSTGRES = re.compile(r"^psql:.*?/(tests/postgres|supabase/(?:migrations|baseline))/([^/:]+):(\d+):\s+ERROR:\s*(.*)")
DIAGNOSTIC = re.compile(
    r"^\[?(?:(?:[A-Za-z_][A-Za-z0-9_]*(?:Error|Exception)|Error|Exception)(?:\s|\[|:)|FATAL ERROR:|"
    r"(?:(?:/bin/|/usr/bin/)?cp|sudo|pg_ctlcluster|pg_createcluster|createdb|pg_dump|pg_restore|psql):)"
)
READ_CHARACTERS = 65_536
LINE_PREFIX_CHARACTERS = 4096


class LogSummary(NamedTuple):
    phase: str | None
    diagnostic: str | None


def summarize(stream: TextIO) -> LogSummary:
    """Scan the full artifact with bounded reads and retained line prefixes.

    Long output after an error must not evict its first line. A later static
    phase clears diagnostics from the preceding phase. The original file stays
    untouched, including the parts omitted from the bounded annotation.
    """
    phase = diagnostic = None
    pending = ""

    def accept(line: str) -> None:
        nonlocal phase, diagnostic
        marker = PHASE.fullmatch(line.rstrip("\r"))
        if marker:
            phase, diagnostic = marker[1], None
        elif POSTGRES.match(line) or DIAGNOSTIC.match(line.strip()):
            diagnostic = line.strip()

    while chunk := stream.read(READ_CHARACTERS):
        pieces = chunk.split("\n")
        for index, piece in enumerate(pieces):
            pending += piece[:LINE_PREFIX_CHARACTERS - len(pending)]
            if index < len(pieces) - 1:
                accept(pending)
                pending = ""
    if pending:
        accept(pending)
    return LogSummary(phase, diagnostic)


def escape(value: str) -> str:
    return value.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def missing_marker(command: str | None) -> str | None:
    """Only describe the static grep contract, never arbitrary command arguments."""
    try:
        parts = shlex.split(command or "")
    except ValueError:
        return None
    if len(parts) == 4 and parts[:1] == ["grep"] and parts[1] in {"-F", "-E"} and parts[-1] == "$log":
        return parts[2]
    return None


def annotation(log: str, phase: str | None = None, exit_code: int | None = None,
               failed_command: str | None = None, log_unavailable: bool = False,
               current_phase: str | None = None) -> str:
    return summary_annotation(summarize(io.StringIO(log)), phase, exit_code,
                              failed_command, log_unavailable, current_phase)


def summary_annotation(summary: LogSummary, phase: str | None = None,
                       exit_code: int | None = None, failed_command: str | None = None,
                       log_unavailable: bool = False, current_phase: str | None = None) -> str:
    diagnostic = summary.diagnostic
    phase = summary.phase or phase
    # The sidecar may advance before its new log marker can be written. Do not
    # attach a preceding phase's error to the newer phase.
    if current_phase is not None and VALID_PHASE.fullmatch(current_phase):
        if current_phase != phase:
            diagnostic = None
        phase = current_phase
    if phase is not None and not VALID_PHASE.fullmatch(phase):
        phase = "unknown"
    prefix = "Disposable PostgreSQL rehearsal"
    if phase is not None:
        prefix += f" failed in phase {phase}"
        if exit_code is not None:
            prefix += f" (exit {exit_code})"
    match = POSTGRES.match(diagnostic or "")
    if match:
        filename = escape(f"{match[1]}/{match[2]}").replace(",", "%2C").replace(":", "%3A")
        location = f" file={filename},line={match[3]}"
        message = f"{prefix}: {match[4]}"
    else:
        location = ""
        marker = missing_marker(failed_command) if phase == "pass_marker_validation" else None
        detail = (f"Required pass marker missing: {marker}" if marker is not None else
                  diagnostic if diagnostic else
                  "The preserved log could not be read." if log_unavailable else
                  "Inspect the preserved ordinary rehearsal log for this phase.")
        message = f"{prefix}. {detail}"
    message = escape(message)[:2000]
    return f"::error{location}::{message}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("log", type=Path)
    parser.add_argument("--phase")
    parser.add_argument("--exit-code", type=int)
    parser.add_argument("--failed-command")
    parser.add_argument("--phase-file", type=Path)
    args = parser.parse_args()
    unavailable = False
    try:
        with args.log.open(errors="replace") as stream:
            summary = summarize(stream)
    except OSError:
        summary, unavailable = LogSummary(None, None), True
    current_phase = None
    if args.phase_file is not None:
        try:
            with args.phase_file.open("rb") as stream:
                current_phase = stream.read(81).decode(errors="replace").strip()
        except OSError:
            pass
    print(summary_annotation(summary, args.phase, args.exit_code, args.failed_command,
                             unavailable, current_phase))
