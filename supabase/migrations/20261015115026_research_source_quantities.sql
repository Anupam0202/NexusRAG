-- Captured numeric/unit spans are evidence snapshots, not reviewed conclusions.
create table public.research_quantities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.research_plans(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version_id uuid not null references public.document_versions(id) on delete cascade,
  chunk_id uuid not null references public.document_chunks(id) on delete cascade,
  input jsonb not null check(octet_length(input::text)<=4000),
  value text not null, unit text not null,
  idempotency_key text not null check(length(idempotency_key) between 1 and 128),
  payload_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(workspace_id,owner_id,idempotency_key)
);
create index research_quantity_plan_page on public.research_quantities(workspace_id,owner_id,plan_id,created_at desc,id desc);
alter table public.research_quantities enable row level security;
revoke all on public.research_quantities from public,anon,authenticated;
grant select,insert,update,delete on public.research_quantities to service_role;

create function public.nexus_research_quantity_view(p_row public.research_quantities)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare source_text text; filename text; source_location jsonb; page integer; available boolean=false; freshness text='unavailable';
  value_start integer=(p_row.input->'value_span'->>'start')::integer; value_end integer=(p_row.input->'value_span'->>'end')::integer;
  unit_start integer=(p_row.input->'unit_span'->>'start')::integer; unit_end integer=(p_row.input->'unit_span'->>'end')::integer;
begin
  select coalesce(c.original_text,c.content),d.filename,c.location,c.page_number,
    d.lifecycle_state='active' and d.status='ready' and v.publication_state='ready' and v.lifecycle_epoch=d.lifecycle_epoch
      and v.index_generation is not null and c.original_content_hash=p_row.input->>'original_content_hash'
      and encode(sha256(convert_to(coalesce(c.original_text,c.content),'UTF8')),'hex')=c.original_content_hash,
    case when d.active_version_id=p_row.version_id then 'current' else 'stale' end
    into source_text,filename,source_location,page,available,freshness
    from public.document_chunks c join public.documents d on d.workspace_id=c.workspace_id and d.id=c.document_id
    join public.document_versions v on v.workspace_id=c.workspace_id and v.document_id=c.document_id and v.id=c.version_id
    where c.id=p_row.chunk_id and c.workspace_id=p_row.workspace_id and c.document_id=p_row.document_id and c.version_id=p_row.version_id;
  available=coalesce(available,false) and substring(source_text from value_start+1 for value_end-value_start)=p_row.value
    and substring(source_text from unit_start+1 for unit_end-unit_start)=p_row.unit;
  return (to_jsonb(p_row)-'value'-'unit'-'idempotency_key'-'payload_hash')||jsonb_build_object(
    'schema_version','research-quantity/1','persistence_state','PERSISTED','state','captured',
    'source_state',case when available then 'SOURCE_SPANS_MATCHED_REVIEW_REQUIRED' else 'SOURCE_UNAVAILABLE' end,
    'freshness',case when available then freshness else 'unavailable' end,
    'quantity',case when available then jsonb_build_object('value',p_row.value,'unit',p_row.unit,'evidence_ids',jsonb_build_array('urn:nexusrag:quantity:'||p_row.id::text)) end,
    'source',case when available then jsonb_build_object('filename',filename,'page_number',page,'location',source_location,
      'value_context',jsonb_build_object('text',substring(source_text from greatest(0,value_start-60)+1 for value_end-greatest(0,value_start-60)+60),
        'span_start',value_start-greatest(0,value_start-60),'span_end',value_end-greatest(0,value_start-60)),
      'unit_context',jsonb_build_object('text',substring(source_text from greatest(0,unit_start-40)+1 for unit_end-greatest(0,unit_start-40)+40),
        'span_start',unit_start-greatest(0,unit_start-40),'span_end',unit_end-greatest(0,unit_start-40))) end);
end; $$;

create function public.nexus_research_quantity(p_context jsonb,p_operation text,p_plan_id uuid,p_input jsonb default null,p_key text default null,
  p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;
  plan public.research_plans%rowtype;stored public.research_quantities%rowtype;cursor_row public.research_quantities%rowtype;
  document public.documents%rowtype;version public.document_versions%rowtype;chunk public.document_chunks%rowtype;
  output jsonb;request_hash text;tail uuid;field text;edge text;source_text text;raw_value text;raw_unit text;
  value_start integer;value_end integer;unit_start integer;unit_end integer;capture_document_id uuid;capture_version_id uuid;capture_chunk_index integer;
begin
  if p_operation='create' then perform 1 from public.workspaces where id=ws for update;end if;
  perform public.workbench_authorize(p_context,case when p_operation='create' then 'document.mutate' else 'read' end);
  select * into plan from public.research_plans where id=p_plan_id and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if plan.plan->>'mode'<>'CALCULATION' then raise exception 'NR:CALCULATION_MODE_REQUIRED';end if;
  if p_operation='list' then
    if p_limit is null or p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
    if p_after is not null then
      select * into cursor_row from public.research_quantities where id=p_after and workspace_id=ws and owner_id=actor and plan_id=p_plan_id;
      if not found then raise exception 'NR:INVALID_SCOPE';end if;
    end if;
    select coalesce(jsonb_agg(public.nexus_research_quantity_view(r::public.research_quantities) order by r.created_at desc,r.id desc),'[]') into output
      from (select * from public.research_quantities where workspace_id=ws and owner_id=actor and plan_id=p_plan_id
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) r;
    if jsonb_array_length(output)>p_limit then output=output-p_limit;tail=(output->(p_limit-1)->>'id')::uuid;end if;
    return jsonb_build_object('items',output,'next_after',tail,'schema_version','research-quantity/1');
  elsif p_operation is distinct from 'create' or p_key is null or length(p_key) not between 1 and 128 then raise exception 'NR:INVALID_SCOPE';end if;
  if jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>4000
    or jsonb_typeof(p_input->'document_id') is distinct from 'string' or (p_input->>'document_id')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'version_id') is distinct from 'string' or (p_input->>'version_id')!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    or jsonb_typeof(p_input->'original_content_hash') is distinct from 'string' or (p_input->>'original_content_hash')!~'^[0-9a-f]{64}$'
    or jsonb_typeof(p_input->'chunk_index') is distinct from 'number' or (p_input->>'chunk_index')!~'^[0-9]{1,6}$' then raise exception 'NR:INVALID_SCOPE';end if;
  foreach field in array array['value_span','unit_span'] loop
    if jsonb_typeof(p_input->field) is distinct from 'object' then raise exception 'NR:INVALID_SCOPE';end if;
    foreach edge in array array['start','end'] loop
      if jsonb_typeof(p_input->field->edge) is distinct from 'number' or (p_input->field->>edge)!~'^[0-9]{1,7}$'
        or (p_input->field->>edge)::integer>1000000 then raise exception 'NR:INVALID_SCOPE';end if;
    end loop;
  end loop;
  capture_document_id=(p_input->>'document_id')::uuid;capture_version_id=(p_input->>'version_id')::uuid;capture_chunk_index=(p_input->>'chunk_index')::integer;
  value_start=(p_input->'value_span'->>'start')::integer;value_end=(p_input->'value_span'->>'end')::integer;
  unit_start=(p_input->'unit_span'->>'start')::integer;unit_end=(p_input->'unit_span'->>'end')::integer;
  if value_end-value_start not between 1 and 270 or unit_end-unit_start not between 1 and 64
    or (value_start<unit_end and unit_start<value_end) then raise exception 'NR:INVALID_SCOPE';end if;
  request_hash=encode(sha256(convert_to(p_plan_id::text||p_input::text,'UTF8')),'hex');
  select * into stored from public.research_quantities where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if stored.payload_hash<>request_hash then raise exception 'NR:VERSION_CONFLICT';end if;
    return public.nexus_research_quantity_view(stored);
  end if;
  if jsonb_array_length(plan.plan->'private_source_ids')>0 and not exists(
    select 1 from jsonb_array_elements_text(plan.plan->'private_source_ids') source_id where lower(source_id)=capture_document_id::text
  ) then raise exception 'NR:INVALID_SCOPE';end if;
  select * into document from public.documents where id=capture_document_id and workspace_id=ws;
  if not found or document.lifecycle_state<>'active' or document.status<>'ready' or document.active_version_id<>capture_version_id then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select * into version from public.document_versions where id=capture_version_id and workspace_id=ws and document_id=document.id;
  if not found or version.publication_state<>'ready' or version.lifecycle_epoch<>document.lifecycle_epoch or version.index_generation is null then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select * into chunk from public.document_chunks where workspace_id=ws and document_id=document.id and version_id=version.id and chunk_index=capture_chunk_index;
  if not found then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  source_text=coalesce(chunk.original_text,chunk.content);
  if chunk.original_content_hash is distinct from p_input->>'original_content_hash' or encode(sha256(convert_to(source_text,'UTF8')),'hex') is distinct from chunk.original_content_hash
    or greatest(value_end,unit_end)>char_length(source_text) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  raw_value=substring(source_text from value_start+1 for value_end-value_start);raw_unit=substring(source_text from unit_start+1 for unit_end-unit_start);
  if substring(source_text from greatest(0,value_start-2)+1 for value_start-greatest(0,value_start-2))~'[0-9.]$|[0-9],$'
    or substring(source_text from value_end+1 for 2)~'^[0-9.]|^,[0-9]' then raise exception 'NR:CALCULATION_INVALID';end if;
  perform public.nexus_research_decimal(to_jsonb(raw_value));
  if raw_unit<>btrim(raw_unit) or length(raw_unit)=0 then raise exception 'NR:INVALID_SCOPE';end if;
  if (select count(*)>=100 from public.research_quantities where plan_id=p_plan_id)
    or (select count(*)>=1000 from public.research_quantities where workspace_id=ws) then raise exception 'NR:TENANT_QUOTA_EXCEEDED';end if;
  insert into public.research_quantities(workspace_id,owner_id,plan_id,document_id,version_id,chunk_id,input,value,unit,idempotency_key,payload_hash)
    values(ws,actor,p_plan_id,document.id,version.id,chunk.id,p_input,raw_value,raw_unit,p_key,request_hash) returning * into stored;
  return public.nexus_research_quantity_view(stored);
end; $$;
revoke all on function public.nexus_research_quantity_view(public.research_quantities),public.nexus_research_quantity(jsonb,text,uuid,jsonb,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.nexus_research_quantity_view(public.research_quantities),public.nexus_research_quantity(jsonb,text,uuid,jsonb,text,integer,uuid) to service_role;

create function public.nexus_check_calculation_quantity_references()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare quantities jsonb;quantity jsonb;reference text;capture public.research_quantities%rowtype;viewed jsonb;
  prefix text='urn:nexusrag:quantity:';
begin
  quantities=case new.calculation_kind
    when 'binary' then jsonb_build_array(new.input->'left',new.input->'right')
    when 'aggregate' then new.input->'values'
    when 'conversion' then jsonb_build_array(new.input->'quantity',jsonb_build_object('value',new.input->'factor',
      'unit',(new.input->>'target_unit')||'/'||(new.input->'quantity'->>'unit'),'evidence_ids',jsonb_build_array(new.input->>'conversion_evidence_id'))) end;
  for quantity in select value from jsonb_array_elements(quantities) loop
    if quantity->'value' is null or quantity->'value'='null'::jsonb then continue;end if;
    for reference in select value#>>'{}' from jsonb_array_elements(quantity->'evidence_ids') loop
      if left(lower(reference),length(prefix))<>prefix then continue;end if;
      if substring(reference from length(prefix)+1)!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'NR:INVALID_SCOPE';end if;
      select * into capture from public.research_quantities where id=substring(reference from length(prefix)+1)::uuid
        and workspace_id=new.workspace_id and owner_id=new.owner_id and plan_id=new.plan_id;
      if not found then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
      viewed=public.nexus_research_quantity_view(capture);
      if viewed->>'source_state'<>'SOURCE_SPANS_MATCHED_REVIEW_REQUIRED' or viewed->>'freshness'<>'current' then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
      if capture.value is distinct from quantity->>'value' or capture.unit is distinct from quantity->>'unit' then raise exception 'NR:QUANTITY_MISMATCH';end if;
    end loop;
  end loop;
  return new;
end; $$;
create trigger research_calculation_source_quantities before insert on public.research_calculations
  for each row execute function public.nexus_check_calculation_quantity_references();
revoke all on function public.nexus_check_calculation_quantity_references() from public,anon,authenticated;
grant execute on function public.nexus_check_calculation_quantity_references() to service_role;
