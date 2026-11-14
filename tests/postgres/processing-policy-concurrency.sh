#!/usr/bin/env bash
# Two stale owner decisions race in a disposable local database only.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
workspace=11111111-1111-4111-8111-111111111111
actor=22222222-2222-4222-8222-222222222222
version=$(psql -X -At -v ON_ERROR_STOP=1 -c "select policy_version from public.workspace_provider_policies where workspace_id='$workspace' and provider_id='gemini'")
audits=$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from public.audit_events where workspace_id='$workspace' and action like 'provider.policy.%'")
logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT
run_decision() {
  psql -X -v ON_ERROR_STOP=1 -c "begin; set request.jwt.claim.role='service_role'; select public.nexus_workspace_processing_policy('$workspace','$actor','$1',repeat('c',64),$version); select pg_sleep(0.3); commit;" >"$logs/$1" 2>&1
}
set +e
run_decision approve & first=$!
run_decision revoke & second=$!
wait "$first"; first_status=$?
wait "$second"; second_status=$?
set -e
if [[ "$first_status" == 0 && "$second_status" != 0 ]]; then
  grep -q 'NR:VERSION_CONFLICT' "$logs/revoke"
elif [[ "$second_status" == 0 && "$first_status" != 0 ]]; then
  grep -q 'NR:VERSION_CONFLICT' "$logs/approve"
else
  echo 'Concurrent owner decisions did not fail closed'; cat "$logs/approve" "$logs/revoke"; exit 1
fi
new_version=$(psql -X -At -v ON_ERROR_STOP=1 -c "select policy_version from public.workspace_provider_policies where workspace_id='$workspace' and provider_id='gemini'")
new_audits=$(psql -X -At -v ON_ERROR_STOP=1 -c "select count(*) from public.audit_events where workspace_id='$workspace' and action like 'provider.policy.%'")
test "$new_version" -eq "$((version+1))"
test "$new_audits" -eq "$((audits+1))"
echo 'CONCURRENT_OWNER_DECISIONS_PASS (one commit, one version conflict, one audit)'
