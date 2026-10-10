"""Emit installed native package provenance without hiding unpatched components."""

from __future__ import annotations

import json
from pathlib import Path
import platform


def packages(status: str) -> list[dict[str, str]]:
    result = []
    for paragraph in status.split("\n\n"):
        fields = {}
        for line in paragraph.splitlines():
            if line and not line[0].isspace() and ": " in line:
                key, value = line.split(": ", 1)
                fields[key] = value
        if fields.get("Status") != "install ok installed":
            continue
        if not all(fields.get(key) for key in ("Package", "Version", "Architecture")):
            raise ValueError("Installed native package lacks provenance")
        result.append(
            {
                key: fields[key]
                for key in ("Package", "Version", "Architecture", "Source", "Essential")
                if key in fields
            }
        )
    if not result:
        raise ValueError("Installed native package inventory is empty")
    return sorted(result, key=lambda row: row["Package"])


def main() -> None:
    path = Path("/var/lib/dpkg/status")
    if not path.is_file():
        raise SystemExit(
            "Native package inventory is unavailable; not accepted as an empty runtime"
        )
    print(
        "OS_RUNTIME",
        json.dumps(
            {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "package_database": str(path),
            },
            sort_keys=True,
        ),
    )
    for row in packages(path.read_text()):
        print("OS_RUNTIME_PACKAGE", json.dumps(row, sort_keys=True))


if __name__ == "__main__":
    main()
