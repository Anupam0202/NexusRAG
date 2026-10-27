"""Expose one ordinary disposable-rehearsal diagnostic through Actions annotations.

This workflow has synthetic test data and no hosted credentials. The full log
remains the evidence; this annotation makes its failure location visible when
the artifact/log download endpoint is unavailable.
"""
import argparse
from pathlib import Path
import re
import shlex

PHASE = re.compile(r"NEXUS_REHEARSAL_PHASE=([a-z][a-z0-9_]{0,79})\Z")
DIAGNOSTIC = re.compile(
    r"^(?:AssertionError(?:\s|\[|:)|Error(?:\s|\[|:)|FATAL ERROR:|"
    r"(?:cp|sudo|pg_ctlcluster|pg_createcluster|createdb|pg_dump|pg_restore|psql):)"
)


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
    lines = log.splitlines()
    # Ignore an earlier phase's diagnostics after a later checker starts. A
    # redirected subshell records its own phase in the shared log; its variable
    # does not propagate to the parent EXIT handler.
    for index in range(len(lines) - 1, -1, -1):
        marker = PHASE.fullmatch(lines[index])
        if marker:
            phase, lines = marker[1], lines[index + 1:]
            break
    # The static sidecar survives a long redirected checker log whose phase
    # marker has fallen outside the bounded tail. Never accept arbitrary text.
    if current_phase is not None and re.fullmatch(r"[a-z][a-z0-9_]{0,79}", current_phase):
        phase = current_phase
    if phase is not None and not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", phase):
        phase = "unknown"
    prefix = "Disposable PostgreSQL rehearsal"
    if phase is not None:
        prefix += f" failed in phase {phase}"
        if exit_code is not None:
            prefix += f" (exit {exit_code})"
    postgres = [re.match(r"^psql:.*?/(tests/postgres|supabase/(?:migrations|baseline))/([^/:]+):(\d+):\s+ERROR:\s*(.*)", line)
                for line in lines]
    postgres = [match for match in postgres if match]
    if postgres:
        match = postgres[-1]
        filename = escape(f"{match[1]}/{match[2]}").replace(",", "%2C").replace(":", "%3A")
        location = f" file={filename},line={match[3]}"
        message = f"{prefix}: {match[4]}"
    else:
        diagnostics = [line.strip() for line in lines
                       if DIAGNOSTIC.match(line.strip())]
        location = ""
        marker = missing_marker(failed_command) if phase == "pass_marker_validation" else None
        detail = (f"Required pass marker missing: {marker}" if marker is not None else
                  diagnostics[-1] if diagnostics else
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
        # Preserve the full artifact; annotation work reads only its bounded tail.
        with args.log.open("rb") as stream:
            stream.seek(0, 2)
            stream.seek(max(0, stream.tell() - 262_144))
            log = stream.read().decode(errors="replace")
    except OSError:
        log, unavailable = "", True
    current_phase = None
    if args.phase_file is not None:
        try:
            with args.phase_file.open("rb") as stream:
                current_phase = stream.read(81).decode(errors="replace").strip()
        except OSError:
            pass
    print(annotation(log, args.phase, args.exit_code, args.failed_command, unavailable, current_phase))
