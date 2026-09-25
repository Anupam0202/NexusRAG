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
# Reproduce the production schema after intentional reindex support in migration 026.
"${PSQL[@]}" -f "$ROOT/supabase/migrations/026_allow_reindex_original_reuse.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/027_metered_operation_admission.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/028_resumable_chunk_staging.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/029_durable_extraction_staging.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/030_non_sensitive_gemini_policy_gate.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/031_harden_extraction_storage_privileges.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/032_account_trial_and_user_gemini_keys.sql"
"${PSQL[@]}" -f "$ROOT/supabase/migrations/033_explicit_deny_account_trial_tables.sql"
"${PSQL[@]}" -f "$TESTS/fixtures.sql"
"${PSQL[@]}" -f "$TESTS/account-trial-assertions.sql"
"${PSQL[@]}" -f "$TESTS/account-rollback.sql"
"${PSQL[@]}" -f "$TESTS/security-assertions.sql"
"${PSQL[@]}" -f "$TESTS/quota-assertions.sql"
"${PSQL[@]}" -f "$TESTS/storage-fixtures.sql"
"${PSQL[@]}" -f "$TESTS/storage-assertions.sql"
"${PSQL[@]}" -f "$TESTS/extraction-assertions.sql"
"${PSQL[@]}" -f "$TESTS/batch-assertions.sql"
bash "$TESTS/concurrency.sh"
bash "$TESTS/account-concurrency.sh"
echo 'LOCAL_POSTGRES_REHEARSAL_PASS (not a hosted Supabase verification)'
