-- Private selected-source answer runs. Installation starts no jobs or processing.
create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.research_plans(id) on delete cascade,
  idempotency_key text not null check(length(idempotency_key) between 1 and 128),
  mode text not null check(mode in ('QUICK_LOOKUP','EVIDENCE_ANSWER')),
  questions jsonb not null check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and 5),
  source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='array' and jsonb_array_length(source_snapshot) between 1 and 20),
  results jsonb not null default '[]' check(jsonb_typeof(results)='array' and octet_length(results::text)<=400000),
  position integer not null default 0 check(position between 0 and 5 and position=jsonb_array_length(results)),
  state text not null default 'queued' check(state in ('queued','running','interrupted','completed','cancelled')),
  generation integer not null default 1 check(generation between 1 and 10),
  lease_token uuid,
  deadline timestamptz,
  error_code text check(error_code ~ '^[A-Z_]{1,64}$'),
  admission jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,owner_id,idempotency_key)
);
create index research_runs_owner_page on public.research_runs(workspace_id,owner_id,plan_id,created_at desc,id desc);
create index research_runs_queue on public.research_runs(updated_at) where state='queued';
alter table public.research_runs enable row level security;
revoke all on public.research_runs from public,anon,authenticated;
grant select,insert,update,delete on public.research_runs to service_role;

create function public.nexus_research_sources_current(p_workspace uuid,p_snapshot jsonb)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
  select not exists(select 1 from jsonb_array_elements(p_snapshot) s
    left join public.documents d on d.id=(s->>'document_id')::uuid and d.workspace_id=p_workspace
    left join public.document_versions v on v.id=d.active_version_id and v.workspace_id=p_workspace and v.document_id=d.id
    where d.id is null or d.lifecycle_state<>'active' or v.id is null or v.publication_state<>'ready'
      or v.data_classification<>'non_sensitive' or v.id::text<>s->>'version_id'
      or v.index_generation is distinct from s->>'index_generation'
      or v.lifecycle_epoch::text is distinct from s->>'lifecycle_epoch');
$$;

create function public.nexus_research_run_view(p_row public.research_runs)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare current_source boolean; expired boolean;
begin
  current_source=public.nexus_research_sources_current(p_row.workspace_id,p_row.source_snapshot);
  expired=p_row.state in ('queued','running') and p_row.deadline<=statement_timestamp();
  return (to_jsonb(p_row)-'idempotency_key'-'lease_token')||jsonb_build_object(
    'schema_version','research-run/1','persistence_state','PERSISTED',
    'state',case when expired then 'interrupted' else p_row.state end,
    'error_code',case when expired then 'RUN_DEADLINE' else p_row.error_code end,
    'source_state',case when current_source then 'CURRENT' else 'UNAVAILABLE_OR_CHANGED' end,
    'results',case when current_source then p_row.results else '[]'::jsonb end);
end; $$;

create function public.nexus_research_run(p_context jsonb,p_operation text,p_plan uuid,
  p_id uuid default null,p_key text default null,p_command jsonb default '{}',p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  draft public.research_plans%rowtype; r public.research_runs%rowtype; cursor_row public.research_runs%rowtype;
  snapshot jsonb; entries jsonb; tail uuid; source_id text; sources uuid[]; admission_receipt jsonb;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,case when p_operation in ('create','cancel','resume') then 'document.mutate' else 'read' end);
  select * into draft from public.research_plans where id=p_plan and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if p_operation='create' then
    if p_key is null or length(p_key) not between 1 and 128 or p_command->'non_sensitive_attested' is distinct from 'true'::jsonb then raise exception 'NR:INVALID_SCOPE'; end if;
    select * into r from public.research_runs where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
    if found then
      if r.plan_id<>p_plan then raise exception 'NR:VERSION_CONFLICT'; end if;
      return public.nexus_research_run_view(r);
    end if;
    if draft.plan->>'mode' not in ('QUICK_LOOKUP','EVIDENCE_ANSWER') then raise exception 'NR:MODE_NOT_EXECUTABLE'; end if;
    if jsonb_array_length(draft.plan->'public_provider_ids')>0 or jsonb_array_length(draft.plan->'entity_scope')>0
      or jsonb_array_length(draft.plan->'rights_constraints')>0 or jsonb_array_length(draft.plan->'expected_calculations')>0
      or draft.plan->>'date_from' is not null or draft.plan->>'date_to' is not null or draft.plan->>'jurisdiction' is not null
      then raise exception 'NR:PLAN_CONSTRAINTS_UNSUPPORTED'; end if;
    for source_id in select jsonb_array_elements_text(draft.plan->'private_source_ids') loop
      if source_id!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
    select array_agg(distinct value::uuid) into sources from jsonb_array_elements_text(draft.plan->'private_source_ids');
    if coalesce(cardinality(sources),0)=0 then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    select jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'index_generation',v.index_generation,'lifecycle_epoch',v.lifecycle_epoch) order by d.id)
      into snapshot from public.documents d join public.document_versions v on v.id=d.active_version_id and v.document_id=d.id and v.workspace_id=d.workspace_id
      where d.workspace_id=ws and d.id=any(sources) and d.lifecycle_state='active' and v.publication_state='ready' and v.data_classification='non_sensitive';
    if coalesce(jsonb_array_length(snapshot),0)<>cardinality(sources) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    if (select count(*)>=100 from public.research_runs where workspace_id=ws)
      or (select count(*)>=10 from public.research_runs where plan_id=p_plan) then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
    r.id=gen_random_uuid();
    admission_receipt=public.nexus_admit_account_operation(actor,'chat',r.id);
    if admission_receipt->>'status'<>'READY' then raise exception 'NR:BYOK_REQUIRED'; end if;
    insert into public.research_runs(id,workspace_id,owner_id,plan_id,idempotency_key,mode,questions,source_snapshot,admission,deadline)
      values(r.id,ws,actor,p_plan,p_key,draft.plan->>'mode',jsonb_build_array(draft.plan->>'question')||(draft.plan->'subquestions'),snapshot,admission_receipt,
        clock_timestamp()+make_interval(secs=>case when draft.plan->>'mode'='QUICK_LOOKUP' then 30 else 90 end))
      returning * into r;
    return public.nexus_research_run_view(r);
  elsif p_operation='list' then
    if p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE'; end if;
    if p_after is not null then
      select * into cursor_row from public.research_runs where workspace_id=ws and owner_id=actor and plan_id=p_plan and id=p_after;
      if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    end if;
    select coalesce(jsonb_agg(public.nexus_research_run_view(x::public.research_runs) order by x.created_at desc,x.id desc),'[]') into entries
      from (select * from public.research_runs where workspace_id=ws and owner_id=actor and plan_id=p_plan
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) x;
    if jsonb_array_length(entries)>p_limit then entries=entries-p_limit; tail=(entries->(p_limit-1)->>'id')::uuid; end if;
    return jsonb_build_object('items',entries,'next_after',tail,'schema_version','research-run/1');
  end if;
  select * into r from public.research_runs where id=p_id and workspace_id=ws and owner_id=actor and plan_id=p_plan for update;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if p_operation='cancel' and r.state<>'completed' then
    update public.research_runs set state='cancelled',lease_token=null,error_code='CANCELLED',updated_at=clock_timestamp() where id=r.id returning * into r;
  elsif p_operation='resume' then
    if p_command->'non_sensitive_attested' is distinct from 'true'::jsonb then raise exception 'NR:INVALID_SCOPE'; end if;
    if r.state in ('queued','running') and (r.deadline is null or r.deadline>clock_timestamp()) then return public.nexus_research_run_view(r); end if;
    if r.state='completed' or r.generation>=10 then raise exception 'NR:VERSION_CONFLICT'; end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    update public.research_runs set state='queued',generation=generation+1,deadline=clock_timestamp()+make_interval(secs=>case when mode='QUICK_LOOKUP' then 30 else 90 end),lease_token=null,error_code=null,updated_at=clock_timestamp()
      where id=r.id returning * into r;
  elsif p_operation<>'read' then raise exception 'NR:INVALID_SCOPE'; end if;
  return public.nexus_research_run_view(r);
end; $$;

-- One claimed question per queue delivery. No automatic replay of ambiguous provider work.
create function public.nexus_research_step(p_context jsonb,p_operation text,p_id uuid,p_generation integer,p_position integer,
  p_token uuid default null,p_result jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype; seconds integer;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid
    and owner_id=(p_context->>'user_id')::uuid for update;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if r.generation<>p_generation or r.position<>p_position or r.state not in ('queued','running') then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if r.deadline<=clock_timestamp() or not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then
    update public.research_runs set state='interrupted',lease_token=null,error_code=case when r.deadline<=clock_timestamp() then 'RUN_DEADLINE' else 'SOURCE_UNAVAILABLE' end,
      updated_at=clock_timestamp() where id=r.id returning * into r;
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if p_operation='claim' then
    if r.state='running' then return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r)); end if;
    seconds=case when r.mode='QUICK_LOOKUP' then 30 else 90 end;
    update public.research_runs set state='running',lease_token=gen_random_uuid(),deadline=coalesce(deadline,clock_timestamp()+make_interval(secs=>seconds)),updated_at=clock_timestamp()
      where id=r.id returning * into r;
    return jsonb_build_object('claimed',true,'token',r.lease_token,'run',public.nexus_research_run_view(r));
  end if;
  if r.state<>'running' or p_token is null or r.lease_token is distinct from p_token then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if p_operation='commit' then
    if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>76000
      or p_result->>'question' is distinct from r.questions->>r.position
      or jsonb_typeof(p_result->'answer') is distinct from 'string' or length(p_result->>'answer') not between 1 and 16000
      or coalesce(p_result->>'claim_state','') not in ('REVIEW_REQUIRED','UNSUPPORTED')
      or jsonb_typeof(p_result->'abstained') is distinct from 'boolean'
      or jsonb_typeof(p_result->'validated_citation_ids') is distinct from 'array'
      or p_result->'coverage'->>'completeness' is distinct from 'NOT_EXHAUSTIVE'
      or coalesce(p_result->'coverage'->>'chunks_considered','')!~'^[0-9]{1,3}$'
      or (p_result->'coverage'->>'chunks_considered')::integer>200
      or coalesce(p_result->>'provider_cost_status','') not in ('UNKNOWN','NOT_CALLED')
      or p_result->>'review_state' is distinct from 'COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED'
      or jsonb_typeof(p_result->'sources') is distinct from 'array' or jsonb_array_length(p_result->'sources')>12 then raise exception 'NR:INVALID_SCOPE'; end if;
    update public.research_runs set results=results||jsonb_build_array(p_result),position=position+1,
      state=case when position+1=jsonb_array_length(questions) then 'completed' else 'queued' end,
      lease_token=null,error_code=null,updated_at=clock_timestamp() where id=r.id returning * into r;
  elsif p_operation='interrupt' then
    if p_error is null or p_error!~'^[A-Z_]{1,64}$' then raise exception 'NR:INVALID_SCOPE'; end if;
    update public.research_runs set state='interrupted',lease_token=null,error_code=p_error,updated_at=clock_timestamp() where id=r.id returning * into r;
  else raise exception 'NR:INVALID_SCOPE'; end if;
  return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
end; $$;

revoke all on function public.nexus_research_sources_current(uuid,jsonb),public.nexus_research_run_view(public.research_runs),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.nexus_research_sources_current(uuid,jsonb),public.nexus_research_run_view(public.research_runs),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text) to service_role;
