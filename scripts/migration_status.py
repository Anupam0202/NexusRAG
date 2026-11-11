"""Name-based migration status and apply for hosted Supabase projects (plan, Part 2 section H).

Hosted projects record their own version numbers, so migrations are matched by name with any numeric or
timestamp prefix removed. The forward chain is every repository migration from 026 onward, in file order. A
database must already have a base: the clean baseline (``v6_zero_cost_baseline``) or the legacy numbered chain
(``core_schema`` onward, as on production).

Usage:
  python3 scripts/migration_status.py status --applied list_migrations.json [--json] [--fail-on-pending]
  SUPABASE_DB_URL=... python3 scripts/migration_status.py status [--json] [--fail-on-pending]
  SUPABASE_DB_URL=... python3 scripts/migration_status.py apply --snapshot-label 20261109_6b30a50
  python3 scripts/migration_status.py chain

``apply`` first copies every ``public`` table into a new ``backup_<label>`` schema, then applies each pending
migration in its own transaction and records it in ``supabase_migrations.schema_migrations``. It never prints
the connection string.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
FIRST_FORWARD = 26
PREFIX = re.compile(r"^(?:\d{14}|\d{3}[a-z]?)_")
BASELINE = "v6_zero_cost_baseline"
LEGACY_BASE = "core_schema"
# Hosted names that recorded a repository migration under a different name.
ALIASES = {"allow_reindex_original_reuse": {"rehearsal_026_reindex_original_reuse_compat"}}
LABEL = re.compile(r"^[a-z0-9_]{1,40}$")
OWN_TRANSACTION = re.compile(r"^\s*begin\s*;", re.I | re.M)


def normalize(name: str) -> str:
    return PREFIX.sub("", name.strip())


def forward_chain(directory: Path = MIGRATIONS) -> list[tuple[str, str]]:
    """(file name, normalized name) for every forward migration, in apply order."""
    chain = []
    for path in sorted(directory.glob("*.sql")):
        prefix = path.name.split("_", 1)[0]
        if re.fullmatch(r"\d{14}", prefix) or (re.fullmatch(r"\d{3}[a-z]?", prefix) and int(prefix[:3]) >= FIRST_FORWARD):
            chain.append((path.name, normalize(path.stem)))
    return chain


def legacy_names(directory: Path = MIGRATIONS) -> set[str]:
    return {normalize(path.stem) for path in directory.glob("*.sql")} - {name for _, name in forward_chain(directory)}


def status(applied: list[str], directory: Path = MIGRATIONS) -> dict:
    names = {normalize(name) for name in applied}
    chain = forward_chain(directory)
    base = "baseline" if BASELINE in names else "legacy" if LEGACY_BASE in names else None
    pending = [file for file, name in chain if name not in names and not (ALIASES.get(name, set()) & names)]
    known = {name for _, name in chain} | legacy_names(directory) | {BASELINE} | set().union(*ALIASES.values())
    return {
        "base": base,
        "applied": len(applied),
        "pending": pending,
        "hosted_only": sorted(name for name in applied if normalize(name) not in known),
    }


def read_applied(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("migrations", []) if isinstance(data, dict) else data
    return [row["name"] if isinstance(row, dict) else str(row) for row in rows]


def psql(db_url: str, *args: str, sql: str | None = None) -> str:
    command = ["psql", db_url, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", *args]
    result = subprocess.run(command, input=sql, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = (result.stderr.strip().splitlines()[-1:] or ["no error output"])[0]
        # Never echo a connection string, even if psql ever includes one in an error.
        raise RuntimeError("psql failed: " + re.sub(r"postgres(?:ql)?://\S+", "postgresql://<redacted>", detail)[:300])
    return result.stdout


def applied_from_database(db_url: str) -> list[str]:
    output = psql(db_url, "-c", "select name from supabase_migrations.schema_migrations where name is not null order by version")
    return [line for line in output.splitlines() if line.strip()]


def snapshot(db_url: str, label: str) -> str:
    if not LABEL.fullmatch(label):
        raise ValueError("The snapshot label must be 1-40 lowercase letters, digits or underscores.")
    schema = f"backup_{label}"
    psql(db_url, "-1", "-f", "-", sql=f"""
create schema {schema};
revoke all on schema {schema} from public;
do $snapshot$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('create table {schema}.%I as table public.%I', t.tablename, t.tablename);
  end loop;
end
$snapshot$;
""")
    return schema


def next_version(db_url: str, previous: str | None) -> str:
    latest = psql(db_url, "-c", "select coalesce(max(version), '0') from supabase_migrations.schema_migrations").strip()
    now = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    floor = max(latest, previous or "0")
    return now if now > floor else str(int(floor) + 1)


def apply_file(db_url: str, path: Path, version: str) -> None:
    sql = path.read_text(encoding="utf-8")
    # Files with their own begin/commit stay atomic on their own; wrap the others in one transaction.
    psql(db_url, *([] if OWN_TRANSACTION.search(sql) else ["-1"]), "-f", str(path))
    tag = f"$m_{secrets.token_hex(6)}$"
    if tag in sql:
        raise RuntimeError(f"Could not quote {path.name} for the migration history.")
    psql(db_url, "-f", "-", sql=(
        "insert into supabase_migrations.schema_migrations (version, name, statements) values "
        f"('{version}', '{path.stem}', array[{tag}{sql}{tag}]);"
    ))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["status", "apply", "chain"])
    parser.add_argument("--migrations-dir", type=Path, default=MIGRATIONS, help=argparse.SUPPRESS)
    parser.add_argument("--applied", type=Path, help="list_migrations JSON instead of SUPABASE_DB_URL")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--fail-on-pending", action="store_true")
    parser.add_argument("--snapshot-label")
    args = parser.parse_args(argv)
    db_url = os.environ.get("SUPABASE_DB_URL", "").strip()
    directory = args.migrations_dir
    if args.command == "chain":
        print("\n".join(file for file, _ in forward_chain(directory)))
        return 0
    if args.command == "apply" and (args.applied or not db_url or not args.snapshot_label):
        parser.error("apply needs SUPABASE_DB_URL and --snapshot-label, and reads the database directly")
    if not args.applied and not db_url:
        parser.error("give --applied FILE or set SUPABASE_DB_URL")

    applied = read_applied(args.applied) if args.applied else applied_from_database(db_url)
    report = status(applied, directory)
    if args.command == "apply":
        if report["base"] is None:
            print("::error::The database has no recognised base migration; build it from the baseline first.")
            return 1
        if report["pending"]:
            report["snapshot"] = snapshot(db_url, args.snapshot_label)
            print(f"snapshot: {report['snapshot']} (copy of every public table, taken before any change)")
            version = None
            report["applied_now"] = []
            for file in report["pending"]:
                version = next_version(db_url, version)
                try:
                    apply_file(db_url, directory / file, version)
                except RuntimeError as exc:
                    # The failed file rolled back on its own; earlier files stay applied and recorded.
                    print(f"::error::{file} failed and was rolled back: {exc}")
                    break
                report["applied_now"].append(file)
                print(f"applied {file} as {version}")
            report["pending"] = status(applied_from_database(db_url), directory)["pending"]
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"base: {report['base'] or 'MISSING'}; applied: {report['applied']}; pending: {len(report['pending'])}")
        for file in report["pending"]:
            print(f"  pending {file}")
    if report["base"] is None:
        return 1
    return 1 if (args.fail_on_pending or args.command == "apply") and report["pending"] else 0


if __name__ == "__main__":
    sys.exit(main())
