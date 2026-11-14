\set ON_ERROR_STOP on
set request.jwt.claim.role='service_role';
do $$
declare ctx jsonb; plan_id uuid; command jsonb; receipt jsonb; replay jsonb; page jsonb; next_page jsonb; changed jsonb; n integer;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  select id into strict plan_id from public.research_plans where plan->>'plan_id'='mode-CALCULATION';
  command='{"quantity":{"value":"1.005","unit":"kg","evidence_ids":["source-a"]},"factor":"1000","target_unit":"g","conversion_evidence_id":"factor-a","factor_effective_on":"2026-10-15","precision":2}';
  receipt=public.nexus_research_conversion(ctx,'create',plan_id,command,'ordinary-conversion');
  if receipt->'result'->>'value'<>'1005.00' or receipt->'result'->>'unit'<>'g' or receipt->'result'->>'formula'<>'1.005*1000'
    or receipt->'input'<>command or receipt->'result'->'evidence_ids'<>'["source-a","factor-a"]'::jsonb then raise exception 'Stored conversion/lineage lost'; end if;
  replay=public.nexus_research_conversion(ctx,'create',plan_id,command,'ordinary-conversion');
  if replay<>receipt then raise exception 'Retry did not recover exact conversion'; end if;
  if public.nexus_research_conversion(ctx,'list',plan_id)->'items'->0<>receipt then raise exception 'Reload lost conversion'; end if;
  if exists(select 1 from jsonb_array_elements(public.nexus_research_calculation(ctx,'list',plan_id)->'items') r where r->>'id'=receipt->>'id')
    or exists(select 1 from jsonb_array_elements(public.nexus_research_aggregation(ctx,'list',plan_id)->'items') r where r->>'id'=receipt->>'id') then raise exception 'Conversion changed existing list contracts'; end if;
  begin
    perform public.nexus_research_conversion(ctx,'create',plan_id,jsonb_set(command,'{factor_effective_on}','"2026-10-14"'),'ordinary-conversion');
    raise exception 'Retry changed factor date';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
  foreach changed in array array[jsonb_set(command,'{factor}','"0"'),jsonb_set(command,'{factor}','"-1"'),jsonb_set(command,'{factor_effective_on}','"2026-02-30"'),
    jsonb_set(command,'{quantity,value}','1'),jsonb_set(command,'{conversion_evidence_id}','""')] loop
    begin
      perform public.nexus_research_conversion(ctx,'create',plan_id,changed,'invalid-conversion');raise exception 'Invalid conversion was saved';
    exception when others then if sqlerrm not in('NR:INVALID_SCOPE','NR:CALCULATION_INVALID') then raise; end if; end;
  end loop;
  changed=jsonb_set(jsonb_set(command,'{factor}','"1"'),'{factor_effective_on}','null');
  if public.nexus_calculate_conversion(changed)->>'value'<>'1.00' then raise exception 'Half-even/null-date conversion failed'; end if;
  for n in 1..3 loop perform public.nexus_research_conversion(ctx,'create',plan_id,command,'conversion-page-'||n); end loop;
  page=public.nexus_research_conversion(ctx,'list',plan_id,null,null,2);
  next_page=public.nexus_research_conversion(ctx,'list',plan_id,null,null,2,(page->>'next_after')::uuid);
  if jsonb_array_length(page->'items')<>2 or jsonb_array_length(next_page->'items')<>2 or next_page->>'next_after' is not null
    or exists(select 1 from jsonb_array_elements(page->'items') a cross join jsonb_array_elements(next_page->'items') b where a->>'id'=b->>'id') then raise exception 'Conversion paging lost/repeated records'; end if;
end; $$;
select 'RESEARCH_CONVERSION_SQL_PASS: exact factor/target units/date/references/half-even/retry/conflict/paging/legacy compatibility';

begin;
do $$
declare ctx jsonb; saved public.research_calculations%rowtype; n integer; replay jsonb;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id
    where w.id='11111111-1111-4111-8111-111111111111';
  select * into strict saved from public.research_calculations where idempotency_key='ordinary-conversion';
  select count(*) into n from public.research_calculations where plan_id=saved.plan_id;
  for n in n..99 loop perform public.nexus_research_conversion(ctx,'create',saved.plan_id,saved.input,'conversion-cap-'||n); end loop;
  begin
    perform public.nexus_research_conversion(ctx,'create',saved.plan_id,saved.input,'conversion-cap-over');raise exception 'Shared cap ignored';
  exception when others then if sqlerrm<>'NR:TENANT_QUOTA_EXCEEDED' then raise; end if; end;
  replay=public.nexus_research_conversion(ctx,'create',saved.plan_id,saved.input,'ordinary-conversion');
  if replay->>'id'<>saved.id::text or (select count(*) from public.research_calculations where plan_id=saved.plan_id)<>100 then raise exception 'Replay at shared cap failed'; end if;
end; $$;
rollback;
select 'RESEARCH_CONVERSION_SHARED_CAPACITY_PASS: all kinds share cap; immutable replay succeeds at capacity';
