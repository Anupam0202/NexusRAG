-- Durable selected-source Deep Research. Installation starts no processing.
-- Main-question synthesis follows all saved subquestion analyses.
alter table public.research_runs drop constraint research_runs_mode_check,
  drop constraint research_runs_questions_check,drop constraint research_runs_source_snapshot_check,
  drop constraint research_runs_results_check,drop constraint research_runs_position_check;
alter table public.research_runs
  add constraint research_runs_mode_check check(mode in('QUICK_LOOKUP','EVIDENCE_ANSWER','COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH')),
  add constraint research_runs_questions_check check(jsonb_typeof(questions)='array' and jsonb_array_length(questions) between 1 and
    case when mode='DEEP_RESEARCH' then 13 when mode='CONTRADICTION_ANALYSIS' then 11 when mode in('COMPARE','TIMELINE') then 9 else 5 end),
  add constraint research_runs_source_snapshot_check check(jsonb_typeof(source_snapshot)='array' and jsonb_array_length(source_snapshot) between
    case when mode='COMPARE' then 2 else 1 end and case when mode='DEEP_RESEARCH' then 60 when mode='CONTRADICTION_ANALYSIS' then 50 when mode in('COMPARE','TIMELINE') then 40 else 20 end),
  add constraint research_runs_results_check check(jsonb_typeof(results)='array' and octet_length(results::text)<=
    case when mode in('COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH') then 3500000 else 400000 end),
  add constraint research_runs_position_check check(position between 0 and case when mode='DEEP_RESEARCH' then 13 when mode='CONTRADICTION_ANALYSIS' then 11 when mode in('COMPARE','TIMELINE') then 45 else 5 end
    and position=jsonb_array_length(results));

create function public.nexus_research_deep_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-deep/1','max_sources',60,'max_subquestions',12,'max_steps',13,
    'max_query_variants',8,'runtime_seconds',600,'max_prior_originals',144,'max_synthesis_sources',156);
$$;

alter function public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid) rename to nexus_research_run_deep_v1;
create function public.nexus_research_run(p_context jsonb,p_operation text,p_plan uuid,
  p_id uuid default null,p_key text default null,p_command jsonb default '{}',p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;draft public.research_plans%rowtype;
  r public.research_runs%rowtype;result jsonb;prior_generation integer;sources uuid[];source_id text;snapshot jsonb;admission_receipt jsonb;
  cursor_row public.research_runs%rowtype;entries jsonb;tail uuid;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,case when p_operation in('create','cancel','resume') then 'document.mutate' else 'read' end);
  select * into draft from public.research_plans where id=p_plan and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if draft.plan->>'mode'<>'DEEP_RESEARCH' then return public.nexus_research_run_deep_v1(p_context,p_operation,p_plan,p_id,p_key,p_command,p_limit,p_after);end if;
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
    result=public.nexus_research_run_deep_v1(p_context,p_operation,p_plan,p_id,p_key,p_command,p_limit,p_after);
    if p_operation='resume' and result->>'state'='queued' and (result->>'generation')::integer>prior_generation then
      update public.research_runs set deadline=clock_timestamp()+interval '600 seconds' where id=(result->>'id')::uuid returning * into r;
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
  if jsonb_array_length(draft.plan->'public_provider_ids')>0 or jsonb_array_length(draft.plan->'entity_scope')>0
    or jsonb_array_length(draft.plan->'rights_constraints')>0 or jsonb_array_length(draft.plan->'expected_calculations')>0
    or draft.plan->>'date_from' is not null or draft.plan->>'date_to' is not null or draft.plan->>'jurisdiction' is not null then raise exception 'NR:PLAN_CONSTRAINTS_UNSUPPORTED';end if;
  for source_id in select jsonb_array_elements_text(draft.plan->'private_source_ids') loop
    if source_id!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'NR:INVALID_SCOPE';end if;
  end loop;
  select array_agg(distinct value::uuid) into sources from jsonb_array_elements_text(draft.plan->'private_source_ids');
  if coalesce(cardinality(sources),0) not between 1 and 60 then raise exception 'NR:INVALID_SCOPE';end if;
  select jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'index_generation',v.index_generation,'lifecycle_epoch',v.lifecycle_epoch) order by d.id)
    into snapshot from public.documents d join public.document_versions v on v.id=d.active_version_id and v.document_id=d.id and v.workspace_id=d.workspace_id
    where d.workspace_id=ws and d.id=any(sources) and d.lifecycle_state='active' and v.publication_state='ready' and v.data_classification='non_sensitive';
  if coalesce(jsonb_array_length(snapshot),0)<>cardinality(sources) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  if (select count(*)>=100 from public.research_runs where workspace_id=ws) or (select count(*)>=10 from public.research_runs where plan_id=p_plan)
    or (select count(*)>=20 from public.research_runs where workspace_id=ws and mode='DEEP_RESEARCH') then raise exception 'NR:TENANT_QUOTA_EXCEEDED';end if;
  r.id=gen_random_uuid();admission_receipt=public.nexus_admit_account_operation(actor,'chat',r.id);
  if admission_receipt->>'status'<>'READY' then raise exception 'NR:BYOK_REQUIRED';end if;
  insert into public.research_runs(id,workspace_id,owner_id,plan_id,idempotency_key,mode,questions,source_snapshot,admission,deadline)
    values(r.id,ws,actor,p_plan,p_key,'DEEP_RESEARCH',(draft.plan->'subquestions')||jsonb_build_array(draft.plan->>'question'),snapshot,admission_receipt,clock_timestamp()+interval '600 seconds') returning * into r;
  return public.nexus_research_run_view(r);
end; $$;

create function public.nexus_research_deep_context(p_context jsonb,p_id uuid,p_generation integer,p_position integer)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype;items jsonb;expected integer;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid and owner_id=(p_context->>'user_id')::uuid;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if r.mode<>'DEEP_RESEARCH' or r.state<>'running' or r.generation<>p_generation or r.position<>p_position
    or r.position<>jsonb_array_length(r.questions)-1 or r.deadline<=clock_timestamp() then raise exception 'NR:VERSION_CONFLICT';end if;
  if not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  select count(*) into expected from (select distinct s->>'chunk_id',s->>'version_id',s->>'original_content_hash'
    from jsonb_array_elements(r.results) result cross join lateral jsonb_array_elements(result->'sources') s) originals;
  if expected>144 then raise exception 'NR:INVALID_SCOPE';end if;
  with originals as (select distinct s->>'chunk_id' chunk_id,s->>'version_id' version_id,s->>'original_content_hash' hash
    from jsonb_array_elements(r.results) result cross join lateral jsonb_array_elements(result->'sources') s)
  select coalesce(jsonb_agg(to_jsonb(c) order by c.id),'[]') into items from originals s join public.document_chunks c
    on c.id=s.chunk_id::uuid and c.version_id=s.version_id::uuid and c.workspace_id=r.workspace_id
    and c.original_content_hash=s.hash and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
    where r.source_snapshot @> jsonb_build_array(jsonb_build_object('document_id',c.document_id,'version_id',c.version_id));
  if jsonb_array_length(items)<>expected then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  return jsonb_build_object('schema_version','research-deep-context/1','run_id',r.id,'generation',r.generation,'position',r.position,'items',items);
end; $$;

create or replace function public.nexus_research_candidates(p_context jsonb,p_id uuid,p_generation integer,p_position integer,p_document_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype;allowed uuid[];chosen uuid[];source_count integer;batch integer;scope_offset integer=0;
  candidates jsonb;rows_read integer;limited boolean;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid and owner_id=(p_context->>'user_id')::uuid;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if r.state<>'running' or r.generation<>p_generation or r.position<>p_position or r.deadline<=clock_timestamp() then raise exception 'NR:VERSION_CONFLICT';end if;
  if not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  source_count=jsonb_array_length(r.source_snapshot);
  if r.mode in('COMPARE','TIMELINE') then batch=p_position%((source_count+7)/8);scope_offset=batch*8;end if;
  select array_agg((s->>'document_id')::uuid order by ordinal) into allowed
    from jsonb_array_elements(r.source_snapshot) with ordinality snapshot(s,ordinal)
    where ordinal>scope_offset and (r.mode not in('COMPARE','TIMELINE') or ordinal<=scope_offset+8);
  select array_agg(distinct value) into chosen from unnest(p_document_ids) value;
  if coalesce(cardinality(chosen),0) not between 1 and (case when r.mode='DEEP_RESEARCH' then 60 else 50 end)
    or cardinality(chosen)<>cardinality(p_document_ids) or not(chosen<@allowed)
    or (r.mode in('COMPARE','TIMELINE','CONTRADICTION_ANALYSIS','DEEP_RESEARCH') and not(allowed<@chosen)) then raise exception 'NR:INVALID_SCOPE';end if;
  with scope as (
    select s,row_number() over(order by ordinal)::integer rank,count(*) over()::integer total
      from jsonb_array_elements(r.source_snapshot) with ordinality snapshot(s,ordinal) where (s->>'document_id')::uuid=any(chosen)
  ),allocations as (
    select s,rank,201/total+case when rank<=201%total then 1 else 0 end allowance from scope
  ),batches as (
    select a.rank,a.allowance,coalesce(jsonb_agg(to_jsonb(c) order by c.id) filter(where c.id is not null),'[]') items
      from allocations a left join lateral (
        select id,workspace_id,document_id,version_id,chunk_index,page_number,content,original_text,original_content_hash,location,metadata
          from public.document_chunks where workspace_id=r.workspace_id and document_id=(a.s->>'document_id')::uuid and version_id=(a.s->>'version_id')::uuid
          order by id limit a.allowance
      ) c on true group by a.rank,a.allowance
  ) select coalesce((select jsonb_agg(item order by rank,ordinal) from batches cross join lateral jsonb_array_elements(items) with ordinality x(item,ordinal)
    where ordinal<case when jsonb_array_length(items)=allowance then allowance else allowance+1 end),'[]'),
    coalesce((select sum(jsonb_array_length(items)) from batches),0)::integer,
    coalesce((select bool_or(jsonb_array_length(items)=allowance) from batches),false)
    into candidates,rows_read,limited;
  return jsonb_build_object('schema_version','research-candidates/1','run_id',r.id,'generation',r.generation,'position',r.position,
    'items',candidates,'lexical_rows_read',rows_read,'lexical_limit_reached',limited);
end; $$;

alter function public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text) rename to nexus_research_step_deep_v1;
create function public.nexus_research_step(p_context jsonb,p_operation text,p_id uuid,p_generation integer,p_position integer,
  p_token uuid default null,p_result jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype;analysis jsonb;source jsonb;doc jsonb;receipt jsonb;i integer;phase text;
  prior jsonb;context_ids jsonb;expected_state text;total_receipts integer=0;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid and owner_id=(p_context->>'user_id')::uuid for update;
  if not found then raise exception 'NR:NOT_FOUND';end if;
  if r.mode<>'DEEP_RESEARCH' or p_operation<>'commit' then return public.nexus_research_step_deep_v1(p_context,p_operation,p_id,p_generation,p_position,p_token,p_result,p_error);end if;
  if r.generation<>p_generation or r.position<>p_position or r.state<>'running' or p_token is null or r.lease_token is distinct from p_token then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if r.deadline<=clock_timestamp() or not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then
    update public.research_runs set state='interrupted',lease_token=null,error_code=case when r.deadline<=clock_timestamp() then 'RUN_DEADLINE' else 'SOURCE_UNAVAILABLE' end,
      updated_at=clock_timestamp() where id=r.id returning * into r;
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  phase=case when r.position=jsonb_array_length(r.questions)-1 then 'SYNTHESIS' else 'SUBQUESTION' end;
  analysis=p_result->'deep';
  if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>(case when phase='SYNTHESIS' then 1000000 else 400000 end)
    or p_result->>'question' is distinct from r.questions->>r.position
    or jsonb_typeof(p_result->'answer') is distinct from 'string' or length(p_result->>'answer') not between 1 and 16000
    or analysis->>'schema_version' is distinct from 'research-deep/1' or analysis->>'phase' is distinct from phase
    or analysis->'criterion_index' is distinct from to_jsonb(r.position) or analysis->'question_count' is distinct from to_jsonb(jsonb_array_length(r.questions))
    or analysis->>'interpretation' is distinct from 'REVIEW_REQUIRED_CITATIONS_NOT_ENTAILMENT'
    or analysis->>'coverage' is distinct from 'BOUNDED_CANDIDATES_AND_CONTEXT_NOT_EXHAUSTIVE'
    or jsonb_typeof(analysis->'documents') is distinct from 'array' or jsonb_array_length(analysis->'documents')<>jsonb_array_length(r.source_snapshot)
    or jsonb_typeof(analysis->'prior_results') is distinct from 'array'
    or jsonb_typeof(analysis->'limitations') is distinct from 'array' or jsonb_typeof(analysis->'gaps') is distinct from 'array'
    or jsonb_array_length(analysis->'limitations')>8 or jsonb_array_length(analysis->'gaps')>8
    or jsonb_typeof(p_result->'sources') is distinct from 'array' or jsonb_array_length(p_result->'sources')>(case when phase='SYNTHESIS' then 156 else 12 end)
    or jsonb_typeof(p_result->'validated_citation_ids') is distinct from 'array' or jsonb_typeof(p_result->'abstained') is distinct from 'boolean'
    or coalesce(p_result->>'claim_state','') not in('REVIEW_REQUIRED','UNSUPPORTED')
    or p_result->'coverage'->>'completeness' is distinct from 'NOT_EXHAUSTIVE'
    or coalesce(p_result->'coverage'->>'chunks_considered','')!~'^[0-9]{1,3}$' or (p_result->'coverage'->>'chunks_considered')::integer>200
    or coalesce(p_result->>'provider_cost_status','') not in('UNKNOWN','NOT_CALLED')
    or p_result->>'review_state' is distinct from 'COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED' then raise exception 'NR:INVALID_SCOPE';end if;
  for receipt in select value from jsonb_array_elements((analysis->'limitations')||(analysis->'gaps')) loop
    if jsonb_typeof(receipt) is distinct from 'string' or length(btrim(receipt#>>'{}')) not between 1 and 500 then raise exception 'NR:INVALID_SCOPE';end if;
  end loop;
  select case when phase='SUBQUESTION' then '[]'::jsonb else coalesce(jsonb_agg(jsonb_build_object('result_index',ordinal-1,
    'question',x->'question','claim_state',x->'claim_state','abstained',x->'abstained') order by ordinal),'[]') end into prior
    from jsonb_array_elements(r.results) with ordinality item(x,ordinal);
  if analysis->'prior_results' is distinct from prior then raise exception 'NR:INVALID_SCOPE';end if;
  for source,i in select s,ordinal::integer from jsonb_array_elements(p_result->'sources') with ordinality item(s,ordinal) loop
    if source->>'citation_id' is distinct from 'S'||i::text or not exists(
      select 1 from public.document_chunks c join public.documents d on d.id=c.document_id and d.workspace_id=c.workspace_id
      where c.workspace_id=r.workspace_id and c.id=(source->>'chunk_id')::uuid and c.document_id=(source->>'document_id')::uuid and c.version_id=(source->>'version_id')::uuid
        and r.source_snapshot @> jsonb_build_array(jsonb_build_object('document_id',c.document_id,'version_id',c.version_id))
        and c.original_content_hash=source->>'original_content_hash' and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
        and length(source->>'content') between 1 and 1200 and left(c.original_text,length(source->>'content'))=source->>'content'
        and source->>'filename'=d.filename and c.chunk_index=(source->>'chunk_index')::integer and c.page_number is not distinct from (source->>'page_number')::integer
        and coalesce(c.location,'null'::jsonb)=coalesce(source->'location','null'::jsonb)) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  end loop;
  if exists(select 1 from jsonb_array_elements_text(p_result->'validated_citation_ids') id where not exists(
    select 1 from jsonb_array_elements(p_result->'sources') s where s->>'citation_id'=id))
    or (p_result->>'abstained')::boolean is distinct from (jsonb_array_length(p_result->'validated_citation_ids')=0)
    or p_result->>'claim_state' is distinct from (case when (p_result->>'abstained')::boolean then 'UNSUPPORTED' else 'REVIEW_REQUIRED' end) then raise exception 'NR:INVALID_SCOPE';end if;
  for doc,i in select d,ordinal::integer from jsonb_array_elements(analysis->'documents') with ordinality item(d,ordinal) loop
    if doc->>'document_id' is distinct from r.source_snapshot->(i-1)->>'document_id'
      or jsonb_typeof(doc->'filename') is distinct from 'string' or jsonb_typeof(doc->'consulted_sources') is distinct from 'array' then raise exception 'NR:INVALID_SCOPE';end if;
    total_receipts=total_receipts+jsonb_array_length(doc->'consulted_sources');
    if total_receipts>344 then raise exception 'NR:INVALID_SCOPE';end if;
    for receipt in select value from jsonb_array_elements(doc->'consulted_sources') loop
      if not exists(select 1 from public.document_chunks c where c.workspace_id=r.workspace_id and c.document_id=(doc->>'document_id')::uuid
        and c.version_id=(receipt->>'version_id')::uuid and c.id=(receipt->>'chunk_id')::uuid
        and r.source_snapshot @> jsonb_build_array(jsonb_build_object('document_id',c.document_id,'version_id',c.version_id))
        and c.original_content_hash=receipt->>'original_content_hash' and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
        and c.chunk_index=(receipt->>'chunk_index')::integer and c.page_number is not distinct from (receipt->>'page_number')::integer) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    end loop;
    select coalesce(jsonb_agg(s->'citation_id' order by ordinal),'[]') into context_ids
      from jsonb_array_elements(p_result->'sources') with ordinality source(s,ordinal) where s->>'document_id'=doc->>'document_id';
    expected_state=case when exists(select 1 from jsonb_array_elements_text(context_ids) id where p_result->'validated_citation_ids' ? id) then 'CITED'
      when jsonb_array_length(context_ids)>0 then 'IN_CONTEXT' when jsonb_array_length(doc->'consulted_sources')>0 then 'CANDIDATES_ONLY' else 'NO_INDEXED_EVIDENCE' end;
    if doc->'context_citation_ids' is distinct from context_ids or doc->>'evidence_state' is distinct from expected_state then raise exception 'NR:INVALID_SCOPE';end if;
  end loop;
  update public.research_runs set results=results||jsonb_build_array(p_result),position=position+1,
    state=case when position+1=jsonb_array_length(questions) then 'completed' else 'queued' end,
    lease_token=null,error_code=null,updated_at=clock_timestamp() where id=r.id returning * into r;
  return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
end; $$;

alter function public.nexus_research_finding_view(jsonb,uuid) rename to nexus_research_finding_view_deep_v1;
create function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare f jsonb;analysis jsonb;
begin
  f=public.nexus_research_finding_view_deep_v1(p_context,p_id);
  if f->>'source_research_run_id' is null or f->>'source_unavailable'='true' then return f;end if;
  select results->(f->>'source_research_position')::integer->'deep' into analysis from public.research_runs
    where id=(f->>'source_research_run_id')::uuid and workspace_id=(p_context->>'workspace_id')::uuid;
  if analysis is null then return f;end if;
  return jsonb_set(f,'{research_origin}',(f->'research_origin')||jsonb_build_object('deep',analysis));
end; $$;

alter function public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) rename to nexus_finding_deep_v1;
create function public.nexus_finding(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;r public.research_runs%rowtype;
  existing public.findings%rowtype;answer jsonb;position integer;result jsonb;role_name text;
begin
  if p_operation<>'create' or not(p_command ? 'research_run_id') then return public.nexus_finding_deep_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);end if;
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
  if not found or r.mode<>'DEEP_RESEARCH' then return public.nexus_finding_deep_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);end if;
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if role_name is null or role_name not in('editor','admin','owner') then raise exception 'NR:FORBIDDEN';end if;
  if p_command->>'run_id' is not null or coalesce(p_command->>'result_index','')!~'^([0-9]|1[0-2])$' then raise exception 'NR:INVALID_SCOPE';end if;
  position=(p_command->>'result_index')::integer;
  select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  if existing.id is null then
    answer=r.results->position;
    if position>=r.position or answer is null then raise exception 'NR:VERSION_CONFLICT';end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
    if answer->>'claim_state'<>'REVIEW_REQUIRED' or answer->'abstained' is distinct from 'false'::jsonb
      or coalesce(jsonb_array_length(answer->'validated_citation_ids'),0)=0 then raise exception 'NR:EVIDENCE_REQUIRED';end if;
  end if;
  result=public.workbench_finding(p_context,'create',null,p_command,p_revision,p_key,p_hash);p_id=(result->>'id')::uuid;
  if existing.id is null then
    update public.findings set source_research_run_id=r.id,source_research_position=position where id=p_id;
    update public.finding_versions set generated_markdown=answer->>'answer' where workspace_id=ws and finding_id=p_id and revision=1;
  end if;
  result=public.nexus_research_finding_view(p_context,p_id);
  if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE';end if;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  return result;
end; $$;

revoke all on function public.nexus_research_deep_contract(),public.nexus_research_deep_context(jsonb,uuid,integer,integer),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_research_finding_view(jsonb,uuid),public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nexus_research_deep_contract(),public.nexus_research_deep_context(jsonb,uuid,integer,integer),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_research_finding_view(jsonb,uuid),public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) to service_role;
