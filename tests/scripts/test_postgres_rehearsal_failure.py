"""Execute the actual CI shell with temporary peers to prove failure visibility.

These peers do not execute PostgreSQL or claim application verification. They
exercise the real workflow's shell branches, redirects, cleanup and exit status.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
REPORTER = ROOT / "scripts/report_postgres_rehearsal_failure.py"
SPEC = importlib.util.spec_from_file_location("postgres_failure_report", REPORTER)
REPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REPORT)
WORKFLOW = yaml.safe_load((ROOT / ".github/workflows/v6-database-rehearsal.yml").read_text())
SHELL = next(step["run"] for step in WORKFLOW["jobs"]["clean-baseline-rehearsal"]["steps"]
             if step.get("name") == "Replay clean baseline and candidate migrations")
MARKERS = [shlex.split(line.strip())[2] for line in SHELL.splitlines()
           if line.strip().startswith("grep -F ")]


class PostgresAnnotationTests(unittest.TestCase):
    def test_postgres_location_and_current_phase_are_preserved(self):
        value = REPORT.annotation(
            "NEXUS_REHEARSAL_PHASE=sql_rehearsal\n"
            "psql:/tmp/source/tests/postgres/account-trial-assertions.sql:99: ERROR: used=2 expected=1",
            exit_code=37,
        )
        self.assertIn("file=tests/postgres/account-trial-assertions.sql,line=99", value)
        self.assertIn("phase sql_rehearsal (exit 37): used=2 expected=1", value)

    def test_later_checker_does_not_reuse_an_earlier_sql_diagnostic(self):
        value = REPORT.annotation(
            "NEXUS_REHEARSAL_PHASE=sql_rehearsal\n"
            "psql:/tmp/source/tests/postgres/old.sql:1: ERROR: prior phase\n"
            "NEXUS_REHEARSAL_PHASE=radar_package_worker\nError: current checker failed",
            phase="package_checkers", exit_code=9,
        )
        self.assertIn("phase radar_package_worker (exit 9)", value)
        self.assertIn("current checker failed", value)
        self.assertNotIn("old.sql", value)
        self.assertNotIn("prior phase", value)

    def test_missing_marker_is_precise_without_reflecting_other_commands(self):
        value = REPORT.annotation("NEXUS_REHEARSAL_PHASE=pass_marker_validation\n",
                                  exit_code=1,
                                  failed_command="grep -F 'FINDING_PACKAGE_SQL_PASS' \"$log\"")
        self.assertIn("Required pass marker missing: FINDING_PACKAGE_SQL_PASS", value)
        other = REPORT.annotation("", phase="gateway_import", exit_code=2,
                                  failed_command="node --credential=DO_NOT_REFLECT")
        self.assertNotIn("DO_NOT_REFLECT", other)

    def test_annotation_is_bounded_and_percent_escaped(self):
        value = REPORT.annotation("Error: " + "%" * 10_000, phase="legacy_package_jsonld", exit_code=1)
        self.assertLessEqual(len(value.split("::", 2)[2]), 2000)
        self.assertIn("%25", value)

    def test_missing_log_cli_uses_static_phase_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([sys.executable, str(REPORTER), directory + "/absent.log",
                                     "--phase", "gateway_import", "--exit-code", "23"],
                                    text=True, capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("phase gateway_import (exit 23)", result.stdout)
        self.assertIn("preserved log could not be read", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_phase_sidecar_survives_a_large_redirected_checker_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log, phase = root / "log", root / "phase"
            log.write_text("NEXUS_REHEARSAL_PHASE=legacy_package_worker\n" + "x" * 300_000 +
                           "\nError: synthetic large checker failure\n")
            phase.write_text("legacy_package_worker\n")
            result = subprocess.run([sys.executable, str(REPORTER), str(log), "--phase",
                                     "package_checkers", "--phase-file", str(phase),
                                     "--exit-code", "47"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("phase legacy_package_worker (exit 47)", result.stdout)
        self.assertIn("synthetic large checker failure", result.stdout)


class WorkflowFailureTransportTests(unittest.TestCase):
    def run_workflow(self, fail_phase="", *, missing_marker=False, helper_failure=False,
                     cleanup_failure=False, remove_log=False, long_error=False,
                     distinct_cleanup_failures=False, cleanup_command=""):
        with tempfile.TemporaryDirectory(prefix="nexusrag-ci-transport-test-") as directory:
            base = Path(directory)
            workspace, bin_dir, runner = base / "workspace", base / "bin", base / "runner"
            for path in (workspace / "scripts", workspace / "frontend", bin_dir, runner):
                path.mkdir(parents=True)
            helper = workspace / "scripts/report_postgres_rehearsal_failure.py"
            helper.write_text("raise SystemExit(47)\n" if helper_failure else REPORTER.read_text())
            # Populate exactly the source inventory that the actual YAML copies.
            for name in re.findall(r'\$GITHUB_WORKSPACE/([^"\n]+)', SHELL):
                path = workspace / name
                if path.suffix:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text("synthetic copied source\n")
                else:
                    path.mkdir(parents=True, exist_ok=True)
            # The copy-inventory regex also sees the reporter path; restore it.
            helper.write_text("raise SystemExit(47)\n" if helper_failure else REPORTER.read_text())
            postgres = workspace / "tests/postgres"
            postgres.mkdir(parents=True, exist_ok=True)
            (workspace / "tests/fixtures").mkdir(parents=True, exist_ok=True)
            sql = ["#!/usr/bin/env bash", "set -euo pipefail",
                   'if [[ "$TEST_FAIL_PHASE" = sql_rehearsal ]]; then',
                   "  echo 'psql:/tmp/source/tests/postgres/account-trial-assertions.sql:99: ERROR: synthetic admission failure' >&2",
                   "  exit 37", "fi"]
            for marker in MARKERS:
                sql.append(f"if [[ \"${{TEST_MISSING_MARKER:-}}\" != {shlex.quote(marker)} ]]; then printf '%s\\n' {shlex.quote(marker)}; fi")
            sql.append("echo LOCAL_POSTGRES_REHEARSAL_PASS")
            (postgres / "local-rehearsal.sh").write_text("\n".join(sql) + "\n")
            (postgres / "backup-restore.sh").write_text(
                "#!/usr/bin/env bash\nset -euo pipefail\n"
                'if [[ "$TEST_FAIL_PHASE" = backup_restore ]]; then echo "Error: synthetic restore failure" >&2; exit 37; fi\n'
                "echo POSTGRES_BACKUP_RESTORE_PASS\n")
            peer = f"#!{sys.executable}\n" + r'''
import json,os,pathlib,subprocess,sys
name=pathlib.Path(sys.argv[0]).name;args=sys.argv[1:]
log=pathlib.Path(os.environ["RUNNER_TEMP"])/"postgres-rehearsal.log"
phase_file=pathlib.Path(os.environ["RUNNER_TEMP"])/"postgres-rehearsal.phase"
phase=phase_file.read_text().strip() if phase_file.exists() else ""
if name=="sudo":
 if args[:1]==["-u"]:args=args[2:]
 os.execvp(args[0],args)
targets={"cluster_startup":"pg_ctlcluster","temporary_directories":"mktemp","source_copy":"cp","gateway_import":"node","database_create":"createdb","artifact_ownership":"chown","legacy_package_jsonld":"node","legacy_package_worker":"node","radar_package_worker":"node"}
if os.environ.get("TEST_FAIL_PHASE")==phase and targets.get(phase)==name:
 if os.environ.get("TEST_LONG_ERROR"):print("x"*300000,file=sys.stderr)
 print("Error: synthetic "+phase+" failure",file=sys.stderr)
 if os.environ.get("TEST_REMOVE_LOG"):log.unlink(missing_ok=True)
 sys.exit(37)
if name==os.environ.get("TEST_CLEANUP_COMMAND") and (name=="dropdb" or args[-1:]==["stop"]):
 print("Error: synthetic "+name+" cleanup failure",file=sys.stderr)
 sys.exit(61 if name=="dropdb" else 62)
if name=="rm" and os.environ.get("TEST_CLEANUP_FAIL"):
 print("Error: synthetic cleanup failure",file=sys.stderr)
 if os.environ.get("TEST_DISTINCT_CLEANUP_FAILURES"):
  sys.exit(51 if "nexusrag-pg-rehearsal." in args[-1] else 57)
 sys.exit(79)
if name=="pg_lsclusters":print("17 main 55432 online postgres /tmp/data /tmp/log");sys.exit(0)
if name in {"pg_ctlcluster","pg_createcluster","createdb","dropdb","chown","node"}:sys.exit(0)
if name=="mktemp":
 result=subprocess.run(["/usr/bin/mktemp",*args],text=True,capture_output=True)
 if result.returncode==0:
  with open(os.environ["TEST_CREATED_PATHS"],"a") as output:output.write(json.dumps(result.stdout.strip())+"\n")
 sys.stdout.write(result.stdout);sys.stderr.write(result.stderr);sys.exit(result.returncode)
if name in {"cp","rm"}:os.execv("/bin/"+name,[name,*args])
raise RuntimeError("Unexpected temporary command peer "+name)
'''
            for name in ("sudo", "pg_lsclusters", "pg_ctlcluster", "pg_createcluster", "createdb",
                         "dropdb", "chown", "node", "mktemp", "cp", "rm"):
                path = bin_dir / name
                path.write_text(peer)
                path.chmod(0o755)
            script = base / "workflow.sh"
            script.write_text(SHELL)
            created_paths = base / "created.jsonl"
            environment = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ["PATH"],
                           "RUNNER_TEMP": str(runner), "GITHUB_WORKSPACE": str(workspace),
                           "TEST_FAIL_PHASE": fail_phase, "TEST_CREATED_PATHS": str(created_paths),
                           "TEST_CLEANUP_COMMAND": cleanup_command,
                           "TEST_MISSING_MARKER": "FINDING_PACKAGE_SQL_PASS" if missing_marker else ""}
            for name, enabled in (("TEST_CLEANUP_FAIL", cleanup_failure), ("TEST_REMOVE_LOG", remove_log),
                                  ("TEST_LONG_ERROR", long_error),
                                  ("TEST_DISTINCT_CLEANUP_FAILURES", distinct_cleanup_failures)):
                if enabled:
                    environment[name] = "1"
                else:
                    environment.pop(name, None)
            try:
                result = subprocess.run(["bash", str(script)], cwd=workspace, env=environment,
                                        capture_output=True, text=True, timeout=20)
                log = runner / "postgres-rehearsal.log"
                result.rehearsal_log = log.read_text() if log.exists() else ""
                result.created_paths_remaining = []
                if created_paths.exists():
                    paths = [Path(json.loads(line)) for line in created_paths.read_text().splitlines()]
                    result.created_paths_remaining = [str(path) for path in paths if path.exists()]
                return result
            finally:
                if created_paths.exists():
                    for line in created_paths.read_text().splitlines():
                        path = Path(json.loads(line))
                        assert path.parent == Path("/tmp") and path.name.startswith(("nexusrag-pg-rehearsal.", "nexusrag-package-rehearsal.")), path
                        shutil.rmtree(path, ignore_errors=True)

    def test_success_has_no_failure_annotation_and_cleans_owned_directories(self):
        result = self.run_workflow()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("::error", result.stdout)
        self.assertEqual(result.created_paths_remaining, [])

    def test_actual_shell_failure_phases_preserve_status_and_console_annotation(self):
        phases = ("cluster_startup", "temporary_directories", "source_copy", "gateway_import",
                  "database_create", "sql_rehearsal", "artifact_ownership", "legacy_package_jsonld",
                  "legacy_package_worker", "radar_package_worker", "backup_restore")
        for phase in phases:
            with self.subTest(phase=phase):
                result = self.run_workflow(phase)
                self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
                annotations = [line for line in result.stdout.splitlines() if line.startswith("::error")]
                self.assertEqual(len(annotations), 1, result.stdout + result.stderr)
                self.assertIn(f"phase {phase} (exit 37)", annotations[0])
                self.assertIn("synthetic", annotations[0])
                self.assertEqual(result.created_paths_remaining, [])

    def test_failed_grep_reports_the_missing_literal_marker(self):
        result = self.run_workflow(missing_marker=True)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("phase pass_marker_validation (exit 1)", result.stdout)
        self.assertIn("Required pass marker missing: FINDING_PACKAGE_SQL_PASS", result.stdout)

    def test_helper_failure_does_not_mask_original_error_or_hide_console_fallback(self):
        result = self.run_workflow("legacy_package_worker", helper_failure=True)
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertEqual(result.stdout.count("::error"), 1)
        self.assertIn("diagnostic reporting was unavailable", result.stdout)
        self.assertIn("phase legacy_package_worker (exit 37)", result.stdout)
        self.assertEqual(result.created_paths_remaining, [])

    def test_redirected_long_checker_error_keeps_its_exact_child_phase(self):
        result = self.run_workflow("legacy_package_worker", long_error=True)
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertIn("phase legacy_package_worker (exit 37)", result.stdout)
        self.assertIn("synthetic legacy_package_worker failure", result.stdout)
        self.assertEqual(result.stdout.count("::error"), 1)

    def test_startup_missing_log_uses_original_phase_and_status(self):
        result = self.run_workflow("gateway_import", remove_log=True)
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertIn("phase gateway_import (exit 37)", result.stdout)
        self.assertIn("preserved log could not be read", result.stdout)

    def test_cleanup_failure_after_success_is_not_green(self):
        result = self.run_workflow(cleanup_failure=True)
        self.assertEqual(result.returncode, 79, result.stdout + result.stderr)
        self.assertIn("phase cleanup (exit 79)", result.stdout)
        self.assertEqual(result.stdout.count("::error"), 1)

    def test_cleanup_failure_preserves_the_original_nonzero_status(self):
        result = self.run_workflow("legacy_package_jsonld", cleanup_failure=True)
        self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
        self.assertIn("phase legacy_package_jsonld (exit 37)", result.stdout)
        self.assertEqual(result.stdout.count("::error"), 1)

    def test_both_cleanup_removals_are_attempted_and_first_failure_is_retained(self):
        result = self.run_workflow(cleanup_failure=True, distinct_cleanup_failures=True)
        self.assertEqual(result.returncode, 51, result.stdout + result.stderr)
        self.assertIn("phase cleanup (exit 51)", result.stdout)
        self.assertEqual(len(result.created_paths_remaining), 2)
        self.assertEqual(result.rehearsal_log.count("synthetic cleanup failure"), 2)

    def test_database_and_cluster_cleanup_failures_after_success_are_not_green(self):
        for command, status in (("dropdb", 61), ("pg_ctlcluster", 62)):
            with self.subTest(command=command):
                result = self.run_workflow(cleanup_command=command)
                self.assertEqual(result.returncode, status, result.stdout + result.stderr)
                self.assertIn(f"phase cleanup (exit {status})", result.stdout)
                self.assertIn(f"synthetic {command} cleanup failure", result.stdout)
                self.assertEqual(result.created_paths_remaining, [])

    def test_database_and_cluster_cleanup_failures_preserve_original_failure(self):
        for command in ("dropdb", "pg_ctlcluster"):
            with self.subTest(command=command):
                result = self.run_workflow("legacy_package_worker", cleanup_command=command)
                self.assertEqual(result.returncode, 37, result.stdout + result.stderr)
                self.assertIn("phase legacy_package_worker (exit 37)", result.stdout)
                self.assertEqual(result.stdout.count("::error"), 1)
                self.assertIn(f"synthetic {command} cleanup failure", result.rehearsal_log)
                self.assertEqual(result.created_paths_remaining, [])


if __name__ == "__main__":
    unittest.main()
