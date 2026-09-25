#!/usr/bin/env bash
# Rehearse a logical backup and restore only against a disposable local database.
set -euo pipefail
: "${PGHOST:?Set PGHOST to the local PostgreSQL socket directory}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to a local PostgreSQL superuser}"
: "${PGDATABASE:?Set PGDATABASE to the disposable source database}"

SOURCE_DB="$PGDATABASE"
RESTORE_DB="${PGDATABASE}_restore_$$"
BACKUP_FILE="$(mktemp "${TMPDIR:-/tmp}/nexusrag-pg-backup.XXXXXX")"
PSQL=(psql -X -v ON_ERROR_STOP=1)
cleanup() {
  dropdb --if-exists --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" "$RESTORE_DB" >/dev/null 2>&1 || true
  rm -f "$BACKUP_FILE"
}
trap cleanup EXIT

pg_dump --format=custom --no-password \
  --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --file "$BACKUP_FILE" "$SOURCE_DB"
test -s "$BACKUP_FILE"
createdb --no-password --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" "$RESTORE_DB"
pg_restore --exit-on-error --no-password \
  --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$RESTORE_DB" "$BACKUP_FILE"

tables="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$SOURCE_DB" --tuples-only --no-align \
  --command "SELECT quote_ident(schemaname) || '.' || quote_ident(tablename) FROM pg_tables WHERE schemaname IN ('public','auth','storage') ORDER BY schemaname, tablename")"
test -n "$tables"
table_count=0
while IFS= read -r relation; do
  test -n "$relation" || continue
  source_hash="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
    --dbname "$SOURCE_DB" --tuples-only --no-align \
    --command "SELECT md5(coalesce(string_agg(row_data, E'\\n' ORDER BY row_data), '')) FROM (SELECT to_jsonb(t)::text AS row_data FROM $relation AS t) AS restore_rows")"
  restored_hash="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
    --dbname "$RESTORE_DB" --tuples-only --no-align \
    --command "SELECT md5(coalesce(string_agg(row_data, E'\\n' ORDER BY row_data), '')) FROM (SELECT to_jsonb(t)::text AS row_data FROM $relation AS t) AS restore_rows")"
  test "$source_hash" = "$restored_hash" || {
    echo "Backup/restore row digest mismatch for $relation" >&2
    exit 1
  }
  table_count=$((table_count + 1))
done <<< "$tables"

source_extensions="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$SOURCE_DB" --tuples-only --no-align \
  --command "SELECT string_agg(extname || ':' || extversion, ',' ORDER BY extname) FROM pg_extension")"
restored_extensions="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$RESTORE_DB" --tuples-only --no-align \
  --command "SELECT string_agg(extname || ':' || extversion, ',' ORDER BY extname) FROM pg_extension")"
test "$source_extensions" = "$restored_extensions"

source_functions="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$SOURCE_DB" --tuples-only --no-align \
  --command "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage')")"
restored_functions="$("${PSQL[@]}" --host "$PGHOST" --port "$PGPORT" --username "$PGUSER" \
  --dbname "$RESTORE_DB" --tuples-only --no-align \
  --command "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth','storage')")"
test "$source_functions" = "$restored_functions"

echo "POSTGRES_BACKUP_RESTORE_PASS tables=$table_count extensions=${source_extensions:-none} functions=$source_functions"