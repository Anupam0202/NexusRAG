-- Bounded comparison batches reuse durable runs without changing existing answers.
-- Installation changes no stored records and starts no jobs or provider processing.
alter table public.research_runs drop constraint research_runs_mode_check,
  drop constraint research_runs_questions_check,drop constraint research_runs_source_snapshot_check,
  drop constraint research_runs_results_check,drop constraint research_runs_check;
alter table public.research_runs
  add constraint research_runs_mode_check check(mode in('QUICK_LOOKUP','EVIDENCE_ANSWER','COMPARE')),
  add constraint research_runs_questions_check check(jsonb_typeof(questions)='array' and
    jsonb_array_length(questions) between 1 and case when mode='COMPARE' then 9 else 5 end),
  add constraint research_runs_source_snapshot_check check(jsonb_typeof(source_snapshot)='array' and
    jsonb_array_length(source_snapshot) between case when mode='COMPARE' then 2 else 1 end and case when mode='COMPARE' then 40 else 20 end),
  add constraint research_runs_results_check check(jsonb_typeof(results)='array' and
    octet_length(results::text)<=case when mode='COMPARE' then 3500000 else 400000 end),
  add constraint research_runs_position_check check(position between 0 and case when mode='COMPARE' then 45 else 5 end
    and position=jsonb_array_length(results));

create function public.nexus_research_run_steps(p_row public.research_runs)
returns integer language sql immutable security invoker set search_path=public,pg_temp as $$
  select jsonb_array_length(p_row.questions)*case when p_row.mode='COMPARE' then (jsonb_array_length(p_row.source_snapshot)+7)/8 else 1 end;
$$;
create function public.nexus_research_comparison_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-comparison/1','batch_size',8,'max_steps',45);
$$;
create or replace function public.nexus_research_run_view(p_row public.research_runs)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare current_source boolean; expired boolean;
begin
  current_source=public.nexus_research_sources_current(p_row.workspace_id,p_row.source_snapshot);
  expired=p_row.state in('queued','running') and p_row.deadline<=statement_timestamp();
  return (to_jsonb(p_row)-'idempotency_key'-'lease_token')||jsonb_build_object(
    'schema_version','research-run/1','persistence_state','PERSISTED','total_steps',public.nexus_research_run_steps(p_row),
    'state',case when expired then 'interrupted' else p_row.state end,
    'error_code',case when expired then 'RUN_DEADLINE' else p_row.error_code end,
    'source_state',case when current_source then 'CURRENT' else 'UNAVAILABLE_OR_CHANGED' end,
    'results',case when current_source then p_row.results else '[]'::jsonb end);
end; $$;

alter function public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid) rename to nexus_research_run_answers_v1;
create function public.nexus_research_run(p_context jsonb,p_operation text,p_plan uuid,
  p_id uuid default null,p_key text default null,p_command jsonb default '{}',p_limit integer default 20,p_after uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  draft public.research_plans%rowtype; r public.research_runs%rowtype; result jsonb;
  sources uuid[]; source_id text; snapshot jsonb; admission_receipt jsonb; prior_generation integer;
  cursor_row public.research_runs%rowtype; entries jsonb; tail uuid;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,case when p_operation in('create','cancel','resume') then 'document.mutate' else 'read' end);
  select * into draft from public.research_plans where id=p_plan and workspace_id=ws and owner_id=actor;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if draft.plan->>'mode'='COMPARE' and p_operation='list' then
    if p_limit not between 1 and 50 then raise exception 'NR:INVALID_SCOPE'; end if;
    if p_after is not null then
      select * into cursor_row from public.research_runs where id=p_after and workspace_id=ws and owner_id=actor and plan_id=p_plan;
      if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    end if;
    -- Keep list responses bounded even when every comparison contains45large batches.
    -- A separately authorized read still returns the complete persisted matrix.
    select coalesce(jsonb_agg((public.nexus_research_run_view(x::public.research_runs)-'results')||
      jsonb_build_object('results','[]'::jsonb,'results_included',false) order by x.created_at desc,x.id desc),'[]') into entries
      from (select * from public.research_runs where workspace_id=ws and owner_id=actor and plan_id=p_plan
        and (p_after is null or (created_at,id)<(cursor_row.created_at,cursor_row.id)) order by created_at desc,id desc limit p_limit+1) x;
    if jsonb_array_length(entries)>p_limit then entries=entries-p_limit;tail=(entries->(p_limit-1)->>'id')::uuid;end if;
    return jsonb_build_object('items',entries,'next_after',tail,'schema_version','research-run/1');
  end if;
  if draft.plan->>'mode'<>'COMPARE' or p_operation<>'create' then
    if draft.plan->>'mode'='COMPARE' and p_operation='resume' then
      select generation into prior_generation from public.research_runs where id=p_id and plan_id=p_plan and workspace_id=ws and owner_id=actor;
    end if;
    result=public.nexus_research_run_answers_v1(p_context,p_operation,p_plan,p_id,p_key,p_command,p_limit,p_after);
    if draft.plan->>'mode'='COMPARE' and p_operation='resume' and result->>'state'='queued' and (result->>'generation')::integer>prior_generation then
      update public.research_runs set deadline=clock_timestamp()+interval '300 seconds'
        where id=(result->>'id')::uuid returning * into r;
      return public.nexus_research_run_view(r);
    end if;
    return result;
  end if;
  if p_key is null or length(p_key) not between 1 and 128 or p_command->'non_sensitive_attested' is distinct from 'true'::jsonb
    then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into r from public.research_runs where workspace_id=ws and owner_id=actor and idempotency_key=p_key;
  if found then
    if r.plan_id<>p_plan then raise exception 'NR:VERSION_CONFLICT'; end if;
    return public.nexus_research_run_view(r);
  end if;
  if jsonb_array_length(draft.plan->'public_provider_ids')>0 or jsonb_array_length(draft.plan->'entity_scope')>0
    or jsonb_array_length(draft.plan->'rights_constraints')>0 or jsonb_array_length(draft.plan->'expected_calculations')>0
    or draft.plan->>'date_from' is not null or draft.plan->>'date_to' is not null or draft.plan->>'jurisdiction' is not null
    then raise exception 'NR:PLAN_CONSTRAINTS_UNSUPPORTED'; end if;
  for source_id in select jsonb_array_elements_text(draft.plan->'private_source_ids') loop
    if source_id!~*'^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'NR:INVALID_SCOPE'; end if;
  end loop;
  select array_agg(distinct value::uuid) into sources from jsonb_array_elements_text(draft.plan->'private_source_ids');
  if coalesce(cardinality(sources),0) not between 2 and 40 then raise exception 'NR:COMPARISON_SCOPE_REQUIRED'; end if;
  select jsonb_agg(jsonb_build_object('document_id',d.id,'version_id',v.id,'index_generation',v.index_generation,'lifecycle_epoch',v.lifecycle_epoch) order by d.id)
    into snapshot from public.documents d join public.document_versions v on v.id=d.active_version_id and v.document_id=d.id and v.workspace_id=d.workspace_id
    where d.workspace_id=ws and d.id=any(sources) and d.lifecycle_state='active' and v.publication_state='ready' and v.data_classification='non_sensitive';
  if coalesce(jsonb_array_length(snapshot),0)<>cardinality(sources) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
  if (select count(*)>=100 from public.research_runs where workspace_id=ws)
    or (select count(*)>=10 from public.research_runs where plan_id=p_plan)
    or (select count(*)>=20 from public.research_runs where workspace_id=ws and mode='COMPARE') then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  r.id=gen_random_uuid(); admission_receipt=public.nexus_admit_account_operation(actor,'chat',r.id);
  if admission_receipt->>'status'<>'READY' then raise exception 'NR:BYOK_REQUIRED'; end if;
  insert into public.research_runs(id,workspace_id,owner_id,plan_id,idempotency_key,mode,questions,source_snapshot,admission,deadline)
    values(r.id,ws,actor,p_plan,p_key,'COMPARE',jsonb_build_array(draft.plan->>'question')||(draft.plan->'subquestions'),snapshot,
      admission_receipt,clock_timestamp()+interval '300 seconds') returning * into r;
  return public.nexus_research_run_view(r);
end; $$;

alter function public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text) rename to nexus_research_step_answers_v1;
create function public.nexus_research_step(p_context jsonb,p_operation text,p_id uuid,p_generation integer,p_position integer,
  p_token uuid default null,p_result jsonb default null,p_error text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r public.research_runs%rowtype; batches integer; criterion integer; batch integer; cells jsonb; source jsonb; cell jsonb;
  snapshot jsonb; batch_ids jsonb; citations jsonb; i integer;
begin
  perform public.workbench_authorize(p_context,'document.mutate');
  select * into r from public.research_runs where id=p_id and workspace_id=(p_context->>'workspace_id')::uuid
    and owner_id=(p_context->>'user_id')::uuid for update;
  if not found then raise exception 'NR:NOT_FOUND'; end if;
  if r.mode<>'COMPARE' then return public.nexus_research_step_answers_v1(p_context,p_operation,p_id,p_generation,p_position,p_token,p_result,p_error); end if;
  if r.generation<>p_generation or r.position<>p_position or r.state not in('queued','running') then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if r.deadline<=clock_timestamp() or not public.nexus_research_sources_current(r.workspace_id,r.source_snapshot) then
    update public.research_runs set state='interrupted',lease_token=null,error_code=case when r.deadline<=clock_timestamp() then 'RUN_DEADLINE' else 'SOURCE_UNAVAILABLE' end,
      updated_at=clock_timestamp() where id=r.id returning * into r;
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if p_operation='claim' then
    if r.state='running' then return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r)); end if;
    update public.research_runs set state='running',lease_token=gen_random_uuid(),updated_at=clock_timestamp() where id=r.id returning * into r;
    return jsonb_build_object('claimed',true,'token',r.lease_token,'run',public.nexus_research_run_view(r));
  end if;
  if r.state<>'running' or p_token is null or r.lease_token is distinct from p_token then
    return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
  end if;
  if p_operation='commit' then
    batches=(jsonb_array_length(r.source_snapshot)+7)/8; criterion=r.position/batches; batch=r.position%batches;
    select jsonb_agg(s order by ordinal),jsonb_agg(s->'document_id' order by ordinal) into snapshot,batch_ids
      from jsonb_array_elements(r.source_snapshot) with ordinality item(s,ordinal) where ordinal>batch*8 and ordinal<=batch*8+8;
    cells=p_result->'comparison'->'cells';
    if jsonb_typeof(p_result) is distinct from 'object' or octet_length(p_result::text)>76000
      or p_result->>'question' is distinct from r.questions->>criterion
      or jsonb_typeof(p_result->'answer') is distinct from 'string' or length(p_result->>'answer') not between 1 and 16000
      or p_result->'comparison'->>'schema_version' is distinct from 'research-comparison/1'
      or p_result->'comparison'->'criterion_index' is distinct from to_jsonb(criterion)
      or p_result->'comparison'->'batch_index' is distinct from to_jsonb(batch)
      or p_result->'comparison'->'batch_count' is distinct from to_jsonb(batches)
      or p_result->'comparison'->'total_documents' is distinct from to_jsonb(jsonb_array_length(r.source_snapshot))
      or p_result->'comparison'->>'interpretation' is distinct from 'REVIEW_REQUIRED_NO_AUTOMATIC_EQUIVALENCE_OR_RANKING'
      or jsonb_typeof(cells) is distinct from 'array' or jsonb_array_length(cells)<>jsonb_array_length(batch_ids)
      or coalesce(p_result->>'claim_state','') not in('REVIEW_REQUIRED','UNSUPPORTED')
      or jsonb_typeof(p_result->'abstained') is distinct from 'boolean'
      or jsonb_typeof(p_result->'validated_citation_ids') is distinct from 'array'
      or p_result->'coverage'->>'completeness' is distinct from 'NOT_EXHAUSTIVE'
      or coalesce(p_result->'coverage'->>'chunks_considered','')!~'^[0-9]{1,3}$' or (p_result->'coverage'->>'chunks_considered')::integer>200
      or coalesce(p_result->>'provider_cost_status','') not in('UNKNOWN','NOT_CALLED')
      or p_result->>'review_state' is distinct from 'COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED'
      or jsonb_typeof(p_result->'sources') is distinct from 'array' or jsonb_array_length(p_result->'sources')>8 then raise exception 'NR:INVALID_SCOPE'; end if;
    for source,i in select s,ordinal::integer from jsonb_array_elements(p_result->'sources') with ordinality item(s,ordinal) loop
      if source->>'citation_id' is distinct from 'S'||i::text or not batch_ids ? (source->>'document_id')
        or not exists(select 1 from public.document_chunks c where c.workspace_id=r.workspace_id
          and c.id=(source->>'chunk_id')::uuid and c.document_id=(source->>'document_id')::uuid
          and c.version_id=(source->>'version_id')::uuid and c.original_content_hash=source->>'original_content_hash'
          and c.original_content_hash=encode(sha256(convert_to(c.original_text,'UTF8')),'hex')
          and length(source->>'content') between 1 and 1200 and left(c.original_text,length(source->>'content'))=source->>'content'
          and c.location is not distinct from source->'location') then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    end loop;
    for cell,i in select c,ordinal::integer from jsonb_array_elements(cells) with ordinality item(c,ordinal) loop
      if cell->'document_id' is distinct from batch_ids->(i-1) or jsonb_typeof(cell->'answer') is distinct from 'string'
        or length(cell->>'answer') not between 1 and 240 or coalesce(cell->>'claim_state','') not in('REVIEW_REQUIRED','UNSUPPORTED')
        or jsonb_typeof(cell->'abstained') is distinct from 'boolean' or jsonb_typeof(cell->'validated_citation_ids') is distinct from 'array'
        then raise exception 'NR:INVALID_SCOPE'; end if;
      if cell->'abstained'='false'::jsonb then
        if cell->>'claim_state'<>'REVIEW_REQUIRED' or jsonb_array_length(cell->'validated_citation_ids')=0 or exists(
          select 1 from jsonb_array_elements_text(cell->'validated_citation_ids') citation where not exists(
            select 1 from jsonb_array_elements(p_result->'sources') s where s->>'citation_id'=citation and s->>'document_id'=cell->>'document_id'))
          then raise exception 'NR:INVALID_SCOPE'; end if;
      elsif cell->>'claim_state'<>'UNSUPPORTED' or jsonb_array_length(cell->'validated_citation_ids')<>0
        or coalesce(cell->>'gap','') not in('NO_INDEXED_EVIDENCE','INSUFFICIENT_OR_INVALIDLY_CITED') then raise exception 'NR:INVALID_SCOPE'; end if;
    end loop;
    select coalesce(jsonb_agg(to_jsonb(id) order by id),'[]') into citations from
      (select distinct jsonb_array_elements_text(c->'validated_citation_ids') id from jsonb_array_elements(cells) c) all_ids;
    if not (citations @> (p_result->'validated_citation_ids') and citations <@ (p_result->'validated_citation_ids'))
      or jsonb_array_length(citations)<>jsonb_array_length(p_result->'validated_citation_ids')
      or (p_result->>'abstained')::boolean is distinct from (jsonb_array_length(citations)=0)
      or p_result->>'claim_state' is distinct from (case when jsonb_array_length(citations)=0 then 'UNSUPPORTED' else 'REVIEW_REQUIRED' end)
      then raise exception 'NR:INVALID_SCOPE'; end if;
    update public.research_runs set results=results||jsonb_build_array(p_result),position=position+1,
      state=case when position+1=public.nexus_research_run_steps(r) then 'completed' else 'queued' end,
      lease_token=null,error_code=null,updated_at=clock_timestamp() where id=r.id returning * into r;
  elsif p_operation='interrupt' then
    if p_error is null or p_error!~'^[A-Z_]{1,64}$' then raise exception 'NR:INVALID_SCOPE'; end if;
    update public.research_runs set state='interrupted',lease_token=null,error_code=p_error,updated_at=clock_timestamp() where id=r.id returning * into r;
  else raise exception 'NR:INVALID_SCOPE'; end if;
  return jsonb_build_object('claimed',false,'run',public.nexus_research_run_view(r));
end; $$;

alter table public.findings drop constraint findings_source_research_position_check;
alter table public.findings add constraint findings_source_research_position_check check(source_research_position between 0 and 44);
create or replace function public.nexus_research_finding_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-finding/1','max_result_index',44);
$$;
create or replace function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb; r public.research_runs%rowtype; answer jsonb; quotes jsonb; available boolean;
begin
  f=public.workbench_finding(p_context,'read',p_id,'{}',null,null,null);
  if f->>'source_research_position' is null then return f; end if;
  select * into r from public.research_runs where workspace_id=(p_context->>'workspace_id')::uuid and id=(f->>'source_research_run_id')::uuid;
  answer=r.results->(f->>'source_research_position')::integer;
  available=coalesce(r.id is not null and answer is not null and public.nexus_research_sources_current(r.workspace_id,r.source_snapshot),false);
  if available then
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'document_id',c.document_id,'version_id',c.version_id,
      'citation_id',s->>'citation_id','filename',d.filename,'original_text',c.original_text,
      'original_content_hash',c.original_content_hash,'location',c.location,'available',true,'freshness','current') order by ordinal),'[]'::jsonb) into quotes
      from jsonb_array_elements(answer->'sources') with ordinality source(s,ordinal)
      join public.document_chunks c on c.workspace_id=r.workspace_id and c.id=(s->>'chunk_id')::uuid
        and c.document_id=(s->>'document_id')::uuid and c.version_id=(s->>'version_id')::uuid
        and c.original_content_hash=s->>'original_content_hash' and encode(sha256(convert_to(c.original_text,'UTF8')),'hex')=s->>'original_content_hash'
      join public.documents d on d.workspace_id=c.workspace_id and d.id=c.document_id where answer->'validated_citation_ids' ? (s->>'citation_id');
    available=jsonb_array_length(quotes)>0 and jsonb_array_length(quotes)=jsonb_array_length(answer->'validated_citation_ids');
  end if;
  return f||jsonb_build_object('source_unavailable',not available,'generated_markdown',case when available then f->'generated_markdown' else 'null'::jsonb end,
    'evidence',case when available then quotes else '[]'::jsonb end,
    'research_origin',jsonb_build_object('run_id',f->'source_research_run_id','result_index',f->'source_research_position','plan_id',r.plan_id,
      'question',case when available then answer->>'question' end,'comparison',case when available then answer->'comparison' end,
      'claim_state','REVIEW_REQUIRED','completion_criteria','NOT_AUTOMATICALLY_VERIFIED','source_state',case when available then 'CURRENT' else 'UNAVAILABLE_OR_CHANGED' end),
    'export_state','RIGHTS_REVIEW_REQUIRED');
end; $$;
alter function public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) rename to nexus_finding_answers_v1;
create function public.nexus_finding(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid; r public.research_runs%rowtype;
  existing public.findings%rowtype; answer jsonb; position integer; result jsonb; role_name text;
begin
  if p_operation<>'create' or coalesce(p_command->>'result_index','')~'^[0-4]$' or not(p_command ? 'research_run_id') then
    return public.nexus_finding_answers_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);
  end if;
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if role_name is null or role_name not in('editor','admin','owner') then raise exception 'NR:FORBIDDEN'; end if;
  if p_command->>'run_id' is not null or coalesce(p_command->>'result_index','')!~'^([5-9]|[1-3][0-9]|4[0-4])$' then raise exception 'NR:INVALID_SCOPE'; end if;
  position=(p_command->>'result_index')::integer;
  select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  if existing.id is null then
    select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
    if not found or r.mode<>'COMPARE' then raise exception 'NR:NOT_FOUND'; end if;
    answer=r.results->position;
    if position>=r.position or answer is null then raise exception 'NR:VERSION_CONFLICT'; end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    if answer->>'claim_state'<>'REVIEW_REQUIRED' or answer->'abstained' is distinct from 'false'::jsonb
      or coalesce(jsonb_array_length(answer->'validated_citation_ids'),0)=0 then raise exception 'NR:EVIDENCE_REQUIRED'; end if;
  end if;
  result=public.workbench_finding(p_context,'create',null,p_command,p_revision,p_key,p_hash);
  p_id=(result->>'id')::uuid;
  if existing.id is null then
    update public.findings set source_research_run_id=r.id,source_research_position=position where id=p_id;
    update public.finding_versions set generated_markdown=answer->>'answer' where workspace_id=ws and finding_id=p_id and revision=1;
  end if;
  result=public.nexus_research_finding_view(p_context,p_id);
  if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  return result;
end; $$;

revoke all on function public.nexus_research_run_steps(public.research_runs),public.nexus_research_comparison_contract(),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nexus_research_run_steps(public.research_runs),public.nexus_research_comparison_contract(),
  public.nexus_research_run(jsonb,text,uuid,uuid,text,jsonb,integer,uuid),public.nexus_research_step(jsonb,text,uuid,integer,integer,uuid,jsonb,text),
  public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) to service_role;
