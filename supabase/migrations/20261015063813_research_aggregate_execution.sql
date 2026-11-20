-- Aggregate results share bounded storage without changing binary v1 receipts.
alter table public.research_calculations add column calculation_kind text not null default 'binary'
  check(calculation_kind in('binary','aggregate'));
create index research_aggregation_plan_page on public.research_calculations(workspace_id,owner_id,plan_id,created_at desc,id desc)
  where calculation_kind='aggregate';

create function public.nexus_research_decimal(p_value jsonb)
returns numeric language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare raw text=p_value#>>'{}'; mantissa text; exponent_value integer;
begin
  if jsonb_typeof(p_value) is distinct from 'string' or length(raw)>270
    or raw!~'^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]{1,3})?$' then raise exception 'NR:INVALID_SCOPE'; end if;
  mantissa=split_part(lower(raw),'e',1);
  exponent_value=case when lower(raw) like '%e%' then split_part(lower(raw),'e',2)::integer else 0 end;
  if length(regexp_replace(mantissa,'[^0-9]','','g'))>128 or abs(exponent_value)>128
    or abs(raw::numeric)>=1e129::numeric or (raw::numeric<>0 and abs(raw::numeric)<1e-128::numeric) then raise exception 'NR:INVALID_SCOPE'; end if;
  return raw::numeric;
end; $$;

create function public.nexus_round_ratio(p_numerator numeric,p_denominator numeric,p_precision integer)
returns text language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare scaled numeric; whole numeric; remainder numeric;
begin
  if p_numerator is null or p_denominator is null or p_denominator=0 or p_precision is null or p_precision not between 0 and 18
    or p_numerator::text in('NaN','Infinity','-Infinity') or p_denominator::text in('NaN','Infinity','-Infinity') then raise exception 'NR:CALCULATION_INVALID'; end if;
  scaled=abs(p_numerator)*power(10::numeric,p_precision);
  whole=div(scaled,abs(p_denominator)); remainder=mod(scaled,abs(p_denominator));
  if remainder*2>abs(p_denominator) or (remainder*2=abs(p_denominator) and mod(whole,2)=1) then whole=whole+1; end if;
  if sign(p_numerator)*sign(p_denominator)<0 then whole=-whole; end if;
  return round(whole*power(10::numeric,-p_precision),p_precision)::text;
end; $$;

create function public.nexus_calculate_aggregation(p_input jsonb)
returns jsonb language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare
  operation text=p_input->>'operation'; policy text=p_input->>'missing_value_treatment'; places integer; grouped boolean;
  quantity jsonb; reference jsonb; group_name text; unit_name text; numbers numeric[]; weights numeric[]; lexemes text[]; weight_lexemes text[];
  numeric_value numeric; weight_value numeric; numerator numeric; denominator numeric; ordered numeric[];
  total_n integer; valid_n integer; source_index bigint; refs jsonb; excluded jsonb; rank_rows jsonb; rows jsonb;
  result_value text; output_unit text; expression text; groups jsonb='[]'; median_n numeric; median_d numeric;
begin
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>40000
    or operation is null or operation not in('SUM','COUNT','AVERAGE','MEDIAN','MINIMUM','MAXIMUM','WEIGHTED_AVERAGE','RANK','DESCRIPTIVE_STATISTICS')
    or policy is null or policy not in('REJECT','EXCLUDE') or jsonb_typeof(p_input->'precision') is distinct from 'number'
    or (p_input->>'precision')!~'^[0-9]{1,2}$' or jsonb_typeof(p_input->'grouped') is distinct from 'boolean'
    or jsonb_typeof(p_input->'values') is distinct from 'array' or jsonb_typeof(p_input->'weights') is distinct from 'array' then raise exception 'NR:INVALID_SCOPE'; end if;
  places=(p_input->>'precision')::integer; grouped=(p_input->>'grouped')::boolean;
  if places not between 0 and 18 or jsonb_array_length(p_input->'values') not between 1 and 10000
    or (operation='WEIGHTED_AVERAGE' and jsonb_array_length(p_input->'weights')<>jsonb_array_length(p_input->'values'))
    or (operation<>'WEIGHTED_AVERAGE' and jsonb_array_length(p_input->'weights')<>0) then raise exception 'NR:INVALID_SCOPE'; end if;
  for quantity,source_index in select value,ordinality-1 from jsonb_array_elements(p_input->'values') with ordinality loop
    if jsonb_typeof(quantity) is distinct from 'object' or jsonb_typeof(quantity->'unit') is distinct from 'string'
      or length(btrim(quantity->>'unit')) not between 1 and 64 or jsonb_typeof(quantity->'evidence_ids') is distinct from 'array' then raise exception 'NR:INVALID_SCOPE'; end if;
    if jsonb_array_length(quantity->'evidence_ids') not between 1 and 100 then raise exception 'NR:INVALID_SCOPE'; end if;
    for reference in select value from jsonb_array_elements(quantity->'evidence_ids') loop
      if jsonb_typeof(reference) is distinct from 'string' or length(btrim(reference#>>'{}')) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
    if grouped then
      if jsonb_typeof(quantity->'group') is distinct from 'string' or length(btrim(quantity->>'group')) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
    elsif quantity ? 'group' then raise exception 'NR:INVALID_SCOPE'; end if;
    if quantity->'value'='null'::jsonb and policy='EXCLUDE' then null;
    else perform public.nexus_research_decimal(quantity->'value'); end if;
    if operation='WEIGHTED_AVERAGE' then
      if public.nexus_research_decimal(p_input->'weights'->source_index::integer)<0 then raise exception 'NR:CALCULATION_INVALID'; end if;
    end if;
  end loop;
  if grouped and (select count(distinct value->>'group') from jsonb_array_elements(p_input->'values'))>100 then raise exception 'NR:INVALID_SCOPE'; end if;

  for group_name in select k from (select distinct case when grouped then value->>'group' else null end k
      from jsonb_array_elements(p_input->'values')) s order by k collate "C" nulls first loop
    numbers='{}'; weights='{}'; lexemes='{}'; weight_lexemes='{}'; refs='[]'; excluded='[]'; rank_rows='[]'; total_n=0; unit_name=null;
    for quantity,source_index in select value,ordinality-1 from jsonb_array_elements(p_input->'values') with ordinality
      where not grouped or value->>'group' is not distinct from group_name loop
      total_n=total_n+1;
      if quantity->'value'='null'::jsonb then excluded=excluded||to_jsonb(source_index); continue; end if;
      numeric_value=public.nexus_research_decimal(quantity->'value');
      if unit_name is not null and unit_name<>quantity->>'unit' then raise exception 'NR:CALCULATION_INVALID'; end if;
      unit_name=quantity->>'unit'; numbers=array_append(numbers,numeric_value); lexemes=array_append(lexemes,quantity->>'value');
      refs=refs||(quantity->'evidence_ids');
      rank_rows=rank_rows||jsonb_build_object('input_index',source_index,'value',quantity->>'value','unit',unit_name,'evidence_ids',quantity->'evidence_ids');
      if operation='WEIGHTED_AVERAGE' then
        weight_value=public.nexus_research_decimal(p_input->'weights'->source_index::integer);
        weights=array_append(weights,weight_value); weight_lexemes=array_append(weight_lexemes,p_input->'weights'->>source_index::integer);
      end if;
    end loop;
    valid_n=cardinality(numbers);
    if valid_n=0 then raise exception 'NR:CALCULATION_INVALID'; end if;
    select array_agg(n order by n) into ordered from unnest(numbers) n;
    median_n=case when valid_n%2=1 then ordered[(valid_n+1)/2] else ordered[valid_n/2]+ordered[valid_n/2+1] end;
    median_d=case when valid_n%2=1 then 1 else 2 end;
    numerator=null; denominator=1; rows='[]'; result_value=null; output_unit=unit_name;
    case operation
      when 'SUM' then select sum(n) into numerator from unnest(numbers) n;
      when 'COUNT' then numerator=valid_n; output_unit='';
      when 'AVERAGE' then select sum(n) into numerator from unnest(numbers) n; denominator=valid_n;
      when 'MINIMUM' then numerator=ordered[1];
      when 'MAXIMUM' then numerator=ordered[valid_n];
      when 'MEDIAN' then numerator=median_n; denominator=median_d;
      when 'WEIGHTED_AVERAGE' then
        select sum(numbers[i]*weights[i]),sum(weights[i]) into numerator,denominator from generate_subscripts(numbers,1) i;
        if denominator=0 then raise exception 'NR:CALCULATION_INVALID'; end if;
      when 'RANK' then
        select jsonb_agg(r||jsonb_build_object('position',pos) order by pos) into rows from (
          select value r,row_number() over(order by (value->>'value')::numeric desc,(value->>'input_index')::integer) pos
          from jsonb_array_elements(rank_rows)) ranked;
      when 'DESCRIPTIVE_STATISTICS' then
        select sum(n) into numerator from unnest(numbers) n;
        rows=jsonb_build_array(jsonb_build_object('key','count','value',valid_n::text,'unit',''),
          jsonb_build_object('key','minimum','value',public.nexus_round_ratio(ordered[1],1,places),'unit',unit_name),
          jsonb_build_object('key','maximum','value',public.nexus_round_ratio(ordered[valid_n],1,places),'unit',unit_name),
          jsonb_build_object('key','average','value',public.nexus_round_ratio(numerator,valid_n,places),'unit',unit_name),
          jsonb_build_object('key','median','value',public.nexus_round_ratio(median_n,median_d,places),'unit',unit_name));
        numerator=null;
    end case;
    if numerator is not null then result_value=public.nexus_round_ratio(numerator,denominator,places); end if;
    select jsonb_agg(value order by first_position) into refs from (
      select value,min(position) first_position from jsonb_array_elements(refs) with ordinality as r(value,position) group by value) ordered_refs;
    expression=lower(operation)||'('||array_to_string(lexemes,',')||
      case when operation='WEIGHTED_AVERAGE' then ';weights='||array_to_string(weight_lexemes,',') else '' end||')';
    groups=groups||jsonb_build_object('group',group_name,'value',result_value,'rows',rows,'unit',output_unit,'expression',expression,
      'evidence_ids',refs,'total_count',total_n,'included_count',valid_n,'excluded_count',total_n-valid_n,'excluded_input_indices',excluded,
      'value_display',case when operation='RANK' then 'INPUT_VALUES_UNROUNDED' else 'ROUND_HALF_EVEN' end);
  end loop;
  if octet_length(groups::text)>128000 then raise exception 'NR:INVALID_SCOPE'; end if;
  return jsonb_build_object('operation',operation,'groups',groups,'precision',places,'rounding','ROUND_HALF_EVEN','missing_value_treatment',policy);
end; $$;

create or replace function public.nexus_research_calculation_view(p_row public.research_calculations)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select (to_jsonb(p_row)-'idempotency_key'-'payload_hash'-'calculation_kind')||jsonb_build_object('schema_version','research-calculation/1',
    'persistence_state','PERSISTED','state','calculated','input_evidence_state','CALLER_ASSERTED_NOT_VERIFIED');
$$;

create or replace function public.nexus_research_calculation(p_context jsonb,p_operation text,p_plan_id uuid,p_input jsonb default null,p_key text default null)
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
      from public.research_calculations r where r.workspace_id=ws and r.owner_id=actor and r.plan_id=p_plan_id and r.calculation_kind='binary';
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

create function public.nexus_research_aggregation_view(p_row public.research_calculations)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select (to_jsonb(p_row)-'idempotency_key'-'payload_hash'-'calculation_kind')||jsonb_build_object('schema_version','research-aggregation/1',
    'persistence_state','PERSISTED','state','calculated','input_evidence_state','CALLER_ASSERTED_NOT_VERIFIED');
$$;

create function public.nexus_research_aggregation(p_context jsonb,p_operation text,p_plan_id uuid,p_input jsonb default null,p_key text default null,
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
      select * into cursor_row from public.research_calculations where id=p_after and workspace_id=ws and owner_id=actor and plan_id=p_plan_id and calculation_kind='aggregate';
      if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    end if;
    select coalesce(jsonb_agg(public.nexus_research_aggregation_view(r::public.research_calculations) order by r.created_at desc,r.id desc),'[]') into output
      from (select * from public.research_calculations where workspace_id=ws and owner_id=actor and plan_id=p_plan_id and calculation_kind='aggregate'
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) r;
    if jsonb_array_length(output)>p_limit then output=output-p_limit; tail=(output->(p_limit-1)->>'id')::uuid; end if;
    return jsonb_build_object('items',output,'next_after',tail,'schema_version','research-aggregation/1');
  elsif p_operation is distinct from 'create' or p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE'; end if;
  output=public.nexus_calculate_aggregation(p_input);
  request_hash=encode(sha256(convert_to('aggregate:'||p_plan_id::text||p_input::text,'UTF8')),'hex');
  select * into stored from public.research_calculations where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if stored.payload_hash<>request_hash or stored.calculation_kind<>'aggregate' then raise exception 'NR:VERSION_CONFLICT'; end if;
    return public.nexus_research_aggregation_view(stored);
  end if;
  if (select count(*)>=100 from public.research_calculations where plan_id=p_plan_id)
    or (select count(*)>=1000 or coalesce(sum(octet_length(input::text)+octet_length(result::text)),0)+octet_length(p_input::text)+octet_length(output::text)>10485760
      from public.research_calculations where workspace_id=ws) then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  insert into public.research_calculations(workspace_id,owner_id,plan_id,input,result,idempotency_key,payload_hash,calculation_kind)
    values(ws,actor,p_plan_id,p_input,output,p_key,request_hash,'aggregate') returning * into stored;
  return public.nexus_research_aggregation_view(stored);
end; $$;

revoke all on function public.nexus_research_decimal(jsonb),public.nexus_round_ratio(numeric,numeric,integer),public.nexus_calculate_aggregation(jsonb),
  public.nexus_research_aggregation_view(public.research_calculations),public.nexus_research_aggregation(jsonb,text,uuid,jsonb,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.nexus_research_decimal(jsonb),public.nexus_round_ratio(numeric,numeric,integer),public.nexus_calculate_aggregation(jsonb),
  public.nexus_research_aggregation_view(public.research_calculations),public.nexus_research_aggregation(jsonb,text,uuid,jsonb,text,integer,uuid) to service_role;
