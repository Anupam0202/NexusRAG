"""Quarantine or purge legacy local vector-store files.

This script never assigns old unscoped data to a public/default workspace. Use
``--apply`` to move legacy files into a quarantine folder after reviewing the
dry-run output.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

LEGACY_FILES = ("store_meta.pkl", "faiss.index")


def quarantine(*, data_dir: Path, quarantine_dir: Path, apply: bool) -> dict[str, object]:
    found = [path for name in LEGACY_FILES if (path := data_dir / name).exists()]
    if apply:
        quarantine_dir.mkdir(parents=True, exist_ok=True)
        for path in found:
            shutil.move(str(path), str(quarantine_dir / path.name))
    return {
        "data_dir": str(data_dir),
        "quarantine_dir": str(quarantine_dir),
        "found": [str(path) for path in found],
        "moved": apply,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Quarantine legacy local FAISS store files.")
    parser.add_argument("--data-dir", default="data/vector_store")
    parser.add_argument("--quarantine-dir", default="data/quarantine/legacy_vector_store")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(
        quarantine(
            data_dir=Path(args.data_dir),
            quarantine_dir=Path(args.quarantine_dir),
            apply=args.apply,
        )
    )


if __name__ == "__main__":
    main()
