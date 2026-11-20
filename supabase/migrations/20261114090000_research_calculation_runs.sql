-- CALCULATION research runs (NX-17), the twelfth run mode.
--
-- A run reads up to twelve passages per question from the plan's selected documents. Gemini only points at
-- figures those passages state (the passage, the number, its unit and the period it refers to, each exactly as
-- written there) and says which calculations to make with them; it never does arithmetic. The gateway computes
-- each result with exact decimal arithmetic, and nexus_research_step stores a step only if every figure is where
-- the step says it is and every result equals what nexus_calculate_binary computes from those figures. Inputs,
-- formulas, units, precision, rounding and periods are kept with each result, and every result needs review.
-- A plan's expected calculations guide the run; dates, jurisdictions, public providers, rights constraints and
-- entity scopes are not honoured by it, so a plan that sets them is refused as before.
-- Installation starts no jobs and changes no stored rows.

begin;

alter table public.research_runs drop constraint research_runs_mode_check,
  drop constraint research_runs_questions_check,drop constraint research_runs_source_snapshot_check,
  drop constraint research_runs_results_check,drop constraint research_runs_position_check;
alter table public.research_runs
  add constraint research_runs_mode_check check(mode in('QUICK_LOOKUP','EVIDENCE_ANSWER','COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','DUE_DILIGENCE','PRODUCT_PASSPORT','PROCUREMENT_RESEARCH','CALCULATION')),
  add constraint research_runs_questions_check check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and
    case when mode in('DEEP_RESEARCH','DUE_DILIGENCE','PRODUCT_PASSPORT') then 13 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','PROCUREMENT_RESEARCH') then 11 when mode in('COMPARE','TIMELINE') then 9 when mode='CALCULATION' then 7 else 5 end),
  add constraint research_runs_source_snapshot_check check(jsonb_typeof(source_snapshot)='array' and jsonb_array_length(source_snapshot) between
    case when mode='COMPARE' then 2 else 1 end and case when mode in('DEEP_RESEARCH','DUE_DILIGENCE','PRODUCT_PASSPORT') then 60 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','PROCUREMENT_RESEARCH') then 50 when mode in('COMPARE','TIMELINE') then 40 when mode='CALCULATION' then 30 else 20 end),
  add constraint research_runs_results_check check(jsonb_typeof(results)='array' and octet_length(results::text)<=
    case when mode in('DUE_DILIGENCE','PRODUCT_PASSPORT') then 13001000 when mode in('OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','PROCUREMENT_RESEARCH') then 11000000 when mode='CALCULATION' then 7000000 when mode in('COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH') then 3500000 else 400000 end),
  add constraint research_runs_position_check check(position between 0 and case when mode in('DEEP_RESEARCH','DUE_DILIGENCE','PRODUCT_PASSPORT') then 13 when mode in('CONTRADICTION_ANALYSIS','OBLIGATION_ANALYSIS','ENTITY_INVESTIGATION','PROCUREMENT_RESEARCH') then 11 when mode in('COMPARE','TIMELINE') then 45 when mode='CALCULATION' then 7 else 5 end
    and position=jsonb_array_length(results));

create function public.nexus_research_calculation_run_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-calculation-run/1','max_sources',30,'max_subquestions',6,'max_steps',7,
    'max_query_variants',4,'runtime_seconds',180,'max_quantities',12,'max_calculations',6,'max_context_passages',12,
    'max_result_bytes',1000000,'max_run_bytes',7000000);
$$;

-- Whether p_part occupies [p_start,p_end) of p_text; offsets count characters and arrive as JSON numbers.
create function public.nexus_calculation_span_ok(p_text text,p_part text,p_start jsonb,p_end jsonb)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare s integer;e integer;
begin
  if p_text is null or p_part is null or length(p_part)<1 or jsonb_typeof(p_start) is distinct from 'number' or jsonb_typeof(p_end) is distinct from 'number'
    or p_start::text!~'^[0-9]{1,4}$' or p_end::text!~'^[0-9]{1,4}$' then return false;end if;
  s=(p_start::text)::integer;e=(p_end::text)::integer;
  return e=s+length(p_part) and e<=length(p_text) and substring(p_text from s+1 for e-s)=p_part;
end;$$;

-- Whether the figure at [p_start,p_end) of a passage stands there as a whole number: not part of a longer number,
-- not cut from a decimal or thousands group, and not missing a sign the passage shows (wholeNumberAt in the gateway).
create function public.nexus_calculation_number_ok(p_quote text,p_value text,p_start integer,p_end integer)
returns boolean language plpgsql immutable security invoker set search_path=public,pg_temp as $$
declare before1 text;before2 text;after1 text;after2 text;signed boolean=left(p_value,1) in('+','-',U&'\2212');
begin
  before1=case when p_start>=1 then substring(p_quote from p_start for 1) end;
  before2=case when p_start>=2 then substring(p_quote from p_start-1 for 1) end;
  after1=case when p_end<length(p_quote) then substring(p_quote from p_end+1 for 1) end;
  after2=case when p_end+1<length(p_quote) then substring(p_quote from p_end+2 for 1) end;
  if before1 is not null and (before1~'^[0-9]$' or before1='.' or (before1=',' and coalesce(before2~'^[0-9]$',false))
    or (not signed and before1 in('+','-',U&'\2212'))) then return false;end if;
  if after1 is not null and (after1~'^[0-9]$' or (after1 in('.',',') and coalesce(after2~'^[0-9]$',false))) then return false;end if;
  return true;
end;$$;

-- Text that may serve as a unit piece or a period: 1 to 64 characters, no control characters and no surrounding
-- space (plainText in the gateway).
create function public.nexus_calculation_plain_ok(p_value text)
returns boolean language sql immutable security invoker set search_path=public,pg_temp as $$
  select coalesce(length(p_value) between 1 and 64 and p_value!~'[\u0001-\u001f\u007f-\u009f]'
    and p_value=btrim(p_value,U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),false);
$$;

-- A calculation run shows the plan's expected calculations, which guide every step.
alter function public.nexus_research_run_view(public.research_runs) rename to nexus_research_run_view_calculation_v1;
create function public.nexus_research_run_view(p_row public.research_runs)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare result jsonb;requested jsonb;
begin
  result=public.nexus_research_run_view_calculation_v1(p_row);
  if p_row.mode<>'CALCULATION' then return result;end if;
  select plan->'expected_calculations' into requested from public.research_plans
    where id=p_row.plan_id and workspace_id=p_row.workspace_id and owner_id=p_row.owner_id;
  return result||jsonb_build_object('requested_calculations',coalesce(requested,'[]'::jsonb));
end;$$;

alter function public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid) rename to nexus_research_run_calculation_v1;
create function public.nexus_research_run(p_context jsonb,p_operation text,p_plan uuid,
  p_id uuid default null,p_key text default null,p_command jsonb default '{}',p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;draft public.research_plans%rowtype;
  r public.research_runs%rowtype;result jsonb;prior_generation integer;sources uuid[];snapshot jsonb;admission_receipt jsonb;
  cursor_row public.research_runs%rowtype;entries jsonb;tail uuid;source_id text;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,case when p_operation in('create','cancel','resume') then 'document.mutate' else 'read' end);
  select * into draft from public.research_plans where id=p_plan and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if draft.plan->>'mode'<>'CALCULATION' then return public.nexus_research_run_calculation_v1(p_context,p_operation,p_plan,p_id,p_key,p_command,p_limit,p_after);end if;
  if p_operation='list' then
    if p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE';end if;
    if p_after is not null then
      select * into cursor_row from public.research_runs where id=p_after and workspace_id=ws and owner_id=actor and plan_id=p_plan;
      if not found then raise exception 'NR:INVALID_SCOPE';end if;
    end if;
    select coalesce(jsonb_agg((public.nexus_research_run_view(x::public.research_runs)-'results')||jsonb_build_object('results','[]'::jsonb,'results_included',false)
      order by x.created_at desc,x.id desc),'[]') into entries from
      (select * from public.research_runs where workspace_id=ws and owner_id=actor and plan_id=p_plan
       and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) x;
    if jsonb_array_length(entries)>p_limit then entries=entries-p_limit;tail=(entries->(p_limit-1)->>'id')::uuid;end if;
    return jsonb_build_object('items',entries,'next_after',tail,'schema_version','research-run/1');
  end if;
  if p_operation<>'create' then
    if p_operation='resume' then select generation into prior_generation from public.research_runs where id=p_id and plan_id=p_plan and workspace_id=ws and owner_id=actor;end if;
    result=public.nexus_research_run_calculation_v1(p_context,p_operation,p_plan,p_id,p_key,p_command,p_limit,p_after);
    if p_operation='resume' and result->>'state'='queued' and (result->>'generation')::integer>prior_generation then
      update public.research_runs set deadline=clock_timestamp()+interval '180 seconds' where id=(result->>'id')::uuid returning * into r;
      return public.nexus_research_run_view(r);
    end if;
    return result;
  end if;
  if p_key is null or length(p_key) not between 1 and 128 or p_command->'non_sensitive_attested' is distinct from 'true'::jsonb then raise exception 'NR:INVALID_SCOPE';end if;
  select * into r from public.research_runs where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if r.plan_id<>p_plan then raise exception 'NR:VERSION_CONFLICT';end if;
    return public.nexus_research_run_view(r);
  end if;
  if jsonb_array_length(draft.plan->'public_provider_ids')>0 or jsonb_array_length(draft.plan->'rights_constraints')>0
    or jsonb_array_length(draft.plan->'entity_scope')>0 or draft.plan->>'date_from' is not null
    or draft.plan->>'date_to' is not null or draft.plan->>'jurisdiction' is not null then raise exception 'NR:PLAN_CONSTRAINTS_UNSUPPORTED';end if;
  perform public.nexus_research_plan_limits(draft.plan);
  for source_id in select jsonb_array_elements_text(draft.plan->'private_source_ids') loop
    if source_id!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'NR:INVALID_SCOPE';end if;
  end loop;
  select array_agg(distinct value::uuid) into sources from jsonb_array_elements_text(draft.plan->'private_source_ids');
  if coalesce(cardinality(sources),0) not between 1 and 30 then raise exception 'NR:INVALID_SCOPE';end if;
  select jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'index_generation',v.index_generation,'lifecycle_epoch',v.lifecycle_epoch) order by d.id)
    into snapshot from public.documents d join public.document_versions v on v.id=d.active_version_id and v.document_id=d.id and v.workspace_id=d.workspace_id
    where d.workspace_id=ws and d.id=any(sources) and d.lifecycle_state='active' and v.publication_state='ready' and v.data_classification='non_sensitive';
  if coalesce(jsonb_array_length(snapshot),0)<>cardinality(sources) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if (select count(*)>=100 from public.research_runs where workspace_id=ws) or (select count(*)>=10 from public.research_runs where plan_id=p_plan)
    or (select count(*)>=20 from public.research_runs where workspace_id=ws and mode='CALCULATION') then raise exception 'NR:TENANT_QUOTA_EXCEEDED';end if;
  r.id=gen_random_uuid();admission_receipt=public.nexus_admit_account_operation(actor,'chat',r.id);
  if admission_receipt->>'status'<>'READY' then raise exception 'NR:BYOK_REQUIRED';end if;
  insert into public.research_runs(id,workspace_id,owner_id,plan_id,idempotency_key,mode,questions,source_snapshot,admission,deadline)
    values(r.id,ws,actor,p_plan,p_key,'CALCULATION',jsonb_build_array(draft.plan->>'question')||(draft.plan->'subquestions'),snapshot,admission_receipt,
      clock_timestamp()+interval '180 seconds') returning * into r;
  return public.nexus_research_run_view(r);
end;$$;

alter function public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text) rename to nexus_research_step_calculation_v1;
create function public.nexus_research_step(p_context jsonb,p_operation text,p_id uuid,p_generation integer,p_position integer,
  p_token uuid default null,p_result jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype;analysis jsonb;source jsonb;doc jsonb;receipt jsonb;quantity jsonb;calc jsonb;item jsonb;span jsonb;
  i integer;total_receipts integer=0;expected_state text;citations jsonb;quote text;value_text text;piece text;pieces text[];taken integer[];
  vs integer;ve integer;us integer;ue integer;left_q jsonb;right_q jsonb;expected_input jsonb;same_unit boolean;zero boolean;
  computed integer=0;identity text;identities text[]='{}';seen_values text[]='{}';rejection_keys text[]='{}';
  quantity_rejections integer=0;calculation_rejections integer=0;
  spaces text=U&'\0020\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid and owner_id=(p_context->>'user_id')::uuid for update;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if r.mode<>'CALCULATION' or p_operation<>'commit' then return public.nexus_research_step_calculation_v1(p_context,p_operation,p_id,p_generation,p_position,p_token,p_result,p_error);end if;
  if r.generation<>p_generation or r.position<>p_position or r.state<>'running' or p_token is null or r.lease_token is distinct from p_token then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if r.deadline<=clock_timestamp() or not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then
    update public.research_runs set state='interrupted',lease_token=null,error_code=case when r.deadline<=clock_timestamp() then 'RUN_DEADLINE' else 'SOURCE_UNAVAILABLE' end,
      updated_at=clock_timestamp() where id=r.id returning * into r;
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  analysis=p_result->'calculation';
  if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>1000000 or p_result->>'question' is distinct from r.questions->>r.position
    or jsonb_typeof(p_result->'answer') is distinct from 'string' or length(p_result->>'answer') not between 1 and 16000
    or jsonb_typeof(analysis) is distinct from 'object' or (select count(*) from jsonb_object_keys(analysis))<>10
    or analysis->>'schema_version' is distinct from 'research-calculation-run/1' or analysis->'criterion_index' is distinct from to_jsonb(r.position)
    or analysis->'total_documents' is distinct from to_jsonb(jsonb_array_length(r.source_snapshot))
    or analysis->>'interpretation' is distinct from 'FIGURES_QUOTED_FROM_SOURCES_RESULTS_COMPUTED_BY_DATABASE'
    or analysis->>'coverage' is distinct from 'BOUNDED_RETRIEVAL_NOT_EXHAUSTIVE' or analysis->>'rounding' is distinct from 'ROUND_HALF_EVEN'
    or jsonb_typeof(analysis->'quantities') is distinct from 'array' or jsonb_typeof(analysis->'calculations') is distinct from 'array'
    or jsonb_typeof(analysis->'rejections') is distinct from 'array' or jsonb_typeof(analysis->'documents') is distinct from 'array'
    or jsonb_typeof(p_result->'sources') is distinct from 'array' or jsonb_typeof(p_result->'validated_citation_ids') is distinct from 'array'
    or jsonb_typeof(p_result->'abstained') is distinct from 'boolean' or coalesce(p_result->>'claim_state','') not in('REVIEW_REQUIRED','UNSUPPORTED')
    or p_result->'coverage'->>'completeness' is distinct from 'NOT_EXHAUSTIVE'
    or coalesce(p_result->'coverage'->>'chunks_considered','')!~'^[0-9]{1,3}$' or (p_result->'coverage'->>'chunks_considered')::integer>200
    or coalesce(p_result->>'provider_cost_status','') not in('UNKNOWN','NOT_CALLED')
    or p_result->>'review_state' is distinct from 'COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED' then raise exception 'NR:INVALID_SCOPE';end if;
  if jsonb_array_length(analysis->'quantities')>12 or jsonb_array_length(analysis->'calculations')>6 or jsonb_array_length(analysis->'rejections')>18
    or jsonb_array_length(analysis->'documents')<>jsonb_array_length(r.source_snapshot) or jsonb_array_length(p_result->'sources')>12 then raise exception 'NR:INVALID_SCOPE';end if;

  -- Every passage is the stored, unchanged start of a chunk of a document in the run's scope.
  for source,i in select value,ordinal::integer from jsonb_array_elements(p_result->'sources') with ordinality sources(value,ordinal) loop
    if source->>'citation_id' is distinct from 'S'||i::text or not exists(
      select 1 from public.document_chunks c where c.workspace_id=r.workspace_id and c.id=(source->>'chunk_id')::uuid
        and c.document_id=(source->>'document_id')::uuid and c.version_id=(source->>'version_id')::uuid
        and r.source_snapshot @> jsonb_build_array(jsonb_build_object('document_id',c.document_id,'version_id',c.version_id))
        and c.original_content_hash=source->>'original_content_hash' and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
        and length(source->>'content') between 1 and 1200 and left(c.original_text,length(source->>'content'))=source->>'content'
        and coalesce(c.location,'null'::jsonb)=coalesce(source->'location','null'::jsonb)
        and c.chunk_index=(source->>'chunk_index')::integer and c.page_number is not distinct from (source->>'page_number')::integer) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  end loop;

  -- Every figure, its unit and its period stand in the quoted passage exactly where the step says.
  for quantity,i in select value,ordinal::integer from jsonb_array_elements(analysis->'quantities') with ordinality quantities(value,ordinal) loop
    if jsonb_typeof(quantity) is distinct from 'object' or (select count(*) from jsonb_object_keys(quantity))<>18
      or not quantity ?& array['quantity_id','label','document_id','version_id','citation_id','quote','quote_start','quote_end','value_text','value_start',
        'value_end','value','unit','unit_spans','period','period_start','period_end','claim_state']
      or quantity->>'quantity_id' is distinct from 'Q'||i::text or quantity->>'claim_state' is distinct from 'REVIEW_REQUIRED'
      or jsonb_typeof(quantity->'label') is distinct from 'string' or length(quantity->>'label') not between 1 and 200 or btrim(quantity->>'label',spaces)=''
      or jsonb_typeof(quantity->'quote') is distinct from 'string' or length(quantity->>'quote') not between 1 and 300
      or jsonb_typeof(quantity->'value_text') is distinct from 'string' or jsonb_typeof(quantity->'unit') is distinct from 'string'
      or jsonb_typeof(quantity->'unit_spans') is distinct from 'array' or jsonb_array_length(quantity->'unit_spans') not between 1 and 2 then raise exception 'NR:INVALID_SCOPE';end if;
    quote=quantity->>'quote';
    select value into source from jsonb_array_elements(p_result->'sources') where value->>'citation_id'=quantity->>'citation_id';
    if source is null or source->>'document_id' is distinct from quantity->>'document_id' or source->>'version_id' is distinct from quantity->>'version_id'
      or not public.nexus_calculation_span_ok(source->>'content',quote,quantity->'quote_start',quantity->'quote_end') then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    value_text=quantity->>'value_text';
    if length(value_text) not between 1 and 64 or value_text!~'^[-+−]?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]+)?$'
      or quantity->'value' is distinct from to_jsonb(replace(replace(value_text,U&'\2212','-'),',',''))
      or not public.nexus_calculation_span_ok(quote,value_text,quantity->'value_start',quantity->'value_end') then raise exception 'NR:INVALID_SCOPE';end if;
    vs=(quantity->>'value_start')::integer;ve=(quantity->>'value_end')::integer;
    if not public.nexus_calculation_number_ok(quote,value_text,vs,ve) then raise exception 'NR:INVALID_SCOPE';end if;
    pieces='{}';taken='{}';
    for span in select value from jsonb_array_elements(quantity->'unit_spans') loop
      if jsonb_typeof(span) is distinct from 'array' or jsonb_array_length(span)<>2 or jsonb_typeof(span->0) is distinct from 'number'
        or jsonb_typeof(span->1) is distinct from 'number' or (span->>0)!~'^[0-9]{1,3}$' or (span->>1)!~'^[0-9]{1,3}$' then raise exception 'NR:INVALID_SCOPE';end if;
      us=(span->>0)::integer;ue=(span->>1)::integer;
      if ue<=us or ue>length(quote) or not(ue<=vs or us>=ve) or (cardinality(taken)=2 and not(ue<=taken[1] or us>=taken[2])) then raise exception 'NR:INVALID_SCOPE';end if;
      piece=substring(quote from us+1 for ue-us);
      if not public.nexus_calculation_plain_ok(piece) then raise exception 'NR:INVALID_SCOPE';end if;
      pieces=pieces||piece;taken=taken||array[us,ue];
    end loop;
    if quantity->>'unit' is distinct from array_to_string(pieces,' ') or length(quantity->>'unit')>64 then raise exception 'NR:INVALID_SCOPE';end if;
    if jsonb_typeof(quantity->'period')='null' then
      if quantity->'period_start' is distinct from 'null'::jsonb or quantity->'period_end' is distinct from 'null'::jsonb then raise exception 'NR:INVALID_SCOPE';end if;
    else
      if jsonb_typeof(quantity->'period') is distinct from 'string' or not public.nexus_calculation_plain_ok(quantity->>'period')
        or not public.nexus_calculation_span_ok(quote,quantity->>'period',quantity->'period_start',quantity->'period_end') then raise exception 'NR:INVALID_SCOPE';end if;
      if not((quantity->>'period_end')::integer<=vs or (quantity->>'period_start')::integer>=ve) then raise exception 'NR:INVALID_SCOPE';end if;
    end if;
    identity=(source->>'chunk_id')||':'||((quantity->>'quote_start')::integer+vs)::text||':'||((quantity->>'quote_start')::integer+ve)::text;
    if identity=any(seen_values) then raise exception 'NR:INVALID_SCOPE';end if;
    seen_values=seen_values||identity;
  end loop;

  -- Every result is what nexus_calculate_binary computes from the quoted figures, and every refusal is the one it makes.
  for calc in select value from jsonb_array_elements(analysis->'calculations') loop
    if jsonb_typeof(calc) is distinct from 'object' or (select count(*) from jsonb_object_keys(calc))<>10
      or not calc ?& array['label','operation','left','right','precision','input','state','reason','result','claim_state']
      or jsonb_typeof(calc->'label') is distinct from 'string' or length(calc->>'label') not between 1 and 200 or btrim(calc->>'label',spaces)=''
      or coalesce(calc->>'operation','') not in('ADD','SUBTRACT','MULTIPLY','DIVIDE','PERCENT_CHANGE','RATIO','DIFFERENCE')
      or jsonb_typeof(calc->'precision') is distinct from 'number' or coalesce(calc->>'precision','')!~'^([0-9]|1[0-8])$'
      or jsonb_typeof(calc->'left') is distinct from 'string' or jsonb_typeof(calc->'right') is distinct from 'string'
      or calc->>'claim_state' is distinct from 'REVIEW_REQUIRED' then raise exception 'NR:INVALID_SCOPE';end if;
    select value into left_q from jsonb_array_elements(analysis->'quantities') where value->>'quantity_id'=calc->>'left';
    select value into right_q from jsonb_array_elements(analysis->'quantities') where value->>'quantity_id'=calc->>'right';
    if left_q is null or right_q is null then raise exception 'NR:INVALID_SCOPE';end if;
    expected_input=jsonb_build_object('operation',calc->>'operation','precision',(calc->>'precision')::integer,
      'left',jsonb_build_object('value',left_q->>'value','unit',left_q->>'unit','evidence_ids',jsonb_build_array(left_q->>'quantity_id')),
      'right',jsonb_build_object('value',right_q->>'value','unit',right_q->>'unit','evidence_ids',jsonb_build_array(right_q->>'quantity_id')));
    if calc->'input' is distinct from expected_input then raise exception 'NR:INVALID_SCOPE';end if;
    same_unit=calc->>'operation' not in('ADD','SUBTRACT','DIFFERENCE','PERCENT_CHANGE') or left_q->>'unit'=right_q->>'unit';
    zero=case calc->>'operation' when 'DIVIDE' then (right_q->>'value')::numeric=0 when 'RATIO' then (right_q->>'value')::numeric=0
      when 'PERCENT_CHANGE' then (left_q->>'value')::numeric=0 else false end;
    if not same_unit or zero then
      if calc->>'state' is distinct from 'NOT_CALCULATED' or calc->'result' is distinct from 'null'::jsonb
        or calc->>'reason' is distinct from (case when not same_unit then 'UNITS_DIFFER' else 'DIVISION_BY_ZERO' end) then raise exception 'NR:INVALID_SCOPE';end if;
    else
      if calc->>'state' is distinct from 'CALCULATED' or calc->'reason' is distinct from 'null'::jsonb
        or calc->'result' is distinct from public.nexus_calculate_binary(expected_input) then raise exception 'NR:INVALID_SCOPE';end if;
      computed=computed+1;
    end if;
    identity=(calc->>'operation')||':'||(calc->>'left')||':'||(calc->>'right');
    if identity=any(identities) then raise exception 'NR:INVALID_SCOPE';end if;
    identities=identities||identity;
  end loop;

  for item in select value from jsonb_array_elements(analysis->'rejections') loop
    if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>3 or not item ?& array['kind','index','reason']
      or jsonb_typeof(item->'index') is distinct from 'number' or coalesce(item->>'index','')!~'^([0-9]|1[01])$'
      or not((item->>'kind'='QUANTITY' and item->>'reason' in('INVALID_QUANTITY','UNCONFIRMED_SOURCE_ANCHOR','VALUE_NOT_IN_QUOTE','UNIT_NOT_IN_QUOTE','PERIOD_NOT_IN_QUOTE','REPEATED_QUANTITY'))
        or (item->>'kind'='CALCULATION' and item->>'reason' in('INVALID_CALCULATION','QUANTITY_UNAVAILABLE','REPEATED_CALCULATION') and (item->>'index')::integer<6))
      or (item->>'kind')||':'||(item->>'index')=any(rejection_keys) then raise exception 'NR:INVALID_SCOPE';end if;
    rejection_keys=rejection_keys||((item->>'kind')||':'||(item->>'index'));
    if item->>'kind'='QUANTITY' then quantity_rejections=quantity_rejections+1;else calculation_rejections=calculation_rejections+1;end if;
  end loop;
  if jsonb_array_length(analysis->'quantities')+quantity_rejections>12 or jsonb_array_length(analysis->'calculations')+calculation_rejections>6 then raise exception 'NR:INVALID_SCOPE';end if;

  -- Every document in scope says what was read from it.
  for doc,i in select value,ordinal::integer from jsonb_array_elements(analysis->'documents') with ordinality documents(value,ordinal) loop
    if doc->>'document_id' is distinct from r.source_snapshot->(i-1)->>'document_id' or jsonb_typeof(doc->'filename') is distinct from 'string'
      or jsonb_typeof(doc->'consulted_sources') is distinct from 'array' then raise exception 'NR:INVALID_SCOPE';end if;
    total_receipts=total_receipts+jsonb_array_length(doc->'consulted_sources');
    if total_receipts>12 then raise exception 'NR:INVALID_SCOPE';end if;
    for receipt in select value from jsonb_array_elements(doc->'consulted_sources') loop
      if not exists(select 1 from public.document_chunks c where c.workspace_id=r.workspace_id and c.id=(receipt->>'chunk_id')::uuid
        and c.document_id=(doc->>'document_id')::uuid and c.version_id=(receipt->>'version_id')::uuid
        and r.source_snapshot @> jsonb_build_array(jsonb_build_object('document_id',c.document_id,'version_id',c.version_id))
        and c.original_content_hash=receipt->>'original_content_hash' and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
        and c.chunk_index=(receipt->>'chunk_index')::integer and c.page_number is not distinct from (receipt->>'page_number')::integer) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    end loop;
    expected_state=case when exists(select 1 from jsonb_array_elements(analysis->'quantities') q where q->>'document_id'=doc->>'document_id')
      then 'QUANTITY_FOUND' when jsonb_array_length(doc->'consulted_sources')>0 then 'NO_QUANTITY_FOUND' else 'NO_INDEXED_EVIDENCE' end;
    if doc->>'evidence_state' is distinct from expected_state then raise exception 'NR:INVALID_SCOPE';end if;
  end loop;
  for source in select value from jsonb_array_elements(p_result->'sources') loop
    if not exists(select 1 from jsonb_array_elements(analysis->'documents') d cross join lateral jsonb_array_elements(d->'consulted_sources') c
      where d->>'document_id'=source->>'document_id' and c->>'version_id'=source->>'version_id' and c->>'chunk_id'=source->>'chunk_id'
      and c->>'original_content_hash'=source->>'original_content_hash') then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  end loop;

  -- The passages kept are exactly those a figure is quoted from; a step answers only if a result was computed.
  select coalesce(jsonb_agg(to_jsonb(id) order by substring(id,2)::integer),'[]') into citations from
    (select distinct value->>'citation_id' id from jsonb_array_elements(analysis->'quantities')) ids;
  if citations is distinct from p_result->'validated_citation_ids' or jsonb_array_length(citations)<>jsonb_array_length(p_result->'sources')
    or (p_result->>'abstained')::boolean is distinct from (computed=0)
    or p_result->>'claim_state' is distinct from (case when computed=0 then 'UNSUPPORTED' else 'REVIEW_REQUIRED' end) then raise exception 'NR:INVALID_SCOPE';end if;
  update public.research_runs set results=results||jsonb_build_array(p_result),position=position+1,state=case when position+1=public.nexus_research_run_steps(r) then 'completed' else 'queued' end,
    lease_token=null,error_code=null,updated_at=clock_timestamp() where id=r.id returning * into r;
  return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
end;$$;

alter function public.nexus_research_finding_view(jsonb,uuid) rename to nexus_research_finding_view_calculation_v1;
create function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare f jsonb;analysis jsonb;
begin
  f=public.nexus_research_finding_view_calculation_v1(p_context,p_id);
  if f->>'source_research_run_id' is null or f->>'source_unavailable'='true' then return f;end if;
  select results->(f->>'source_research_position')::integer->'calculation' into analysis from public.research_runs
    where id=(f->>'source_research_run_id')::uuid and workspace_id=(p_context->>'workspace_id')::uuid and mode='CALCULATION';
  if analysis is null then return f;end if;
  return jsonb_set(f,'{research_origin}',(f->'research_origin')||jsonb_build_object('calculation',analysis));
end;$$;

-- A finding is saved only from a step that computed at least one result.
alter function public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) rename to nexus_finding_calculation_v1;
create function public.nexus_finding(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;r public.research_runs%rowtype;
  existing public.findings%rowtype;answer jsonb;result jsonb;position integer;role_name text;
begin
  if p_operation<>'create' or not(p_command ? 'research_run_id') then return public.nexus_finding_calculation_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);end if;
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if role_name is null or role_name not in('editor','admin','owner') then raise exception 'NR:FORBIDDEN';end if;
  select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
  if r.mode is distinct from 'CALCULATION' then return public.nexus_finding_calculation_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);end if;
  if p_command->>'run_id' is not null or coalesce(p_command->>'result_index','')!~'^[0-6]$' then raise exception 'NR:INVALID_SCOPE';end if;
  position=(p_command->>'result_index')::integer;
  select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  if existing.id is null then
    answer=r.results->position;
    if position>=r.position or answer is null then raise exception 'NR:VERSION_CONFLICT';end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    if answer->>'claim_state'<>'REVIEW_REQUIRED' or answer->'abstained' is distinct from 'false'::jsonb or coalesce(jsonb_array_length(answer->'validated_citation_ids'),0)=0
      or not exists(select 1 from jsonb_array_elements(answer->'calculation'->'calculations') c where c->>'state'='CALCULATED') then raise exception 'NR:EVIDENCE_REQUIRED';end if;
  end if;
  result=public.workbench_finding(p_context,'create',null,p_command,p_revision,p_key,p_hash);p_id=(result->>'id')::uuid;
  if existing.id is null then
    update public.findings set source_research_run_id=r.id,source_research_position=position where id=p_id;
    update public.finding_versions set generated_markdown=answer->>'answer' where workspace_id=ws and finding_id=p_id and revision=1;
  end if;
  result=public.nexus_research_finding_view(p_context,p_id);
  if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if existing.id is null then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end;$$;

revoke all on function public.nexus_research_calculation_run_contract(),
  public.nexus_calculation_span_ok(text,text,jsonb,jsonb),public.nexus_calculation_number_ok(text,text,integer,integer),public.nexus_calculation_plain_ok(text),
  public.nexus_research_run_view(public.research_runs),public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),
  public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),public.nexus_research_finding_view(jsonb,uuid),
  public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nexus_research_calculation_run_contract(),
  public.nexus_calculation_span_ok(text,text,jsonb,jsonb),public.nexus_calculation_number_ok(text,text,integer,integer),public.nexus_calculation_plain_ok(text),
  public.nexus_research_run_view(public.research_runs),public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),
  public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),public.nexus_research_finding_view(jsonb,uuid),
  public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) to service_role;

commit;
