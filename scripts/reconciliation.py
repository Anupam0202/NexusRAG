"""Compare file storage and the search index with the database, and remove leftovers when asked (NX-27).

A crash between two steps of an upload or a deletion, or a store that lost data, can leave
  a stored file that no document names                (a deleted document's file that is still there)
  index entries of a version that no longer exists    (a deleted document's text that is still there)
  a document whose original file is gone              (it cannot be downloaded or processed again)
  an answerable document the index holds nothing of   (questions about it find nothing)
The gateway counts these once a day and logs them as `store_reconciliation`. This tool shows them and removes the
first two kinds.

  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... QDRANT_URL=... QDRANT_API_KEY=... \\
      python3 scripts/reconciliation.py report --target candidate [--details]
  ... python3 scripts/reconciliation.py remove-files --target candidate --expect 3
  ... python3 scripts/reconciliation.py remove-index-entries --target candidate --expect 2

`report` changes nothing and exits 1 when anything is out of step. It prints counts only, so its output can go to a
public workflow log; `--details` adds file names and identifiers and is for your own terminal. A removal deletes
only what a fresh report lists, and only when `--expect` is the count that report shows: read the report, then pass
its count. Without the Qdrant settings only file storage is checked.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from urllib import error, parse, request

if __package__:
    from .release import TARGETS, supabase_url
else:
    from release import TARGETS, supabase_url

USER_AGENT = "nexusrag-reconciliation"
BUCKET = "documents"
LIST_LIMIT = 1000  # the most a report lists, and so the most one removal deletes
BATCH = 100
PAGE = 1000
MAX_INDEX_ENTRIES = 2_000_000
MIGRATION = "20261114120000_storage_reconciliation"


class ReconcileError(RuntimeError):
    """A step failed; the message is safe to print."""


def http(method: str, url: str, headers: dict, body=None, timeout: float = 60):
    """One JSON request. Returns (status, parsed body or None). A refusal's body is never kept: it can name files."""
    data = json.dumps(body).encode() if body is not None else None
    sent = {**headers, "User-Agent": USER_AGENT, **({"Content-Type": "application/json"} if data is not None else {})}
    try:
        with request.urlopen(request.Request(url, method=method, headers=sent, data=data), timeout=timeout) as response:
            status, raw = response.status, response.read()
    except error.HTTPError as exc:
        return exc.code, None
    except (error.URLError, TimeoutError, OSError) as exc:
        raise ReconcileError(f"No answer from {parse.urlsplit(url).hostname} ({type(exc).__name__}).") from None
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def whole(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ReconcileError("The database's report is not in the expected form.")
    return value


class Stores:
    """The database, file storage and search index of one deployment."""

    def __init__(self, name: str, env: dict):
        target = TARGETS[name]
        self.name = name
        self.supabase = env["SUPABASE_URL"].rstrip("/")
        if self.supabase != supabase_url(target):
            raise ReconcileError(f"The {name} deployment uses the Supabase project {target['supabase_ref']}; SUPABASE_URL names another one.")
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
        # A secret key (sb_secret_...) is refused as a Bearer token; a legacy service_role key goes in both headers.
        self.service = {"apikey": key, **({} if key.startswith("sb_") else {"Authorization": f"Bearer {key}"})}
        self.index = env.get("QDRANT_URL", "").rstrip("/")
        self.index_headers = {"api-key": env.get("QDRANT_API_KEY", "")}
        # The collection comes from the target, so a database is never compared with another deployment's index.
        self.collection = f"{self.index}/collections/{parse.quote(target['qdrant_collection'], safe='')}"
        self.collection_name = target["qdrant_collection"]

    @property
    def has_index(self) -> bool:
        return bool(self.index and self.index_headers["api-key"])

    def rpc(self, function: str, arguments: dict) -> dict:
        status, body = http("POST", f"{self.supabase}/rest/v1/rpc/{function}", self.service, arguments)
        if status == 404:
            raise ReconcileError(f"The database does not have the reconciliation reports yet: apply migration {MIGRATION}.")
        if status in (401, 403):
            raise ReconcileError("The database did not accept the service role key.")
        if status != 200 or not isinstance(body, dict):
            raise ReconcileError(f"The database refused the report (HTTP {status}).")
        return body

    def storage_report(self, grace_minutes: int) -> dict:
        report = self.rpc("nexus_storage_reconciliation", {"p_grace_seconds": grace_minutes * 60, "p_limit": LIST_LIMIT})
        try:
            files, originals = report["unreferenced_objects"], report["missing_originals"]
            whole(files["count"]), whole(files["bytes"]), whole(originals["count"])
            if not all(isinstance(item.get("name"), str) and item["name"] for item in files["objects"]) or not isinstance(originals["rows"], list):
                raise TypeError
        except (KeyError, TypeError, AttributeError):
            raise ReconcileError("The database's report is not in the expected form.") from None
        return report

    def indexed_versions(self) -> tuple[list[dict], int]:
        """What the index holds, as the database's report expects it, and how many entries name no version."""
        status, body = http("GET", f"{self.index}/collections", self.index_headers)
        if status in (401, 403):
            raise ReconcileError("The search index did not accept its key.")
        try:
            names = {item["name"] for item in body["result"]["collections"]}
        except (KeyError, TypeError):
            raise ReconcileError(f"The search index did not list its collections (HTTP {status}).") from None
        if self.collection_name not in names:
            return [], 0  # reset or never filled: it holds nothing
        counts: dict[str, int] = {}
        unversioned = seen = 0
        offset = None
        while True:
            page = {"limit": PAGE, "with_payload": ["version_id"], "with_vector": False, **({} if offset is None else {"offset": offset})}
            status, body = http("POST", f"{self.collection}/points/scroll", self.index_headers, page)
            try:
                points, offset = body["result"]["points"], body["result"].get("next_page_offset")
            except (KeyError, TypeError):
                raise ReconcileError(f"The search index did not list its entries (HTTP {status}).") from None
            for point in points:
                version = (point.get("payload") or {}).get("version_id")
                if isinstance(version, str) and version:
                    counts[version] = counts.get(version, 0) + 1
                else:
                    unversioned += 1
            seen += len(points)
            if offset is None or not points:
                break
            if seen > MAX_INDEX_ENTRIES:
                raise ReconcileError("The index holds more entries than this tool reads in one run.")
        return [{"value": version, "count": count} for version, count in sorted(counts.items())], unversioned

    def index_report(self, versions: list[dict]) -> dict:
        report = self.rpc("nexus_index_reconciliation", {"p_indexed": versions, "p_complete": True, "p_limit": LIST_LIMIT})
        try:
            leftovers, missing = report["orphaned_entries"], report["unindexed_versions"]
            whole(leftovers["versions"]), whole(leftovers["entries"]), whole(missing["count"])
            if not all(isinstance(item, str) and item for item in leftovers["version_ids"]) or not isinstance(missing["rows"], list):
                raise TypeError
        except (KeyError, TypeError, AttributeError):
            raise ReconcileError("The database's report is not in the expected form.") from None
        return report

    def delete_files(self, names: list[str]) -> None:
        for start in range(0, len(names), BATCH):
            status, _ = http("DELETE", f"{self.supabase}/storage/v1/object/{BUCKET}", self.service, {"prefixes": names[start:start + BATCH]})
            if status != 200:
                raise ReconcileError(f"File storage refused to delete (HTTP {status}) after {start} of {len(names)} files. Run the report again.")

    def delete_index_entries(self, versions: list[str]) -> None:
        for start in range(0, len(versions), BATCH):
            chosen = {"filter": {"must": [{"key": "version_id", "match": {"any": versions[start:start + BATCH]}}]}}
            status, _ = http("POST", f"{self.collection}/points/delete?wait=true", self.index_headers, chosen)
            if status != 200:
                raise ReconcileError(f"The search index refused to delete (HTTP {status}) after {start} of {len(versions)} versions. Run the report again.")


def size(count: int) -> str:
    for unit, scale in (("GB", 1e9), ("MB", 1e6), ("kB", 1e3)):
        if count >= scale:
            return f"{count / scale:.1f} {unit}"
    return f"{count} bytes"


def plural(count: int, noun: str) -> str:
    if count == 1:
        return f"1 {noun}"
    return f"{count} {noun[:-1]}ies" if noun.endswith("y") else f"{count} {noun}s"


def gather(stores: Stores, grace_minutes: int) -> dict:
    found = {"storage": stores.storage_report(grace_minutes), "index": None, "unversioned": 0}
    if stores.has_index:
        versions, found["unversioned"] = stores.indexed_versions()
        found["index"] = stores.index_report(versions)
    return found


def counts(found: dict) -> dict:
    storage, index = found["storage"], found["index"]
    return {
        "files": storage["unreferenced_objects"]["count"], "bytes": storage["unreferenced_objects"]["bytes"],
        "originals": storage["missing_originals"]["count"],
        "versions": index["orphaned_entries"]["versions"] if index else None,
        "entries": index["orphaned_entries"]["entries"] if index else None,
        "unindexed": index["unindexed_versions"]["count"] if index else None,
    }


def render(stores: Stores, found: dict, details: bool) -> tuple[str, bool]:
    """The report as text, and whether anything is out of step. Without `details` it holds counts only."""
    n = counts(found)
    command = f"python3 scripts/reconciliation.py {{}} --target {stores.name} --expect {{}}"
    files = f"{n['files']} ({size(n['bytes'])})" if n["files"] else "0"
    if found["index"] is None:
        entries = unindexed = "not checked"
    else:
        entries = f"{plural(n['versions'], 'version')}, {plural(n['entries'], 'entry')}" if n["versions"] else "0"
        unindexed = str(n["unindexed"])
    lines = [
        f"## Reconciliation of the {stores.name} deployment", "",
        "| What | Found |", "|---|---|",
        f"| Stored files that no document names | {files} |",
        f"| Documents whose original file is gone | {n['originals']} |",
        f"| Index entries of versions that no longer exist | {entries} |",
        f"| Answerable documents the index holds nothing of | {unindexed} |",
    ]
    if found["index"] is None:
        lines += ["", "The search index was not checked: QDRANT_URL and QDRANT_API_KEY are not set."]
    if found["unversioned"]:
        lines += ["", f"Index entries that name no version at all: {found['unversioned']}. They date from before versions existed and the app cannot use them."]
    todo = []
    if n["files"]:
        todo.append(f"- Stored files: a deleted or never finished upload left them. Remove them with `{command.format('remove-files', n['files'])}`.")
    if n["versions"]:
        todo.append(f"- Index entries: a deleted document's passages are still searchable by nobody. Remove them with `{command.format('remove-index-entries', n['versions'])}`.")
    if n["originals"]:
        todo.append("- Originals gone: the documents can still be read and asked about, but not downloaded or re-indexed. Their uploaders have to delete them and upload the files again.")
    if n["unindexed"]:
        todo.append("- Missing from the index: questions about these documents find nothing. Open each in Documents and choose Re-index.")
    if todo:
        lines += ["", "### What to do", *todo]
    if details:
        stored = found["storage"]["unreferenced_objects"]["objects"]
        if stored:
            lines += ["", "### Stored files that no document names", *(
                f"- {item['name']} (stored {str(item.get('created_at'))[:10]}, "
                + ("size unknown" if item.get("bytes") is None else size(item["bytes"])) + ")" for item in stored)]
        rows = found["storage"]["missing_originals"]["rows"]
        if rows:
            lines += ["", "### Documents whose original file is gone", *(
                f"- workspace {row.get('workspace_id')}, document {row.get('document_id')}" + (f", version {row['version_id']}" if row.get("version_id") else "") for row in rows)]
        if found["index"]:
            if found["index"]["orphaned_entries"]["version_ids"]:
                lines += ["", "### Versions that no longer exist but have index entries", *(f"- {version}" for version in found["index"]["orphaned_entries"]["version_ids"])]
            if found["index"]["unindexed_versions"]["rows"]:
                lines += ["", "### Answerable documents the index holds nothing of", *(
                    f"- workspace {row.get('workspace_id')}, document {row.get('document_id')}" for row in found["index"]["unindexed_versions"]["rows"])]
    return "\n".join(lines), any(n[key] for key in ("files", "originals", "versions", "unindexed"))


def report(stores: Stores, grace_minutes: int, details: bool) -> int:
    text, out_of_step = render(stores, gather(stores, grace_minutes), details)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as handle:
            handle.write(text + "\n")
    if out_of_step:
        print("::error::File storage or the search index is out of step with the database; see the report.", file=sys.stderr)
    return 1 if out_of_step else 0


def remove_files(stores: Stores, expect: int, grace_minutes: int) -> int:
    found = stores.storage_report(grace_minutes)["unreferenced_objects"]
    if found["count"] != expect:
        raise ReconcileError(f"The report now lists {plural(found['count'], 'stored file')} that no document names, not {expect}. "
                             "Read it again, then pass its count. Nothing was removed.")
    names = [item["name"] for item in found["objects"]]
    if not names:
        print("No stored file is without a document. Nothing was removed.")
        return 0
    stores.delete_files(names)
    still = {item["name"] for item in stores.storage_report(grace_minutes)["unreferenced_objects"]["objects"]} & set(names)
    if still:
        raise ReconcileError(f"{len(still)} of the {len(names)} files are still stored. Run the report again.")
    listed = sum(item["bytes"] for item in found["objects"] if isinstance(item.get("bytes"), int))
    print(f"Removed {plural(len(names), 'stored file')} ({size(listed)}); none of them is stored any more.")
    if found["count"] > len(names):
        print(f"{found['count'] - len(names)} more remain: run the report and this command again.")
    return 0


def remove_index_entries(stores: Stores, expect: int) -> int:
    if not stores.has_index:
        raise ReconcileError("QDRANT_URL and QDRANT_API_KEY are needed to remove index entries.")
    found = stores.index_report(stores.indexed_versions()[0])
    leftovers, missing = found["orphaned_entries"], found["unindexed_versions"]["count"]
    if leftovers["versions"] != expect:
        raise ReconcileError(f"The report now lists index entries of {plural(leftovers['versions'], 'version')} that no longer exist, not {expect}. "
                             "Read it again, then pass its count. Nothing was removed.")
    if missing:
        raise ReconcileError(f"The index also holds nothing of {plural(missing, 'document')} the database can answer from. A database compared with "
                             "another deployment's index looks like that, so nothing was removed. Re-index those documents, then run the report again.")
    versions = leftovers["version_ids"]
    if not versions:
        print("The index holds no entries of a version that no longer exists. Nothing was removed.")
        return 0
    stores.delete_index_entries(versions)
    still = {item["value"] for item in stores.indexed_versions()[0]} & set(versions)
    if still:
        raise ReconcileError(f"The index still holds entries of {len(still)} of the {len(versions)} versions. Run the report again.")
    print(f"Removed the index entries of {plural(len(versions), 'version')} that no longer exist; the index holds none of them any more.")
    if leftovers["versions"] > len(versions):
        print(f"{leftovers['versions'] - len(versions)} more remain: run the report and this command again.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["report", "remove-files", "remove-index-entries"])
    parser.add_argument("--target", required=True, choices=sorted(TARGETS))
    parser.add_argument("--expect", type=int, help="for a removal: the count the latest report shows")
    parser.add_argument("--details", action="store_true", help="for report: also list file names and identifiers (not in a workflow)")
    parser.add_argument("--grace-minutes", type=int, default=60, help="leave stored files younger than this alone (at least 10)")
    args = parser.parse_args(argv)
    env = {name: os.environ.get(name, "").strip() for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QDRANT_URL", "QDRANT_API_KEY")}
    if not env["SUPABASE_URL"] or not env["SUPABASE_SERVICE_ROLE_KEY"]:
        print("::error::SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.", file=sys.stderr)
        return 2
    try:
        if args.details and os.environ.get("GITHUB_ACTIONS") == "true":
            raise ReconcileError("--details lists file names, and a workflow log is public. Run it in your own terminal.")
        if args.grace_minutes < 10:
            raise ReconcileError("--grace-minutes must be at least 10: an upload stores its file before its rows.")
        if args.command != "report" and (args.expect is None or args.expect < 0):
            raise ReconcileError(f"{args.command} needs --expect with the count the latest report shows.")
        stores = Stores(args.target, env)
        if args.command == "report":
            return report(stores, args.grace_minutes, args.details)
        if args.command == "remove-files":
            return remove_files(stores, args.expect, args.grace_minutes)
        return remove_index_entries(stores, args.expect)
    except ReconcileError as exc:
        print(f"::error::{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
