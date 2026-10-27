"""Expose one ordinary disposable-rehearsal diagnostic through Actions annotations.

This workflow has synthetic test data and no hosted credentials. The full log
remains the evidence; this annotation makes its failure location visible when
the artifact/log download endpoint is unavailable.
"""
from pathlib import Path
import re
import sys


def annotation(log: str) -> str:
    lines = log.splitlines()
    postgres = [re.match(r"^psql:.*?/(tests/postgres|supabase/(?:migrations|baseline))/([^/:]+):(\d+):\s+ERROR:\s*(.*)", line)
                for line in lines]
    postgres = [match for match in postgres if match]
    if postgres:
        match = postgres[-1]
        location = f" file={match[1]}/{match[2]},line={match[3]}"
        message = f"Disposable PostgreSQL rehearsal: {match[4]}"
    else:
        diagnostics = [line.strip() for line in lines
                       if re.match(r"^(?:AssertionError(?:\s|\[|:)|Error(?:\s|\[|:))", line)]
        location = ""
        message = "Disposable PostgreSQL rehearsal failed. " + (
            diagnostics[-1] if diagnostics else "Inspect the preserved ordinary rehearsal log for the failed phase."
        )
    message = message[:2000].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return f"::error{location}::{message}"


if __name__ == "__main__":
    print(annotation(Path(sys.argv[1]).read_text(errors="replace")))
