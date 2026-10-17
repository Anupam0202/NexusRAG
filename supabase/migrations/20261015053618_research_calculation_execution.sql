-- Exact binary calculation execution and immutable receipts; no provider/job admission.
create table public.research_calculations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.research_plans(id) on delete cascade,
  input jsonb not null check (octet_length(input::text)<=40000),
  result jsonb not null,
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,owner_id,idempotency_key)
);
create index research_calculation_plan_page on public.research_calculations(workspace_id,owner_id,plan_id,created_at desc,id desc);
alter table public.research_calculations enable row level security;
revoke all on public.research_calculations from public,anon,authenticated;
grant select,insert,update,delete on public.research_calculations to service_role;

create function public.nexus_calculate_binary(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare
  side text; quantity jsonb; reference jsonb; raw text; mantissa text; exp_value integer;
  op text=p_input->>'operation'; places integer; left_value numeric; right_value numeric;
  left_unit text; right_unit text; output_unit text; numerator numeric; denominator numeric=1;
  scaled numeric; whole numeric; remainder numeric; result_value text; formula text; refs jsonb;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000
    or op is null or op not in('ADD','SUBTRACT','MULTIPLY','DIVIDE','PERCENT_CHANGE','RATIO','DIFFERENCE')
    or jsonb_typeof(p_input->'precision') is distinct from 'number' or (p_input->>'precision')!~'^[0-9]{1,2}$'
    then raise exception 'NR:INVALID_SCOPE'; end if;
  places=(p_input->>'precision')::integer;
  if places not between 0 and 18 then raise exception 'NR:INVALID_SCOPE'; end if;
  foreach side in array array['left','right'] loop
    quantity=p_input->side; raw=quantity->>'value';
    if jsonb_typeof(quantity) is distinct from 'object' or jsonb_typeof(quantity->'value') is distinct from 'string'
      or length(raw)>270 or raw!~'^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$'
      or jsonb_typeof(quantity->'unit') is distinct from 'string' or length(btrim(quantity->>'unit')) not between 1 and 64
      or jsonb_typeof(quantity->'evidence_ids') is distinct from 'array' then raise exception 'NR:INVALID_SCOPE'; end if;
    mantissa=split_part(lower(raw),'e',1);
    exp_value=case when lower(raw) like '%e%' then split_part(lower(raw),'e',2)::integer else 0 end;
    if length(regexp_replace(mantissa,'[^0-9]','','g'))>128 or abs(exp_value)>128
      or abs(raw::numeric)>=1e129::numeric or (raw::numeric<>0 and abs(raw::numeric)<1e-128::numeric)
      or jsonb_array_length(quantity->'evidence_ids') not between 1 and 100 then raise exception 'NR:INVALID_SCOPE'; end if;
    for reference in select value from jsonb_array_elements(quantity->'evidence_ids') loop
      if jsonb_typeof(reference) is distinct from 'string' or length(btrim(reference#>>'{}')) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
  end loop;
  left_value=(p_input->'left'->>'value')::numeric; right_value=(p_input->'right'->>'value')::numeric;
  left_unit=p_input->'left'->>'unit'; right_unit=p_input->'right'->>'unit';
  if op in('ADD','SUBTRACT','DIFFERENCE','PERCENT_CHANGE') and left_unit<>right_unit then raise exception 'NR:CALCULATION_INVALID'; end if;
  output_unit=left_unit;
  case op
    when 'ADD' then numerator=left_value+right_value; formula=(p_input->'left'->>'value')||'+'||(p_input->'right'->>'value');
    when 'SUBTRACT','DIFFERENCE' then numerator=left_value-right_value; formula=(p_input->'left'->>'value')||'-'||(p_input->'right'->>'value');
    when 'MULTIPLY' then numerator=left_value*right_value; output_unit=left_unit||'*'||right_unit; formula=(p_input->'left'->>'value')||'*'||(p_input->'right'->>'value');
    when 'DIVIDE','RATIO' then numerator=left_value; denominator=right_value; output_unit=left_unit||'/'||right_unit; formula=(p_input->'left'->>'value')||'/'||(p_input->'right'->>'value');
    when 'PERCENT_CHANGE' then numerator=(right_value-left_value)*100; denominator=left_value; output_unit='%';
      formula='(('||(p_input->'right'->>'value')||'-'||(p_input->'left'->>'value')||')/'||(p_input->'left'->>'value')||')*100';
  end case;
  if denominator=0 then raise exception 'NR:CALCULATION_INVALID'; end if;
  -- Integer quotient/remainder rounds the exact rational, never a floating approximation.
  scaled=abs(numerator)*power(10::numeric,places); whole=div(scaled,abs(denominator)); remainder=mod(scaled,abs(denominator));
  if remainder*2>abs(denominator) or (remainder*2=abs(denominator) and mod(whole,2)=1) then whole=whole+1; end if;
  if sign(numerator)*sign(denominator)<0 then whole=-whole; end if;
  result_value=round(whole*power(10::numeric,-places),places)::text;
  select jsonb_agg(value order by first_position) into refs from (
    select value,min(position) first_position from jsonb_array_elements((p_input->'left'->'evidence_ids')||(p_input->'right'->'evidence_ids')) with ordinality as r(value,position) group by value
  ) ordered;
  return jsonb_build_object('operation',op,'value',result_value,'unit',output_unit,'formula',formula,
    'evidence_ids',refs,'precision',places,'rounding','ROUND_HALF_EVEN');
end; $$;

create function public.nexus_research_calculation_view(p_row public.research_calculations)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select (to_jsonb(p_row)-'idempotency_key'-'payload_hash')||jsonb_build_object('schema_version','research-calculation/1',
    'persistence_state','PERSISTED','state','calculated','input_evidence_state','CALLER_ASSERTED_NOT_VERIFIED');
$$;

create function public.nexus_research_calculation(p_context jsonb,p_operation text,p_plan_id uuid,p_input jsonb default null,p_key text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  plan public.research_plans%rowtype; stored public.research_calculations%rowtype; output jsonb; request_hash text;
begin
  if p_operation='create' then perform 1 from public.workspaces where id=ws for update; end if;
  perform public.workbench_authorize(p_context,case when p_operation='create' then 'document.mutate' else 'read' end);
  select * into plan from public.research_plans where id=p_plan_id and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if plan.plan->>'mode'<>'CALCULATION' then raise exception 'NR:CALCULATION_MODE_REQUIRED'; end if;
  if p_operation='list' then
    select coalesce(jsonb_agg(public.nexus_research_calculation_view(r) order by r.created_at desc,r.id desc),'[]') into output
      from public.research_calculations r where r.workspace_id=ws and r.owner_id=actor and r.plan_id=p_plan_id;
    return jsonb_build_object('items',output,'schema_version','research-calculation/1');
  elsif p_operation is distinct from 'create' or p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
  output=public.nexus_calculate_binary(p_input);
  request_hash=encode(sha256(convert_to(p_plan_id::text||p_input::text,'UTF8')),'hex');
  select * into stored from public.research_calculations where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if stored.payload_hash<>request_hash then raise exception 'NR:VERSION_CONFLICT'; end if;
    return public.nexus_research_calculation_view(stored);
  end if;
  if (select count(*)>=100 from public.research_calculations where plan_id=p_plan_id)
    or (select count(*)>=1000 or coalesce(sum(octet_length(input::text)+octet_length(result::text)),0)+octet_length(p_input::text)+octet_length(output::text)>10485760
      from public.research_calculations where workspace_id=ws) then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  insert into public.research_calculations(workspace_id,owner_id,plan_id,input,result,idempotency_key,payload_hash)
    values(ws,actor,p_plan_id,p_input,output,p_key,request_hash) returning * into stored;
  return public.nexus_research_calculation_view(stored);
end; $$;
revoke all on function public.nexus_calculate_binary(jsonb),public.nexus_research_calculation_view(public.research_calculations),
  public.nexus_research_calculation(jsonb,text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.nexus_calculate_binary(jsonb),public.nexus_research_calculation_view(public.research_calculations),
  public.nexus_research_calculation(jsonb,text,uuid,jsonb,text) to service_role;
