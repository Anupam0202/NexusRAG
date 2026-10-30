#!/usr/bin/env bash
# Ordinary simultaneous retries on an explicitly disposable synthetic fixture.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
logs=$(mktemp -d)
trap 'rm -rf -- "$logs"' EXIT
statement="set request.jwt.claim.role='service_role';select public.nexus_research_conversion(jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '30 seconds'),'create',r.plan_id,r.input,'concurrent-conversion')->>'id' from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id cross join (select plan_id,input from public.research_calculations where calculation_kind='conversion' limit 1) r where w.id='11111111-1111-4111-8111-111111111111'"
for attempt in one two; do
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$statement" >"$logs/$attempt" &
  if [[ "$attempt" == one ]]; then a=$!; else b=$!; fi
done
wait "$a"; wait "$b";test -s "$logs/one";cmp "$logs/one" "$logs/two"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.research_calculations where idempotency_key='concurrent-conversion'")" = 1
echo 'POSTGRES_RESEARCH_CONVERSION_CONCURRENT_RETRY_PASS (one immutable conversion)'
