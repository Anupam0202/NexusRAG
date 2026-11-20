-- Durable private draft plans. No execution, provider admission or existing data mutation.
create table public.research_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null check (length(btrim(plan_id)) between 1 and 128),
  plan jsonb not null check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 100000),
  limits jsonb not null,
  state text not null default 'planned' check (state = 'planned'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (workspace_id, owner_id, idempotency_key),
  unique (workspace_id, owner_id, plan_id)
);
create index research_plan_owner_page on public.research_plans(workspace_id, owner_id, created_at desc, id desc);
alter table public.research_plans enable row level security;
revoke all on public.research_plans from public, anon, authenticated;
grant select, insert, update, delete on public.research_plans to service_role;

create function public.nexus_research_plan_limits(p_plan jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  caps integer[]; field text; value jsonb; from_date date; to_date date;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or octet_length(p_plan::text)>100000 then raise exception 'NR:INVALID_SCOPE'; end if;
  caps = case p_plan->>'mode'
    when 'QUICK_LOOKUP' then array[1,8,2,30,0]
    when 'EVIDENCE_ANSWER' then array[4,20,4,90,0]
    when 'DEEP_RESEARCH' then array[12,60,8,600,1]
    when 'COMPARE' then array[8,40,6,300,1]
    when 'TIMELINE' then array[8,40,6,300,1]
    when 'CONTRADICTION_ANALYSIS' then array[10,50,8,420,1]
    when 'CALCULATION' then array[6,30,4,180,1]
    when 'OBLIGATION_ANALYSIS' then array[10,50,8,420,1]
    when 'ENTITY_INVESTIGATION' then array[10,50,8,420,1]
    when 'DUE_DILIGENCE' then array[12,60,8,600,1]
    when 'PRODUCT_PASSPORT' then array[12,60,8,600,1]
    when 'PROCUREMENT_RESEARCH' then array[10,50,8,420,1] else null end;
  if caps is null or jsonb_typeof(p_plan->'plan_id') is distinct from 'string' or length(btrim(p_plan->>'plan_id')) not between 1 and 128
    or jsonb_typeof(p_plan->'question') is distinct from 'string' or length(btrim(p_plan->>'question')) not between 1 and 10000 then raise exception 'NR:INVALID_SCOPE'; end if;
  foreach field in array array['subquestions','private_source_ids','public_provider_ids','entity_scope','rights_constraints','expected_calculations','completion_criteria'] loop
    if jsonb_typeof(p_plan->field) is distinct from 'array' then raise exception 'NR:INVALID_SCOPE'; end if;
    for value in select entry from jsonb_array_elements(p_plan->field) as items(entry) loop
      if jsonb_typeof(value) is distinct from 'string' or length(btrim(value#>>'{}')) < 1
        or length(value#>>'{}') > (case when field='subquestions' then 10000 when field in('private_source_ids','public_provider_ids','entity_scope') then 128 else 1000 end) then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
  end loop;
  if jsonb_array_length(p_plan->'subquestions')>caps[1]
    or jsonb_array_length(p_plan->'private_source_ids')+jsonb_array_length(p_plan->'public_provider_ids')>caps[2]
    or jsonb_array_length(p_plan->'entity_scope')>100 or jsonb_array_length(p_plan->'rights_constraints')>100
    or jsonb_array_length(p_plan->'expected_calculations')>50 or jsonb_array_length(p_plan->'completion_criteria') not between 1 and 50
    or (jsonb_array_length(p_plan->'public_provider_ids')>0 and jsonb_array_length(p_plan->'rights_constraints')=0) then raise exception 'NR:INVALID_SCOPE'; end if;
  foreach field in array array['date_from','date_to'] loop
    if p_plan->field is distinct from 'null'::jsonb and (jsonb_typeof(p_plan->field) is distinct from 'string' or (p_plan->>field)!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then raise exception 'NR:INVALID_SCOPE'; end if;
  end loop;
  begin
    from_date=(p_plan->>'date_from')::date; to_date=(p_plan->>'date_to')::date;
  exception when datetime_field_overflow or invalid_datetime_format then raise exception 'NR:INVALID_SCOPE'; end;
  if to_date<from_date or (p_plan->'jurisdiction' is distinct from 'null'::jsonb and (jsonb_typeof(p_plan->'jurisdiction') is distinct from 'string' or length(btrim(p_plan->>'jurisdiction')) not between 1 and 128)) then raise exception 'NR:INVALID_SCOPE'; end if;
  return jsonb_build_object('max_subquestions',caps[1],'max_sources',caps[2],'max_query_variants',caps[3],'max_runtime_seconds',caps[4],'requires_review',caps[5]=1);
end; $$;

create function public.nexus_research_plan_view(p_row public.research_plans)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
  select (to_jsonb(p_row)-'idempotency_key'-'payload_hash') || jsonb_build_object(
    'schema_version','research-plan/1','persistence_state','PERSISTED','execution_supported',false);
$$;

create function public.nexus_research_plan(p_context jsonb, p_operation text, p_id uuid default null,
  p_plan jsonb default null, p_key text default null, p_limit integer default 20, p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  row_value public.research_plans%rowtype; caps jsonb; request_hash text; items jsonb; tail uuid; cursor_row public.research_plans%rowtype;
begin
  if p_operation='create' then
    perform 1 from public.workspaces where id=ws for update;
    perform public.workbench_authorize(p_context,'document.mutate');
    caps=public.nexus_research_plan_limits(p_plan);
    if p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
    request_hash=encode(sha256(convert_to(p_plan::text,'UTF8')),'hex');
    select * into row_value from public.research_plans where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
    if found then
      if row_value.payload_hash<>request_hash then raise exception 'NR:VERSION_CONFLICT'; end if;
      return public.nexus_research_plan_view(row_value);
    end if;
    select * into row_value from public.research_plans where workspace_id=ws and owner_id=actor and plan_id=p_plan->>'plan_id';
    if found then
      if row_value.payload_hash<>request_hash then raise exception 'NR:VERSION_CONFLICT'; end if;
      return public.nexus_research_plan_view(row_value);
    end if;
    if (select count(*)>=1000 or coalesce(sum(octet_length(plan::text)),0)+octet_length(p_plan::text)>10485760 from public.research_plans where workspace_id=ws) then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
    insert into public.research_plans(workspace_id,owner_id,plan_id,plan,limits,idempotency_key,payload_hash)
      values(ws,actor,p_plan->>'plan_id',p_plan,caps,p_key,request_hash) returning * into row_value;
    return public.nexus_research_plan_view(row_value);
  end if;
  perform public.workbench_authorize(p_context,'read');
  if p_operation='read' then
    select * into row_value from public.research_plans where workspace_id=ws and owner_id=actor and id=p_id;
    if not found then raise exception 'NR:NOT_FOUND'; end if;
    return public.nexus_research_plan_view(row_value);
  elsif p_operation='list' then
    if p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE'; end if;
    if p_after is not null then
      select * into cursor_row from public.research_plans where workspace_id=ws and owner_id=actor and id=p_after;
      if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    end if;
    select coalesce(jsonb_agg(public.nexus_research_plan_view(r::public.research_plans) order by r.created_at desc,r.id desc),'[]') into items
      from (select * from public.research_plans where workspace_id=ws and owner_id=actor
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) r;
    if jsonb_array_length(items)>p_limit then items=items-p_limit; tail=(items->(p_limit-1)->>'id')::uuid; end if;
    return jsonb_build_object('items',items,'next_after',tail,'schema_version','research-plan/1');
  end if;
  raise exception 'NR:INVALID_SCOPE';
end; $$;

revoke all on function public.nexus_research_plan_limits(jsonb), public.nexus_research_plan_view(public.research_plans),
  public.nexus_research_plan(jsonb,text,uuid,jsonb,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.nexus_research_plan_limits(jsonb), public.nexus_research_plan_view(public.research_plans),
  public.nexus_research_plan(jsonb,text,uuid,jsonb,text,integer,uuid) to service_role;
