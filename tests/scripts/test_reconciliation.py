"""The operator's reconciliation tool: what it reports, what it removes, and what it must never print or delete."""
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock
from urllib import error, parse

import yaml

from scripts import reconciliation as tool
from scripts import release

ROOT = Path(__file__).resolve().parents[2]
SUPABASE = "https://ukgjygzfhyvnrsecdcuu.supabase.co"
INDEX = "https://qdrant.example"
COLLECTION = "nexusrag-v6-candidate"
ENV = {"SUPABASE_URL": SUPABASE, "SUPABASE_SERVICE_ROLE_KEY": "synthetic-service-key-do-not-log",
       "QDRANT_URL": INDEX + "/", "QDRANT_API_KEY": "synthetic-index-key-do-not-log"}
WORKSPACE = "11111111-1111-4111-8111-111111111111"
KEPT, GONE_A, GONE_B = (f"{letter * 8}-0000-4000-8000-000000000000" for letter in "abc")
# Entries written before NX-36 hold the passage and the file's name, later ones until #36 the name alone. Qdrant Cloud's
# strict mode refuses a filter on a key without a payload index (live, 2026-11-22: HTTP 400), and only these are indexed.
INDEXED = {"workspace_id", "document_id", "version_id", "index_generation", "chunk_id"}


def filtered_keys(clause):
    """Every payload key a Qdrant filter names, however deeply nested."""
    if isinstance(clause, dict):
        return ({clause["key"]} if isinstance(clause.get("key"), str) else set()) | {
            key for value in clause.values() for key in filtered_keys(value)}
    if isinstance(clause, list):
        return {key for value in clause for key in filtered_keys(value)}
    return set()


def holds_text(point):
    """Qdrant's is_empty: a key that is missing, null or an empty list is empty."""
    return any(point["payload"].get(key) not in (None, []) for key in ("content", "filename"))


class World:
    """One deployment in memory, answering as the database's reports, Supabase Storage and Qdrant do."""

    def __init__(self):
        self.versions = {KEPT}                      # versions the database has
        self.answerable = {"doc-kept": KEPT}        # documents that can be asked about -> their version
        self.files = {}                             # name -> (bytes, age in minutes)
        self.named = set()                          # names some row refers to
        self.originals_gone = []                    # rows whose file is gone
        self.points = [{"id": n, "payload": {"version_id": KEPT}} for n in range(3)]
        self.collections = [COLLECTION, "another-deployment"]
        self.calls = []
        self.refuse = {}                            # part of a URL -> status to answer with
        self.undeletable = set()                    # files storage claims to delete but keeps
        self.text_kept = False                      # the index claims to clear the text but keeps it

    def http(self, method, url, headers, body=None, timeout=60):
        self.calls.append((method, url, body, dict(headers)))
        for part, status in self.refuse.items():
            if part in url:
                return status, None
        path = parse.urlsplit(url).path
        if url.startswith(SUPABASE + "/rest/v1/rpc/nexus_storage_reconciliation"):
            listed = sorted((name for name, (_, age) in self.files.items() if name not in self.named and age * 60 >= max(body["p_grace_seconds"], 600)),
                            key=lambda name: (-self.files[name][1], name))
            return 200, {"format": "nexusrag-storage-reconciliation/1",
                         "unreferenced_objects": {"count": len(listed), "bytes": sum(self.files[name][0] or 0 for name in listed),
                                                  "objects": [{"name": name, "created_at": "2026-11-01T00:00:00+00:00", "bytes": self.files[name][0]}
                                                              for name in listed[:body["p_limit"]]]},
                         "missing_originals": {"count": len(self.originals_gone), "rows": self.originals_gone[:body["p_limit"]]}}
        if url.startswith(SUPABASE + "/rest/v1/rpc/nexus_index_reconciliation"):
            held = {item["value"]: item["count"] for item in body["p_indexed"]}
            leftovers = sorted(value for value in held if value not in self.versions)
            unindexed = [{"workspace_id": WORKSPACE, "document_id": document, "version_id": version}
                         for document, version in sorted(self.answerable.items()) if version not in held]
            return 200, {"format": "nexusrag-index-reconciliation/1",
                         "orphaned_entries": {"versions": len(leftovers), "entries": sum(held[value] for value in leftovers),
                                              "version_ids": leftovers[:body["p_limit"]]},
                         "unindexed_versions": {"count": len(unindexed), "rows": unindexed[:body["p_limit"]]} if body["p_complete"] else None}
        if method == "DELETE" and url == f"{SUPABASE}/storage/v1/object/documents":
            for name in body["prefixes"]:
                if name not in self.undeletable:
                    self.files.pop(name, None)
            return 200, [{"name": name} for name in body["prefixes"]]
        if method == "GET" and url == f"{INDEX}/collections":
            return 200, {"result": {"collections": [{"name": name} for name in self.collections]}, "status": "ok"}
        if "filter" in (body or {}) and not filtered_keys(body["filter"]) <= INDEXED:
            return 400, {"status": {"error": "Bad request: Index required but not found"}}
        if path == f"/collections/{COLLECTION}/points/scroll":
            start = body.get("offset") or 0
            page = [{**point, "payload": {key: value for key, value in point["payload"].items() if key in body["with_payload"]}}
                    for point in self.points[start:start + body["limit"]]]
            following = start + body["limit"]
            return 200, {"result": {"points": page, "next_page_offset": following if following < len(self.points) else None}}
        if path == f"/collections/{COLLECTION}/points/payload/delete":
            assert body["keys"] == ["content", "filename"] and set(body) == {"keys", "points"}, body
            chosen = set(body["points"])
            for point in [] if self.text_kept else self.points:
                if point["id"] in chosen:
                    for key in ("content", "filename"):
                        point["payload"].pop(key, None)
            return 200, {"result": {"status": "completed"}, "status": "ok"}
        if path == f"/collections/{COLLECTION}/points/delete":
            chosen = set(body["filter"]["must"][0]["match"]["any"])
            self.points = [point for point in self.points if point["payload"].get("version_id") not in chosen]
            return 200, {"result": {"status": "completed"}}
        raise AssertionError(f"unexpected request: {method} {url}")

    def run(self, *argv, env=None, extra=None):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.dict(os.environ, {**(ENV if env is None else env), **(extra or {})}, clear=True), \
             mock.patch.object(tool, "http", self.http), mock.patch("sys.stdout", out), mock.patch("sys.stderr", err):
            code = tool.main(list(argv))
        return code, out.getvalue(), err.getvalue()

    def sent(self, method, part):
        return [call for call in self.calls if call[0] == method and part in call[1]]


def out_of_step():
    world = World()
    world.files = {
        f"{WORKSPACE}/doc-kept/{KEPT}/kept-report.pdf": (5000, 600),            # named by a version
        f"{WORKSPACE}/doc-gone/{GONE_A}/payroll-2026.pdf": (4096, 600),         # no row names it
        f"{WORKSPACE}/doc-gone/{GONE_B}/board-minutes.docx": (None, 900),       # no row names it, size unknown
        f"{WORKSPACE}/doc-new/{KEPT}/arriving.txt": (10, 2),                    # stored two minutes ago
    }
    world.named = {f"{WORKSPACE}/doc-kept/{KEPT}/kept-report.pdf"}
    world.originals_gone = [{"workspace_id": WORKSPACE, "document_id": "doc-lost-original", "version_id": None}]
    world.answerable = {"doc-kept": KEPT, "doc-unindexed": "dddddddd-0000-4000-8000-000000000000"}
    world.versions = {KEPT, "dddddddd-0000-4000-8000-000000000000"}
    world.points[0]["payload"]["filename"] = "kept-report.pdf"  # written after NX-36 removed the passage, before the name went
    world.points += [{"id": 10 + n, "payload": {"version_id": GONE_A, "filename": "payroll-2026.pdf", "content": "synthetic payroll passage"}}
                     for n in range(4)]
    world.points += [{"id": 20, "payload": {"version_id": GONE_B}}, {"id": 30, "payload": {}}, {"id": 31, "payload": {"version_id": None}}]
    return world


PRIVATE = ("payroll", "board-minutes", "kept-report", "arriving", WORKSPACE, "doc-", GONE_A, GONE_B, KEPT, "synthetic")


class ReportTests(unittest.TestCase):
    def test_stores_in_step_report_zeros_and_succeed(self):
        world = World()
        code, out, err = world.run("report", "--target", "candidate")
        self.assertEqual((code, err), (0, ""))
        for row in ("| Stored files that no document names | 0 |", "| Documents whose original file is gone | 0 |",
                    "| Index entries of versions that no longer exist | 0 |", "| Answerable documents the index holds nothing of | 0 |",
                    "| Index entries that still hold document text or file names | 0 |"):
            self.assertIn(row, out)
        self.assertNotIn("What to do", out)
        self.assertEqual([call[0] for call in world.calls], ["POST", "GET", "POST", "POST"], "a report only reads")
        self.assertFalse(world.sent("POST", "points/count"), "Qdrant Cloud refuses a count filtered on an unindexed key")

    def test_everything_out_of_step_is_counted_without_naming_anything(self):
        world = out_of_step()
        with tempfile.TemporaryDirectory() as folder:
            summary = Path(folder) / "summary.md"
            code, out, err = world.run("report", "--target", "candidate", extra={"GITHUB_STEP_SUMMARY": str(summary), "GITHUB_ACTIONS": "true"})
            written = summary.read_text()
        self.assertEqual(code, 1)
        self.assertIn("::error::File storage or the search index is out of step", err)
        for row in ("| Stored files that no document names | 2 (4.1 kB) |", "| Documents whose original file is gone | 1 |",
                    "| Index entries of versions that no longer exist | 2 versions, 5 entries |",
                    "| Answerable documents the index holds nothing of | 1 |",
                    "| Index entries that still hold document text or file names | 5 |",
                    "Index entries that name no version at all: 2.",
                    "`python3 scripts/reconciliation.py remove-files --target candidate --expect 2`",
                    "`python3 scripts/reconciliation.py remove-index-entries --target candidate --expect 2`",
                    "`python3 scripts/reconciliation.py remove-index-text --target candidate --expect 5`",
                    "choose Re-index"):
            self.assertIn(row, out)
        self.assertEqual(written.strip(), out.strip())
        # A workflow log is public: no file name, identifier or key may reach it.
        for private in PRIVATE:
            self.assertNotIn(private, out + err, private)
        self.assertFalse(world.sent("DELETE", "") or world.sent("POST", "points/delete") or world.sent("POST", "payload/delete"), "a report removes nothing")
        self.assertTrue(all(call[2]["with_payload"] == ["version_id", "filename"] for call in world.sent("POST", "points/scroll")),
                        "the passage text is never read; file names only mark the entries, and are never printed")

    def test_details_name_what_was_found_but_never_in_a_workflow(self):
        code, out, _ = out_of_step().run("report", "--target", "candidate", "--details")
        self.assertEqual(code, 1)
        self.assertIn(f"- {WORKSPACE}/doc-gone/{GONE_B}/board-minutes.docx (stored 2026-11-01, size unknown)", out)
        self.assertIn(f"- {WORKSPACE}/doc-gone/{GONE_A}/payroll-2026.pdf (stored 2026-11-01, 4.1 kB)", out)
        self.assertLess(out.index("board-minutes"), out.index("payroll"), "oldest first")
        self.assertIn(f"- workspace {WORKSPACE}, document doc-lost-original", out)
        self.assertIn(f"- {GONE_A}", out)
        self.assertIn(f"- workspace {WORKSPACE}, document doc-unindexed", out)
        for kept in ("kept-report", "arriving"):
            self.assertNotIn(kept, out)
        world = out_of_step()
        code, out, err = world.run("report", "--target", "candidate", "--details", extra={"GITHUB_ACTIONS": "true"})
        self.assertEqual((code, out, world.calls), (1, "", []))
        self.assertIn("a workflow log is public", err)

    def test_without_index_settings_only_file_storage_is_checked(self):
        world = out_of_step()
        world.files, world.originals_gone = {}, []
        code, out, _ = world.run("report", "--target", "candidate", env={**ENV, "QDRANT_URL": "", "QDRANT_API_KEY": ""})
        self.assertEqual(code, 0)
        self.assertEqual(out.count("| not checked |"), 3)
        self.assertIn("The search index was not checked", out)
        self.assertEqual(len(world.calls), 1)

    def test_the_whole_index_is_read_page_by_page(self):
        world = out_of_step()
        with mock.patch.object(tool, "PAGE", 2):
            code, out, _ = world.run("report", "--target", "candidate")
        self.assertIn("| Index entries of versions that no longer exist | 2 versions, 5 entries |", out)
        scrolls = world.sent("POST", "points/scroll")
        self.assertEqual([call[2].get("offset") for call in scrolls], [None, 2, 4, 6, 8])
        self.assertTrue(all(call[2]["with_payload"] == ["version_id", "filename"] and call[2]["with_vector"] is False for call in scrolls))
        compared = world.sent("POST", "nexus_index_reconciliation")[0][2]
        self.assertEqual(compared["p_indexed"], [{"value": KEPT, "count": 3}, {"value": GONE_A, "count": 4}, {"value": GONE_B, "count": 1}])
        self.assertIs(compared["p_complete"], True)

    def test_an_index_that_was_reset_holds_nothing_of_any_document(self):
        world = World()
        world.collections = ["another-deployment"]
        code, out, _ = world.run("report", "--target", "candidate")
        self.assertEqual(code, 1)
        self.assertIn("| Answerable documents the index holds nothing of | 1 |", out)
        self.assertIn("| Index entries that still hold document text or file names | 0 |", out)
        self.assertFalse(world.sent("POST", "points/scroll"), "another deployment's collection is never read")

    def test_entries_without_a_version_are_noted_but_are_not_a_finding(self):
        world = World()
        world.points.append({"id": 99, "payload": {"document_id": "legacy"}})
        code, out, _ = world.run("report", "--target", "candidate")
        self.assertEqual(code, 0)
        self.assertIn("Index entries that name no version at all: 1.", out)


class RemovalTests(unittest.TestCase):
    def test_files_are_removed_only_with_the_count_of_a_fresh_report(self):
        world = out_of_step()
        before = dict(world.files)
        for wrong in ("1", "3", "0"):
            code, out, err = world.run("remove-files", "--target", "candidate", "--expect", wrong)
            self.assertEqual((code, out), (1, ""))
            self.assertIn("The report now lists 2 stored files that no document names, not " + wrong, err)
            self.assertIn("Nothing was removed", err)
        self.assertEqual(world.files, before)
        self.assertFalse(world.sent("DELETE", ""))

        with mock.patch.object(tool, "BATCH", 1):
            code, out, err = world.run("remove-files", "--target", "candidate", "--expect", "2")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.strip(), "Removed 2 stored files (4.1 kB); none of them is stored any more.")
        # Only the two leftovers went: the named file and the one stored a moment ago are still there.
        self.assertEqual(sorted(world.files), sorted(name for name in before if "kept-report" in name or "arriving" in name))
        deletes = world.sent("DELETE", "/storage/v1/object/documents")
        self.assertEqual([call[2] for call in deletes], [{"prefixes": [f"{WORKSPACE}/doc-gone/{GONE_B}/board-minutes.docx"]},
                                                        {"prefixes": [f"{WORKSPACE}/doc-gone/{GONE_A}/payroll-2026.pdf"]}])
        self.assertNotIn("payroll", out)
        # Nothing is left, so the same command now has nothing to do and the old count is refused.
        self.assertEqual(world.run("remove-files", "--target", "candidate", "--expect", "0")[:2], (0, "No stored file is without a document. Nothing was removed.\n"))
        self.assertEqual(world.run("remove-files", "--target", "candidate", "--expect", "2")[0], 1)

    def test_a_removal_that_storage_refuses_or_does_not_carry_out_fails(self):
        world = out_of_step()
        world.refuse = {"/storage/v1/object/": 500}
        code, _, err = world.run("remove-files", "--target", "candidate", "--expect", "2")
        self.assertEqual(code, 1)
        self.assertIn("File storage refused to delete (HTTP 500) after 0 of 2 files", err)
        world = out_of_step()
        world.undeletable = {f"{WORKSPACE}/doc-gone/{GONE_A}/payroll-2026.pdf"}
        code, out, err = world.run("remove-files", "--target", "candidate", "--expect", "2")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("1 of the 2 files are still stored", err)
        self.assertNotIn("payroll", err)

    def test_more_leftovers_than_one_report_lists_are_removed_in_rounds(self):
        world = World()
        world.files = {f"leftover-{n}.pdf": (100, 600 + n) for n in range(5)}
        with mock.patch.object(tool, "LIST_LIMIT", 2):
            code, out, _ = world.run("remove-files", "--target", "candidate", "--expect", "5")
        self.assertEqual(code, 0)
        self.assertIn("Removed 2 stored files (200 bytes)", out)
        self.assertIn("3 more remain: run the report and this command again.", out)
        self.assertEqual(sorted(world.files), ["leftover-0.pdf", "leftover-1.pdf", "leftover-2.pdf"], "the oldest went first")

    def test_index_entries_are_removed_only_for_versions_that_no_longer_exist(self):
        world = out_of_step()
        world.answerable = {"doc-kept": KEPT}
        code, _, err = world.run("remove-index-entries", "--target", "candidate", "--expect", "3")
        self.assertEqual(code, 1)
        self.assertIn("index entries of 2 versions that no longer exist, not 3", err)
        self.assertEqual(len(world.points), 10)

        with mock.patch.object(tool, "BATCH", 1):
            code, out, err = world.run("remove-index-entries", "--target", "candidate", "--expect", "2")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.strip(), "Removed the index entries of 2 versions that no longer exist; the index holds none of them any more.")
        self.assertEqual([call[2] for call in world.sent("POST", "points/delete")],
                         [{"filter": {"must": [{"key": "version_id", "match": {"any": [version]}}]}} for version in (GONE_A, GONE_B)])
        self.assertTrue(all("wait=true" in call[1] for call in world.sent("POST", "points/delete")))
        # The kept document's entries and the entries without a version are untouched.
        self.assertEqual([point["payload"].get("version_id") for point in world.points], [KEPT, KEPT, KEPT, None, None])
        self.assertEqual(world.run("remove-index-entries", "--target", "candidate", "--expect", "0")[0], 0)

    def test_index_entries_are_not_removed_when_the_index_looks_like_another_deployments(self):
        world = out_of_step()  # one answerable document has nothing in the index
        code, out, err = world.run("remove-index-entries", "--target", "candidate", "--expect", "2")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("The index also holds nothing of 1 document the database can answer from", err)
        self.assertIn("nothing was removed", err)
        self.assertFalse(world.sent("POST", "points/delete"))
        # Without the index settings there is nothing to remove from.
        code, _, err = world.run("remove-index-entries", "--target", "candidate", "--expect", "2", env={**ENV, "QDRANT_URL": ""})
        self.assertEqual(code, 1)
        self.assertIn("QDRANT_URL and QDRANT_API_KEY are needed", err)

    def test_an_index_that_keeps_its_entries_fails_the_removal(self):
        world = out_of_step()
        world.answerable = {"doc-kept": KEPT}
        world.refuse = {"points/delete": 503}
        code, _, err = world.run("remove-index-entries", "--target", "candidate", "--expect", "2")
        self.assertEqual(code, 1)
        self.assertIn("The search index refused to delete (HTTP 503) after 0 of 2 versions", err)

    def test_text_is_removed_from_index_entries_only_with_the_count_of_a_fresh_report(self):
        world = out_of_step()
        code, out, err = world.run("remove-index-text", "--target", "candidate", "--expect", "4")
        self.assertEqual((code, out), (1, ""))
        self.assertIn("The report now counts 5 index entries with document text or file names, not 4.", err)
        self.assertIn("Nothing was removed", err)
        self.assertFalse(world.sent("POST", "payload/delete"))

        code, out, err = world.run("remove-index-text", "--target", "candidate", "--expect", "5")
        self.assertEqual((code, err), (0, ""))
        self.assertEqual(out.strip(), "Removed document text and file names from 5 index entries; the entries stay searchable.")
        removal = world.sent("POST", "payload/delete")
        self.assertEqual([call[2]["keys"] for call in removal], [["content", "filename"]])
        self.assertTrue(all("filter" not in call[2] for call in removal), "entries are chosen by id, never by an unindexed filter")
        self.assertIn("wait=true", removal[0][1])
        self.assertFalse(any(holds_text(point) for point in world.points))
        self.assertEqual([point["payload"].get("version_id") for point in world.points], [KEPT] * 3 + [GONE_A] * 4 + [GONE_B, None, None],
                         "every entry stays, with its identifiers")
        for private in PRIVATE:
            self.assertNotIn(private, out + err, private)
        code, out, _ = world.run("remove-index-text", "--target", "candidate", "--expect", "0")
        self.assertEqual(code, 0)
        self.assertIn("No index entry holds document text or a file name. Nothing was removed.", out)
        self.assertEqual(len(world.sent("POST", "payload/delete")), 1)

    def test_many_entries_are_cleared_in_batches_by_id(self):
        world = World()
        world.points += [{"id": 100 + n, "payload": {"version_id": KEPT, "filename": "Synthetic notes.pdf"}} for n in range(2 * tool.BATCH + 7)]
        code, out, err = world.run("remove-index-text", "--target", "candidate", "--expect", str(2 * tool.BATCH + 7))
        self.assertEqual((code, err), (0, ""), out)
        removal = world.sent("POST", "payload/delete")
        self.assertEqual([len(call[2]["points"]) for call in removal], [tool.BATCH, tool.BATCH, 7])
        self.assertFalse(any(holds_text(point) for point in world.points))
        self.assertNotIn("Synthetic notes.pdf", out + err)

    def test_an_index_that_keeps_the_text_fails_the_removal(self):
        world = out_of_step()
        world.refuse = {"payload/delete": 503}
        code, _, err = world.run("remove-index-text", "--target", "candidate", "--expect", "5")
        self.assertEqual(code, 1)
        self.assertIn("The search index refused to remove the text (HTTP 503)", err)
        world = out_of_step()
        world.text_kept = True
        code, _, err = world.run("remove-index-text", "--target", "candidate", "--expect", "5")
        self.assertEqual(code, 1)
        self.assertIn("After the removal the index still counts 5 entries with document text or file names", err)
        # Without the index settings there is nothing to clear; an index that was reset holds nothing.
        code, _, err = world.run("remove-index-text", "--target", "candidate", "--expect", "5", env={**ENV, "QDRANT_API_KEY": ""})
        self.assertEqual(code, 1)
        self.assertIn("QDRANT_URL and QDRANT_API_KEY are needed", err)
        world = World()
        world.collections = ["another-deployment"]
        code, out, _ = world.run("remove-index-text", "--target", "candidate", "--expect", "0")
        self.assertEqual(code, 0)
        self.assertIn("Nothing was removed", out)
        self.assertFalse(world.sent("POST", "payload/delete"))


class SafetyTests(unittest.TestCase):
    def test_settings_are_checked_before_anything_is_asked(self):
        world = World()
        self.assertEqual(world.run("report", "--target", "candidate", env={"SUPABASE_URL": SUPABASE})[0], 2)
        # Production's database is never compared under the candidate's name, nor the other way round.
        code, _, err = world.run("report", "--target", "candidate", env={**ENV, "SUPABASE_URL": release.supabase_url(release.TARGETS["production"])})
        self.assertEqual(code, 1)
        self.assertIn("SUPABASE_URL names another one", err)
        for argv, message in ((("report", "--target", "candidate", "--grace-minutes", "5"), "at least 10"),
                              (("remove-files", "--target", "candidate"), "needs --expect"),
                              (("remove-index-entries", "--target", "candidate", "--expect", "-1"), "needs --expect"),
                              (("remove-index-text", "--target", "candidate"), "needs --expect")):
            code, _, err = world.run(*argv)
            self.assertEqual(code, 1)
            self.assertIn(message, err)
        self.assertEqual(world.calls, [])

    def test_each_key_goes_only_to_its_own_service_and_a_secret_key_is_not_a_bearer_token(self):
        world = out_of_step()
        world.run("report", "--target", "candidate")
        for _, url, _, headers in world.calls:
            if url.startswith(SUPABASE):
                self.assertEqual(headers, {"apikey": ENV["SUPABASE_SERVICE_ROLE_KEY"], "Authorization": f"Bearer {ENV['SUPABASE_SERVICE_ROLE_KEY']}"})
            else:
                self.assertTrue(url.startswith(INDEX + "/"))
                self.assertEqual(headers, {"api-key": ENV["QDRANT_API_KEY"]})
        self.assertEqual(world.sent("POST", "nexus_storage_reconciliation")[0][2], {"p_grace_seconds": 3600, "p_limit": 1000})
        secret = World()
        secret.run("report", "--target", "candidate", env={**ENV, "SUPABASE_SERVICE_ROLE_KEY": "sb_secret_test"})
        self.assertEqual(secret.calls[0][3], {"apikey": "sb_secret_test"})

    def test_failures_say_what_failed_without_repeating_what_the_service_said(self):
        for refuse, message in (({"rpc/nexus_storage_reconciliation": 404}, "apply migration 20261114120000_storage_reconciliation"),
                                ({"rpc/nexus_storage_reconciliation": 401}, "did not accept the service role key"),
                                ({"rpc/nexus_index_reconciliation": 500}, "The database refused the report (HTTP 500)"),
                                ({"/collections": 403}, "The search index did not accept its key"),
                                ({"points/scroll": 502}, "The search index did not list its entries (HTTP 502)"),
                                ):
            world = out_of_step()
            world.refuse = refuse
            code, out, err = world.run("report", "--target", "candidate")
            self.assertEqual((code, out), (1, ""), message)
            self.assertIn(message, err)
        # A report in another form is not read as "nothing found".
        world = World()
        with mock.patch.object(World, "http", lambda self, *args, **kwargs: (200, {"unreferenced_objects": {"count": "0"}})):
            code, _, err = world.run("report", "--target", "candidate")
        self.assertEqual(code, 1)
        self.assertIn("not in the expected form", err)

    def test_a_refusal_is_reduced_to_its_status_and_no_answer_to_the_host(self):
        refusal = error.HTTPError("https://service.example/x", 409, "Conflict", {}, io.BytesIO(b'{"message":"payroll-2026.pdf is locked"}'))
        with mock.patch.object(tool.request, "urlopen", side_effect=refusal):
            self.assertEqual(tool.http("POST", "https://service.example/x", {"apikey": "k"}, {"a": 1}), (409, None))
        with mock.patch.object(tool.request, "urlopen", side_effect=error.URLError("synthetic-secret refused")):
            with self.assertRaisesRegex(tool.ReconcileError, r"^No answer from service\.example \(URLError\)\.$"):
                tool.http("GET", "https://service.example/x?key=synthetic", {})

        class Answer:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self): return b'{"ok": true}'
        with mock.patch.object(tool.request, "urlopen", return_value=Answer()) as opened:
            self.assertEqual(tool.http("DELETE", "https://service.example/x", {"apikey": "k"}, {"prefixes": ["a"]}), (200, {"ok": True}))
        sent = opened.call_args.args[0]
        self.assertEqual((sent.get_method(), json.loads(sent.data), sent.get_header("Content-type"), sent.get_header("Apikey"), sent.get_header("User-agent")),
                         ("DELETE", {"prefixes": ["a"]}, "application/json", "k", "nexusrag-reconciliation"))


class WorkflowTests(unittest.TestCase):
    def test_the_workflow_is_manual_reports_by_default_and_never_prints_details(self):
        text = (ROOT / ".github/workflows/store-reconciliation.yml").read_text()
        workflow = yaml.safe_load(text)
        triggers = workflow.get(True) or workflow.get("on")
        self.assertEqual(set(triggers), {"workflow_dispatch"})
        self.assertEqual(workflow["permissions"], {"contents": "read"})
        inputs = triggers["workflow_dispatch"]["inputs"]
        self.assertEqual((inputs["action"]["default"], inputs["action"]["options"]),
                         ("report", ["report", "remove-files", "remove-index-entries", "remove-index-text"]))
        self.assertEqual(inputs["target"]["options"], sorted(release.TARGETS))
        job = workflow["jobs"]["reconcile"]
        self.assertIn("'Production'", job["environment"])
        self.assertIn("'NexusRAG-Candidate-Preview'", job["environment"])
        self.assertNotIn("--details", text)
        self.assertIn("remove-files|remove-index-entries|remove-index-text)", text, "every removal takes the expected count")
        self.assertNotIn("${{ inputs.", "".join(step.get("run", "") for step in job["steps"]), "inputs reach the script through the environment only")
        for step in job["steps"]:
            if "uses" in step:
                self.assertRegex(step["uses"], r"^actions/[a-z-]+@[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
