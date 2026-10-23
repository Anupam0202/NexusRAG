#!/usr/bin/env bash
# Two ordinary retries against the explicitly disposable local fixture.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
logs=$(mktemp -d)
trap 'rm -rf -- "$logs"' EXIT
statement="set request.jwt.claim.role='service_role';select public.nexus_research_plan(jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '30 seconds'),'create',p_plan=>r.plan||'{\"plan_id\":\"concurrent-passport-subject-055\"}',p_key=>'concurrent-passport-subject-055')->>'id' from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id cross join (select plan from public.research_plans where plan_id='passport-subject-055') r where w.id='11111111-1111-4111-8111-111111111111'"
psql -X -qAt -v ON_ERROR_STOP=1 -c "$statement" >"$logs/one" & first=$!
psql -X -qAt -v ON_ERROR_STOP=1 -c "$statement" >"$logs/two" & second=$!
wait "$first"; wait "$second"
test -s "$logs/one"; cmp "$logs/one" "$logs/two"
test "$(psql -X -qAt -v ON_ERROR_STOP=1 -c "select count(*) from public.research_plans where plan_id='concurrent-passport-subject-055'")" = 1
echo 'POSTGRES_PASSPORT_SUBJECT_CONCURRENT_RETRY_PASS (one exact declared identity, no provider execution)'
