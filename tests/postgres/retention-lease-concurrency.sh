#!/usr/bin/env bash
# Disposable fixture only. Same-claim concurrency and post-lock expiry.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
w=11111111-1111-4111-8111-111111111111
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -c "insert into public.workspace_settings(workspace_id,retention_enabled,retention_days,retention_lease_owner,retention_lease_expires_at) values('$w',true,30,'synthetic-race',clock_timestamp()+interval '60 seconds') on conflict(workspace_id) do update set retention_enabled=true,retention_days=30,retention_lease_owner='synthetic-race',retention_lease_expires_at=excluded.retention_lease_expires_at;"
e=$(psql -X -At -v ON_ERROR_STOP=1 -c "select retention_lease_expires_at from public.workspace_settings where workspace_id='$w'")
run_finish() { psql -X -At -v ON_ERROR_STOP=1 -c "set request.jwt.claim.role='service_role'; select public.finish_retention_claim('$w','synthetic-race','$e',30,$1)" | grep -E '^(t|f)$' >"$logs/$1"; }
run_finish true & a=$!
run_finish false & b=$!
wait "$a";wait "$b"
test "$(cat "$logs/true" "$logs/false" | grep -c '^t$')" -eq 1
test "$(cat "$logs/true" "$logs/false" | grep -c '^f$')" -eq 1
# A function waiting behind a row lock must use actual time after acquisition.
psql -X -q -v ON_ERROR_STOP=1 -c "update public.workspace_settings set retention_lease_owner='synthetic-race',retention_lease_expires_at=clock_timestamp()+interval '2 seconds' where workspace_id='$w'"
e=$(psql -X -At -v ON_ERROR_STOP=1 -c "select retention_lease_expires_at from public.workspace_settings where workspace_id='$w'")
psql -X -q -v ON_ERROR_STOP=1 -c "begin;set application_name='nexusrag_retention_fixture_lock';select 1 from public.workspace_settings where workspace_id='$w' for update;select pg_sleep(3);commit" >"$logs/lock" & lock=$!
# Confirm row lock acquisition through this fixture connection's sleep state.
ready=0
for attempt in $(seq 1 100); do
  if [[ "$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_stat_activity where datname=current_database() and application_name='nexusrag_retention_fixture_lock' and wait_event='PgSleep'")" == 1 ]]; then ready=1;break;fi
  sleep 0.01
done
test "$ready" -eq 1
run_finish true & waiter=$!
wait "$lock"; wait "$waiter"
test "$(cat "$logs/true")" = f
# Cleanup only the synthetic schedule row created by this disposable harness.
psql -X -q -v ON_ERROR_STOP=1 -c "delete from public.workspace_settings where workspace_id='$w'"
echo 'POSTGRES_RETENTION_CONCURRENT_FENCE_PASS (one completion; stale post-lock write denied)'
