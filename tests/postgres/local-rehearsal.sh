#!/usr/bin/env bash
# Run only against a disposable, empty local PostgreSQL 17 database.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TESTS="$ROOT/tests/postgres"
: "${PGHOST:?Set PGHOST to the local PostgreSQL socket directory}"
: "${PGPORT:?Set PGPORT to the local PostgreSQL port}"
: "${PGUSER:?Set PGUSER to a local PostgreSQL superuser}"
: "${PGDATABASE:?Set PGDATABASE to a fresh local database}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -d "$PGDATABASE")
"${PSQL[@]}" -f "$TESTS/bootstrap.sql"
"${PSQL[@]}" -f "$ROOT/supabase/baseline/001_v6_zero_cost_baseline.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/migrations/027_metered_operation_admission.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/028_resumable_chunk_staging.sql"
"${PSQL[@]}" -f "$TESTS/fixtures.sql"
"${PSQL[@]}" -f "$TESTS/security-assertions.sql"
"${PSQL[@]}" -f "$TESTS/quota-assertions.sql"
"${PSQL[@]}" -f "$TESTS/storage-fixtures.sql"
"${PSQL[@]}" -f "$TESTS/storage-assertions.sql"
"${PSQL[@]}" -f "$TESTS/batch-assertions.sql"
bash "$TESTS/concurrency.sh"
echo 'LOCAL_POSTGRES_REHEARSAL_PASS (not a hosted Supabase verification)'
