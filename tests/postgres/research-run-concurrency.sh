#!/usr/bin/env bash
# Ordinary double-submit and duplicate queue delivery against disposable fixtures.
set -euo pipefail
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGDATABASE:?}"
logs=$(mktemp -d)
trap 'rm -rf -- "$logs"' EXIT
PSQL=(psql -X -qAt -v ON_ERROR_STOP=1)
"${PSQL[@]}" <<'SQL'
set request.jwt.claim.role='service_role';
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status)
values('d0290000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','concurrent-run.txt','concurrent-run.txt','ready');
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
values('d0290000-0000-4000-8000-000000000012','11111111-1111-4111-8111-111111111111','d0290000-0000-4000-8000-000000000011','documents','concurrent-run',repeat('a',64),1,now(),
'synthetic','synthetic',1,'ready','concurrent-generation','non_sensitive','22222222-2222-4222-8222-222222222222',now());
update public.documents set active_version_id='d0290000-0000-4000-8000-000000000012' where id='d0290000-0000-4000-8000-000000000011';
insert into public.research_plans(workspace_id,owner_id,plan_id,plan,limits,idempotency_key,payload_hash)
select workspace_id,owner_id,'concurrent-run',plan||'{"plan_id":"concurrent-run","private_source_ids":["d0290000-0000-4000-8000-000000000011"]}',limits,'concurrent-run',repeat('a',64)
from public.research_plans where plan->>'plan_id'='mode-QUICK_LOOKUP';
update public.nexus_account_usage set free_chat_queries=0 where user_id='22222222-2222-4222-8222-222222222222';
SQL
context="jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '30 seconds')"
from="from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111'"
plan="(select id from public.research_plans where plan_id='concurrent-run')"
start="set request.jwt.claim.role='service_role';select public.nexus_research_run($context,'create',$plan,p_key=>'concurrent-start',p_command=>'{\"non_sensitive_attested\":true}')->>'id' $from"
for attempt in one two; do
  "${PSQL[@]}" -c "$start" >"$logs/$attempt" &
  if [[ "$attempt" == one ]]; then a=$!; else b=$!; fi
done
wait "$a";wait "$b"
cmp "$logs/one" "$logs/two"
run=$(cat "$logs/one")
test "$("${PSQL[@]}" -c "select count(*) from public.research_runs where idempotency_key='concurrent-start'")" = 1
test "$("${PSQL[@]}" -c "select free_chat_queries from public.nexus_account_usage where user_id='22222222-2222-4222-8222-222222222222'")" = 1
claim="set request.jwt.claim.role='service_role';select public.nexus_research_step($context,'claim','$run',1,0)->>'claimed' $from"
for attempt in one two; do
  "${PSQL[@]}" -c "$claim" >"$logs/claim-$attempt" &
  if [[ "$attempt" == one ]]; then a=$!; else b=$!; fi
done
wait "$a";wait "$b"
test "$(cat "$logs/claim-one" "$logs/claim-two" | sort | tr '\n' ' ')" = 'false true '
echo 'POSTGRES_RESEARCH_RUN_CONCURRENT_PASS: one run/admission/queue claim across independent connections'
