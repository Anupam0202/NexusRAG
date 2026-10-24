-- Explicit supplied-factor conversions share the existing bounded worksheet store.
alter table public.research_calculations drop constraint research_calculations_calculation_kind_check;
alter table public.research_calculations add constraint research_calculations_calculation_kind_check
  check(calculation_kind in('binary','aggregate','conversion'));
create index research_conversion_plan_page on public.research_calculations(workspace_id,owner_id,plan_id,created_at desc,id desc)
  where calculation_kind='conversion';

create function public.nexus_calculate_conversion(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare quantity jsonb=p_input->'quantity'; reference jsonb; number_value numeric; factor numeric;
  target_unit text=p_input->>'target_unit'; factor_reference text=p_input->>'conversion_evidence_id';
  effective_date text=p_input->>'factor_effective_on'; places integer; refs jsonb;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000
    or jsonb_typeof(quantity) is distinct from 'object' or jsonb_typeof(quantity->'unit') is distinct from 'string'
    or length(btrim(quantity->>'unit')) not between 1 and 64 or jsonb_typeof(quantity->'evidence_ids') is distinct from 'array'
    or jsonb_typeof(p_input->'target_unit') is distinct from 'string' or length(btrim(target_unit)) not between 1 and 64
    or jsonb_typeof(p_input->'conversion_evidence_id') is distinct from 'string' or length(btrim(factor_reference)) not between 1 and 128
    or jsonb_typeof(p_input->'precision') is distinct from 'number' or (p_input->>'precision')!~'^[0-9]{1,2}$'
    then raise exception 'NR:INVALID_SCOPE'; end if;
  places=(p_input->>'precision')::integer;
  if places not between 0 and 18 or jsonb_array_length(quantity->'evidence_ids') not between 1 and 100 then raise exception 'NR:INVALID_SCOPE'; end if;
  for reference in select value from jsonb_array_elements(quantity->'evidence_ids') loop
    if jsonb_typeof(reference) is distinct from 'string' or length(btrim(reference#>>'{}')) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
  end loop;
  if p_input->'factor_effective_on' is distinct from 'null'::jsonb then
    if jsonb_typeof(p_input->'factor_effective_on') is distinct from 'string' or effective_date!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then raise exception 'NR:INVALID_SCOPE'; end if;
    begin perform effective_date::date;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'NR:INVALID_SCOPE'; end;
  end if;
  number_value=public.nexus_research_decimal(quantity->'value');factor=public.nexus_research_decimal(p_input->'factor');
  if factor<=0 then raise exception 'NR:CALCULATION_INVALID'; end if;
  select jsonb_agg(value order by first_position) into refs from (
    select value,min(position) first_position from jsonb_array_elements((quantity->'evidence_ids')||to_jsonb(factor_reference)) with ordinality r(value,position) group by value) ordered_refs;
  return jsonb_build_object('operation','CONVERT_UNIT','value',public.nexus_round_ratio(number_value*factor,1,places),'unit',target_unit,
    'formula',(quantity->>'value')||'*'||(p_input->>'factor'),'evidence_ids',refs,'precision',places,'rounding','ROUND_HALF_EVEN');
end; $$;

create function public.nexus_research_conversion_view(p_row public.research_calculations)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select (to_jsonb(p_row)-'idempotency_key'-'payload_hash'-'calculation_kind')||jsonb_build_object('schema_version','research-conversion/1',
    'persistence_state','PERSISTED','state','calculated','input_evidence_state','CALLER_ASSERTED_NOT_VERIFIED');
$$;

create function public.nexus_research_conversion(p_context jsonb,p_operation text,p_plan_id uuid,p_input jsonb default null,p_key text default null,
  p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  plan public.research_plans%rowtype; stored public.research_calculations%rowtype; cursor_row public.research_calculations%rowtype;
  output jsonb; request_hash text; tail uuid;
begin
  if p_operation='create' then perform 1 from public.workspaces where id=ws for update; end if;
  perform public.workbench_authorize(p_context,case when p_operation='create' then 'document.mutate' else 'read' end);
  select * into plan from public.research_plans where id=p_plan_id and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if plan.plan->>'mode'<>'CALCULATION' then raise exception 'NR:CALCULATION_MODE_REQUIRED'; end if;
  if p_operation='list' then
    if p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE'; end if;
    if p_after is not null then
      select * into cursor_row from public.research_calculations where id=p_after and workspace_id=ws and owner_id=actor and plan_id=p_plan_id and calculation_kind='conversion';
      if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    end if;
    select coalesce(jsonb_agg(public.nexus_research_conversion_view(r::public.research_calculations) order by r.created_at desc,r.id desc),'[]') into output
      from (select * from public.research_calculations where workspace_id=ws and owner_id=actor and plan_id=p_plan_id and calculation_kind='conversion'
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) r;
    if jsonb_array_length(output)>p_limit then output=output-p_limit; tail=(output->(p_limit-1)->>'id')::uuid; end if;
    return jsonb_build_object('items',output,'next_after',tail,'schema_version','research-conversion/1');
  elsif p_operation is distinct from 'create' or p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
  output=public.nexus_calculate_conversion(p_input);
  request_hash=encode(sha256(convert_to('conversion:'||p_plan_id::text||p_input::text,'UTF8')),'hex');
  select * into stored from public.research_calculations where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if stored.payload_hash<>request_hash or stored.calculation_kind<>'conversion' then raise exception 'NR:VERSION_CONFLICT'; end if;
    return public.nexus_research_conversion_view(stored);
  end if;
  if (select count(*)>=100 from public.research_calculations where plan_id=p_plan_id)
    or (select count(*)>=1000 or coalesce(sum(octet_length(input::text)+octet_length(result::text)),0)+octet_length(p_input::text)+octet_length(output::text)>10485760
      from public.research_calculations where workspace_id=ws) then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  insert into public.research_calculations(workspace_id,owner_id,plan_id,input,result,idempotency_key,payload_hash,calculation_kind)
    values(ws,actor,p_plan_id,p_input,output,p_key,request_hash,'conversion') returning * into stored;
  return public.nexus_research_conversion_view(stored);
end; $$;

revoke all on function public.nexus_calculate_conversion(jsonb),public.nexus_research_conversion_view(public.research_calculations),
  public.nexus_research_conversion(jsonb,text,uuid,jsonb,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.nexus_calculate_conversion(jsonb),public.nexus_research_conversion_view(public.research_calculations),
  public.nexus_research_conversion(jsonb,text,uuid,jsonb,text,integer,uuid) to service_role;
