#!/usr/bin/env bash
# Proves scripts/migration_status.py against a real database: name-based status, the pre-migration snapshot,
# ordered apply with history rows, a no-op second run, and rollback of a failing migration.
# The database starts in the hosted rehearsal project's state of 2026-11-11: later migrations applied while
# 040-042 and the three newest files are still pending, recorded under hosted-style names.
# Run only against a disposable local PostgreSQL cluster.
set -euo pipefail
export LC_ALL=C
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TESTS="$ROOT/tests/postgres"
TOOL="$ROOT/scripts/migration_status.py"
: "${PGHOST:?Set PGHOST to the local PostgreSQL socket directory}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to a local PostgreSQL superuser}"
: "${PGDATABASE:?Set PGDATABASE to the rehearsal database name}"
DB="${PGDATABASE}_migration_tool"
WORK=$(mktemp -d)
cleanup() { dropdb --if-exists "$DB" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
dropdb --if-exists "$DB"
createdb "$DB"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d "$DB")
export SUPABASE_DB_URL="postgresql:///${DB}?host=${PGHOST}&port=${PGPORT}&user=${PGUSER}"

HELD_BACK=(
  040_recipient_bound_workspace_invitations.sql
  041_fenced_retention_schedule_completion.sql
  042_scoped_manual_retention_claim.sql
  20261025093226_finding_evidence_packages.sql
  20261026123000_radar_supplied_snapshots.sql
  20261027153000_obligation_evidence_serving.sql
)
# Anything newer than the last held-back file was written after that state and may depend on it.
LAST_HELD="${HELD_BACK[-1]}"
held_back() { local file; [[ "$1" > "$LAST_HELD" ]] && return 0; for file in "${HELD_BACK[@]}"; do [[ "$file" == "$1" ]] && return 0; done; return 1; }
PENDING=()
while IFS= read -r file; do if held_back "$file"; then PENDING+=("$file"); fi; done < <(python3 "$TOOL" chain)

"${PSQL[@]}" -f "$TESTS/bootstrap.sql"
"${PSQL[@]}" -f "$ROOT/supabase/baseline/001_v6_zero_cost_baseline.sql" >/dev/null
"${PSQL[@]}" <<'SQL'
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text, created_by text, idempotency_key text, rollback text[]
);
insert into supabase_migrations.schema_migrations (version, name) values
  ('20260923200843', '001_v6_zero_cost_baseline'),
  ('20260923203934', 'temporary_hosted_reservation_concurrency_harness');
SQL
version=20260924000000
while IFS= read -r file; do
  if held_back "$file"; then continue; fi
  "${PSQL[@]}" -f "$ROOT/supabase/migrations/$file" >/dev/null
  version=$((version + 1))
  stem="${file%.sql}"
  case "$file" in
    026_*) name="rehearsal_026_reindex_original_reuse_compat" ;;  # recorded under a different hosted name
    039_*|2026*) name="${stem#*_}" ;;                             # hosted history without the prefix
    *) name="$stem" ;;
  esac
  "${PSQL[@]}" -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
done < <(python3 "$TOOL" chain)
"${PSQL[@]}" -f "$TESTS/fixtures.sql" >/dev/null

python3 "$TOOL" status --json >"$WORK/before.json"
python3 - "$WORK/before.json" "${PENDING[@]}" <<'PY'
import json, sys
report = json.load(open(sys.argv[1]))
assert report["base"] == "baseline", report["base"]
assert report["pending"] == sys.argv[2:], report["pending"]
assert report["hosted_only"] == ["temporary_hosted_reservation_concurrency_harness"], report["hosted_only"]
PY
if python3 "$TOOL" status --fail-on-pending >/dev/null; then echo "status --fail-on-pending must fail while migrations are pending" >&2; exit 1; fi

tables_before=$("${PSQL[@]}" -At -c "select count(*) from pg_tables where schemaname = 'public'")
workspaces_before=$("${PSQL[@]}" -At -c "select count(*) from public.workspaces")
test "$workspaces_before" -gt 0
python3 "$TOOL" apply --snapshot-label tool_test >"$WORK/apply.log"
grep -Fq 'snapshot: backup_tool_test' "$WORK/apply.log"
"${PSQL[@]}" -At >"$WORK/after.txt" <<SQL
select 'snapshot_tables=' || count(*) from pg_tables where schemaname = 'backup_tool_test';
select 'snapshot_workspaces=' || count(*) from backup_tool_test.workspaces;
select 'api_roles_can_read_snapshot=' || bool_or(has_schema_privilege(r, 'backup_tool_test', 'usage'))
  from unnest(array['anon', 'authenticated']) r;
select 'recorded=' || string_agg(name, ',' order by version) from supabase_migrations.schema_migrations where version > '$version';
select 'statements_recorded=' || bool_and(array_length(statements, 1) = 1 and length(statements[1]) > 100)
  from supabase_migrations.schema_migrations where version > '$version';
select 'new_objects=' || (to_regclass('public.workspace_invitations') is not null
  and to_regprocedure('public.nexus_invitation_version()') is not null
  and exists (select 1 from pg_proc where proname = 'claim_workspace_retention')
  and exists (select 1 from pg_proc where proname = 'finish_retention_claim'));
SQL
expected_recorded=$(printf '%s,' "${PENDING[@]%.sql}"); expected_recorded="${expected_recorded%,}"
grep -Fxq "snapshot_tables=$tables_before" "$WORK/after.txt"
grep -Fxq "snapshot_workspaces=$workspaces_before" "$WORK/after.txt"
grep -Fxq 'api_roles_can_read_snapshot=false' "$WORK/after.txt"
grep -Fxq "recorded=$expected_recorded" "$WORK/after.txt"
grep -Fxq 'statements_recorded=true' "$WORK/after.txt"
grep -Fxq 'new_objects=true' "$WORK/after.txt"
python3 "$TOOL" status --fail-on-pending >/dev/null

# A second run has nothing to do and takes no snapshot.
python3 "$TOOL" apply --snapshot-label tool_again >/dev/null
test "$("${PSQL[@]}" -At -c "select count(*) from pg_namespace where nspname = 'backup_tool_again'")" = 0

# The security assertions hold for a database that reached the head in hosted order.
"${PSQL[@]}" -f "$TESTS/security-assertions.sql" >/dev/null

# A failing migration rolls back completely, is not recorded, and stops the run.
mkdir "$WORK/migrations"
cp "$ROOT"/supabase/migrations/*.sql "$WORK/migrations/"
printf 'create table public.migration_tool_ok (id int primary key);\n' >"$WORK/migrations/20990101000000_tool_ok.sql"
printf 'create table public.migration_tool_partial (id int primary key);\nselect 1 / 0;\n' >"$WORK/migrations/20990102000000_tool_broken.sql"
printf 'create table public.migration_tool_never (id int primary key);\n' >"$WORK/migrations/20990103000000_tool_after.sql"
if python3 "$TOOL" apply --snapshot-label tool_fail --migrations-dir "$WORK/migrations" >"$WORK/fail.log"; then
  echo "apply must fail when a migration fails" >&2; exit 1
fi
grep -Fq '20990102000000_tool_broken.sql failed and was rolled back' "$WORK/fail.log"
"${PSQL[@]}" -At >"$WORK/fail.txt" <<'SQL'
select 'ok=' || (to_regclass('public.migration_tool_ok') is not null);
select 'partial=' || (to_regclass('public.migration_tool_partial') is not null);
select 'never=' || (to_regclass('public.migration_tool_never') is not null);
select 'recorded=' || string_agg(name, ',' order by version) from supabase_migrations.schema_migrations where name like '%tool_%';
select 'snapshot=' || count(*) from pg_namespace where nspname = 'backup_tool_fail';
SQL
grep -Fxq 'ok=true' "$WORK/fail.txt"
grep -Fxq 'partial=false' "$WORK/fail.txt"
grep -Fxq 'never=false' "$WORK/fail.txt"
grep -Fxq 'recorded=20990101000000_tool_ok' "$WORK/fail.txt"
grep -Fxq 'snapshot=1' "$WORK/fail.txt"
echo 'MIGRATION_TOOL_REAL_SQL_PASS snapshot+ordered_apply+history+noop+rollback'
