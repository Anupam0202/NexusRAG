#!/usr/bin/env bash
# Independent ordinary retry sessions against a fresh disposable fixture only.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
logs=$(mktemp -d)
trap 'rm -rf -- "$logs"' EXIT
psql -X -q -v ON_ERROR_STOP=1 -c "insert into public.workspace_settings(workspace_id) values('11111111-1111-4111-8111-111111111111') on conflict do nothing"
statement="set request.jwt.claim.role='service_role';select public.nexus_research_plan(jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '30 seconds'),'create',p_plan=>r.plan||'{\"plan_id\":\"concurrent-plan\"}',p_key=>'concurrent-plan')->>'id' from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id cross join (select plan from public.research_plans limit 1) r where w.id='11111111-1111-4111-8111-111111111111'"
for attempt in one two; do
  psql -X -qAt -v ON_ERROR_STOP=1 -c "$statement" >"$logs/$attempt" &
  if [[ "$attempt" == one ]]; then a=$!; else b=$!; fi
done
wait "$a"; wait "$b"
test -s "$logs/one"
cmp "$logs/one" "$logs/two"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.research_plans where plan_id='concurrent-plan'")" = 1
echo 'POSTGRES_RESEARCH_PLAN_CONCURRENT_RETRY_PASS (one stored identity, no provider execution)'
