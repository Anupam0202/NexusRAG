\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb; plan_id uuid; command jsonb; receipt jsonb; replay jsonb; result jsonb; changed jsonb; n integer; operation text;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  select id into strict plan_id from public.research_plans where plan->>'plan_id'='mode-CALCULATION';
  command='{"operation":"AVERAGE","values":[{"value":"0.1","unit":"USD","evidence_ids":["a"]},{"value":"0.2","unit":"USD","evidence_ids":["b"]}],"weights":[],"precision":2,"missing_value_treatment":"REJECT","grouped":false}';
  receipt=public.nexus_research_aggregation(ctx,'create',plan_id,command,'ordinary-aggregate');
  if receipt->'result'->'groups'->0->>'value'<>'0.15' or receipt->>'schema_version'<>'research-aggregation/1'
    or receipt->'input'<>command then raise exception 'Aggregate result/input was lost'; end if;
  replay=public.nexus_research_aggregation(ctx,'create',plan_id,command,'ordinary-aggregate');
  if replay->>'id'<>receipt->>'id' then raise exception 'Repeated aggregate created duplicate'; end if;
  if public.nexus_research_aggregation(ctx,'list',plan_id)->'items'->0<>receipt then raise exception 'Aggregate reload did not preserve result'; end if;
  if exists(select 1 from jsonb_array_elements(public.nexus_research_calculation(ctx,'list',plan_id)->'items') row
    where row->>'id'=receipt->>'id' or row ? 'calculation_kind') then raise exception 'Legacy binary contract changed'; end if;
  select count(*) into n from public.research_calculations;
  begin
    perform public.nexus_research_aggregation(ctx,'create',plan_id,jsonb_set(command,'{precision}','3'),'ordinary-aggregate');
    raise exception 'Changed aggregate retry overwrote record';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
  foreach operation in array array['SUM','COUNT','AVERAGE','MEDIAN','MINIMUM','MAXIMUM','WEIGHTED_AVERAGE','RANK','DESCRIPTIVE_STATISTICS'] loop
    changed=jsonb_set(command,'{operation}',to_jsonb(operation));
    if operation='WEIGHTED_AVERAGE' then changed=jsonb_set(changed,'{weights}','["1","3"]'); end if;
    result=public.nexus_calculate_aggregation(changed);
    if result->>'operation'<>operation or jsonb_array_length(result->'groups')<>1 then raise exception 'Missing aggregate operation %',operation; end if;
    if operation='SUM' and result->'groups'->0->>'value'<>'0.30' then raise exception 'Exact sum failed'; end if;
    if operation='WEIGHTED_AVERAGE' and result->'groups'->0->>'value'<>'0.18' then raise exception 'Weighted half-even failed: %',result; end if;
    if operation='RANK' and (result->'groups'->0->'rows'->0->>'input_index'<>'1' or result->'groups'->0->>'value_display'<>'INPUT_VALUES_UNROUNDED') then raise exception 'Rank lost source index/unrounded value'; end if;
    if operation='DESCRIPTIVE_STATISTICS' and (jsonb_array_length(result->'groups'->0->'rows')<>5 or result->'groups'->0->'rows'->3->>'value'<>'0.15') then raise exception 'Statistics failed'; end if;
  end loop;
  changed=jsonb_set(command,'{values}', '[{"value":"1","unit":"USD","evidence_ids":["a"],"group":"A"},{"value":null,"unit":"USD","evidence_ids":["missing"],"group":"A"},{"value":"3","unit":"kg","evidence_ids":["b"],"group":"B"}]');
  changed=changed||'{"grouped":true,"missing_value_treatment":"EXCLUDE"}';
  result=public.nexus_calculate_aggregation(changed);
  if jsonb_array_length(result->'groups')<>2 or result->'groups'->0->>'value'<>'1.00' or result->'groups'->0->>'excluded_count'<>'1'
    or result->'groups'->0->'excluded_input_indices'<>'[1]'::jsonb or result->'groups'->1->>'unit'<>'kg' then raise exception 'Group/exclusion lineage failed: %',result; end if;
  begin
    perform public.nexus_calculate_aggregation(jsonb_set(changed,'{missing_value_treatment}','"REJECT"'));
    raise exception 'Missing value was silently accepted';
  exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  begin
    perform public.nexus_calculate_aggregation(jsonb_set(jsonb_set(command,'{operation}','"WEIGHTED_AVERAGE"'),'{weights}','["0","0"]'));
    raise exception 'Zero total weight was accepted';
  exception when others then if sqlerrm<>'NR:CALCULATION_INVALID' then raise; end if; end;
  if (select count(*) from public.research_calculations)<>n then raise exception 'Rejected aggregate left a row'; end if;
end; $$;
select 'RESEARCH_AGGREGATION_SQL_PASS: nine operations/decimal/groups/exclusion/weights/rank/statistics/retry/reload/binary compatibility';

-- Capacity rehearsal is rolled back; retained fixtures stay small for recovery.
begin;
do $$
declare ctx jsonb; saved public.research_calculations%rowtype; page jsonb; second_page jsonb; first_id text; n integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  select * into strict saved from public.research_calculations where idempotency_key='ordinary-aggregate';
  for n in 1..3 loop perform public.nexus_research_aggregation(ctx,'create',saved.plan_id,saved.input,'page-'||n); end loop;
  page=public.nexus_research_aggregation(ctx,'list',saved.plan_id,null,null,2);
  second_page=public.nexus_research_aggregation(ctx,'list',saved.plan_id,null,null,2,(page->>'next_after')::uuid);
  if jsonb_array_length(page->'items')<>2 or jsonb_array_length(second_page->'items')<>2 or second_page->>'next_after' is not null
    or exists(select 1 from jsonb_array_elements(page->'items') a cross join jsonb_array_elements(second_page->'items') b where a->>'id'=b->>'id')
    then raise exception 'Aggregate cursor skipped, repeated or lost a row'; end if;
  select count(*) into n from public.research_calculations where plan_id=saved.plan_id;
  for n in n..99 loop perform public.nexus_research_aggregation(ctx,'create',saved.plan_id,saved.input,'capacity-'||n); end loop;
  begin
    perform public.nexus_research_aggregation(ctx,'create',saved.plan_id,saved.input,'capacity-over');raise exception 'Capacity overflow was saved';
  exception when others then if sqlerrm<>'NR:TENANT_QUOTA_EXCEEDED' then raise; end if; end;
  first_id=public.nexus_research_aggregation(ctx,'create',saved.plan_id,saved.input,'ordinary-aggregate')->>'id';
  if first_id<>saved.id::text or (select count(*) from public.research_calculations where plan_id=saved.plan_id)<>100 then
    raise exception 'At-capacity retry failed or changed count'; end if;
end; $$;
rollback;
select 'RESEARCH_AGGREGATION_PAGING_CAPACITY_PASS: cursor pages are complete/disjoint; binary/aggregate shared cap; retry at capacity';
