#!/usr/bin/env bash
# Separate sessions against the disposable fixture, never a hosted database.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
w=11111111-1111-4111-8111-111111111111
actor=22222222-2222-4222-8222-222222222222
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -c "update auth.users set email_confirmed_at=clock_timestamp() where id='$actor'; insert into public.workspace_settings(workspace_id,retention_enabled,retention_days,next_retention_at) values('$w',true,30,clock_timestamp()-interval '1 minute') on conflict(workspace_id) do update set retention_enabled=true,retention_days=30,next_retention_at=excluded.next_retention_at;"
claim_manual() {
  psql -X -At -v ON_ERROR_STOP=1 -c "set request.jwt.claim.role='service_role';select public.claim_workspace_retention('$w','$actor','$1',60) is not null" | grep -E '^(t|f)$' >"$logs/$1"
}
for other in manual-two scheduler; do
  psql -X -q -v ON_ERROR_STOP=1 -c "update public.workspace_settings set retention_lease_owner=null,retention_lease_expires_at=null,next_retention_at=clock_timestamp()-interval '1 minute' where workspace_id='$w'"
  claim_manual manual-one & a=$!
  if [[ "$other" == scheduler ]]; then
    psql -X -At -v ON_ERROR_STOP=1 -c "set request.jwt.claim.role='service_role';select exists(select 1 from public.claim_retention_schedules('scheduler',100,60) where workspace_id='$w')" | grep -E '^(t|f)$' >"$logs/$other" & b=$!
  else
    claim_manual "$other" & b=$!
  fi
  wait "$a"; wait "$b"
  test "$(cat "$logs/manual-one" "$logs/$other" | grep -c '^t$')" -eq 1
  test "$(cat "$logs/manual-one" "$logs/$other" | grep -c '^f$')" -eq 1
done
# Only synthetic state in the disposable database is removed.
psql -X -q -v ON_ERROR_STOP=1 -c "delete from public.workspace_settings where workspace_id='$w';update auth.users set email_confirmed_at=null where id='$actor'"
echo 'POSTGRES_MANUAL_RETENTION_CONCURRENT_CLAIM_PASS (one manual/manual or manual/scheduler winner)'
