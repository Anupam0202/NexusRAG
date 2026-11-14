\set ON_ERROR_STOP on
set request.jwt.claim.role = 'service_role';
insert into public.workspace_policy_versions(id,workspace_id,version,policy)
  values('66666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111',1,'{}')
  on conflict(workspace_id,version) do nothing;
insert into public.workspace_settings(workspace_id,active_policy_id,policy_version)
  values('11111111-1111-4111-8111-111111111111','66666666-6666-4666-8666-666666666666',1)
  on conflict(workspace_id) do nothing;
do $$
declare
  ctx jsonb; plan jsonb; receipt jsonb; replay jsonb; page jsonb; next_page jsonb; saved_count integer; mode text;
begin
  select jsonb_build_object('workspace_id',w.id,'user_id','22222222-2222-4222-8222-222222222222',
    'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
    'deadline',clock_timestamp()+interval '5 minutes') into ctx
    from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id='11111111-1111-4111-8111-111111111111';
  plan=jsonb_build_object('plan_id','real-synthetic-plan','mode','QUICK_LOOKUP','question','Synthetic retention question',
    'subquestions','[]'::jsonb,'private_source_ids','["source-one"]'::jsonb,'public_provider_ids','[]'::jsonb,
    'date_from',null,'date_to',null,'jurisdiction',null,'entity_scope','[]'::jsonb,'rights_constraints','[]'::jsonb,
    'expected_calculations','[]'::jsonb,'completion_criteria','["Inspect the source."]'::jsonb);
  receipt=public.nexus_research_plan(ctx,'create',p_plan=>plan,p_key=>'synthetic-plan-one');
  if receipt->>'persistence_state'<>'PERSISTED' or receipt->>'state'<>'planned' or receipt->>'execution_supported'<>'false'
    or receipt->'plan'<>plan then raise exception 'Plan persistence receipt mismatch'; end if;
  replay=public.nexus_research_plan(ctx,'create',p_plan=>plan,p_key=>'synthetic-plan-one');
  if replay->>'id'<>receipt->>'id' then raise exception 'Repeated create made a duplicate'; end if;
  if public.nexus_research_plan(ctx,'read',(receipt->>'id')::uuid)->'plan'<>plan then raise exception 'Read did not recover stored fields'; end if;
  begin
    perform public.nexus_research_plan(ctx,'create',p_plan=>plan||'{"question":"Changed question"}',p_key=>'synthetic-plan-one');
    raise exception 'Changed retry overwrote a saved plan';
  exception when others then if sqlerrm<>'NR:VERSION_CONFLICT' then raise; end if; end;
  foreach mode in array array['QUICK_LOOKUP','EVIDENCE_ANSWER','DEEP_RESEARCH','COMPARE','TIMELINE','CONTRADICTION_ANALYSIS',
    'CALCULATION','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','DUE_DILIGENCE','PRODUCT_PASSPORT','PROCUREMENT_RESEARCH'] loop
    perform public.nexus_research_plan(ctx,'create',p_plan=>plan||jsonb_build_object('mode',mode,'plan_id','mode-'||mode),p_key=>'mode-'||mode);
  end loop;
  page=public.nexus_research_plan(ctx,'list',p_limit=>2);
  next_page=public.nexus_research_plan(ctx,'list',p_limit=>2,p_after=>(page->>'next_after')::uuid);
  if jsonb_array_length(page->'items')<>2 or jsonb_array_length(next_page->'items')<>2
    or page->'items'->0->>'id'=next_page->'items'->0->>'id' then raise exception 'Pagination lost or repeated a plan'; end if;
  select count(*) into saved_count from public.research_plans;
  begin
    perform public.nexus_research_plan(ctx,'create',p_plan=>plan||'{"plan_id":"bad-date","date_from":"2026-02-30"}',p_key=>'bad-date');
    raise exception 'Invalid calendar date persisted';
  exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  if (select count(*) from public.research_plans)<>saved_count then raise exception 'Rejected plan left a row'; end if;
  begin
    insert into public.research_plans(workspace_id,owner_id,plan_id,plan,limits,idempotency_key,payload_hash)
      select '11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','capacity-'||n,
        plan||jsonb_build_object('plan_id','capacity-'||n),public.nexus_research_plan_limits(plan),'capacity-'||n,repeat('a',64)
        from generate_series(1,1000) n;
    perform public.nexus_research_plan(ctx,'create',p_plan=>plan||'{"plan_id":"beyond-capacity"}',p_key=>'beyond-capacity');
    raise exception 'Draft count bound was not enforced';
  exception when others then if sqlerrm<>'NR:TENANT_QUOTA_EXCEEDED' then raise; end if; end;
  if (select count(*) from public.research_plans)<>saved_count then raise exception 'Capacity fixture did not roll back'; end if;
  if exists(select 1 from public.query_runs) or exists(select 1 from public.usage_reservations) or exists(select 1 from public.ingestion_jobs)
    then raise exception 'Planning started execution or reserved processing quota'; end if;
end; $$;
select 'RESEARCH_PLAN_SQL_PASS: persisted/read/retry/conflict/twelve-modes/calendar/paging/capacity; no execution or usage';
