-- Emit creation only for the first successful mutation, not idempotent retries.
-- Existing workspace serialization and every validation/property remain unchanged.
-- Forward-only: no existing Finding, version or audit history is rewritten.

create or replace function public.nexus_finding_answers_v1(
  p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare role_name text; result jsonb; ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
  r public.research_runs%rowtype; answer jsonb; position integer; existing public.findings%rowtype;
begin
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if p_operation not in('read','versions') and (role_name is null or role_name not in('editor','admin','owner'))
    then raise exception 'NR:FORBIDDEN'; end if;
  if p_operation='create' then
    select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  end if;
  if p_operation='create' and (p_command ? 'research_run_id' or p_command ? 'result_index') then
    if p_command->>'run_id' is not null or coalesce(p_command->>'result_index','')!~'^[0-4]$'
      or p_command->>'research_run_id' is null then raise exception 'NR:INVALID_SCOPE'; end if;
    position=(p_command->>'result_index')::integer;
    if existing.id is null then
      select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
      if not found then raise exception 'NR:NOT_FOUND'; end if;
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
      result=public.nexus_research_finding_view(p_context,p_id);
      if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    end if;
  else
    if p_operation='review' then
      result=public.nexus_research_finding_view(p_context,p_id);
      if result->>'source_research_position' is not null and (result->>'source_unavailable')::boolean
        then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    end if;
    result=public.workbench_finding(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);
  end if;
  if p_operation not in('read','versions') and (p_operation<>'create' or existing.id is null) then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.'||p_operation,'finding',coalesce(p_id::text,result->>'id'),
        jsonb_build_object('revision',result->'revision'));
  end if;
  if p_operation='delete' then return result; end if;
  return public.nexus_research_finding_view(p_context,coalesce(p_id,(result->>'id')::uuid));
end; $$;

create or replace function public.nexus_finding_comparison_v1(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
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
  if existing.id is null then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end; $$;

create or replace function public.nexus_finding_timeline_v1(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;r public.research_runs%rowtype;
  existing public.findings%rowtype;answer jsonb;result jsonb;position integer;role_name text;
begin
  if p_operation<>'create' or coalesce(p_command->>'result_index','')!~'^([5-9]|[1-3][0-9]|4[0-4])$' or not(p_command ? 'research_run_id') then
    return public.nexus_finding_comparison_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);
  end if;
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if role_name is null or role_name not in('editor','admin','owner') then raise exception 'NR:FORBIDDEN'; end if;
  select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
  if r.mode is distinct from 'TIMELINE' then return public.nexus_finding_comparison_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash); end if;
  if p_command->>'run_id' is not null then raise exception 'NR:INVALID_SCOPE'; end if;
  position=(p_command->>'result_index')::integer;
  select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  if existing.id is null then
    answer=r.results->position;
    if position>=r.position or answer is null then raise exception 'NR:VERSION_CONFLICT'; end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    if answer->>'claim_state'<>'REVIEW_REQUIRED' or answer->'abstained' is distinct from 'false'::jsonb or coalesce(jsonb_array_length(answer->'validated_citation_ids'),0)=0 then raise exception 'NR:EVIDENCE_REQUIRED'; end if;
  end if;
  result=public.workbench_finding(p_context,'create',null,p_command,p_revision,p_key,p_hash);p_id=(result->>'id')::uuid;
  if existing.id is null then
    update public.findings set source_research_run_id=r.id,source_research_position=position where id=p_id;
    update public.finding_versions set generated_markdown=answer->>'answer' where workspace_id=ws and finding_id=p_id and revision=1;
  end if;
  result=public.nexus_research_finding_view(p_context,p_id);
  if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
  if existing.id is null then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end; $$;

create or replace function public.nexus_finding_deep_v1(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare ws uuid=(p_context->>'workspace_id')::uuid;actor uuid=(p_context->>'user_id')::uuid;r public.research_runs%rowtype;
  existing public.findings%rowtype;answer jsonb;result jsonb;position integer;role_name text;
begin
  if p_operation<>'create' or coalesce(p_command->>'result_index','')!~'^([5-9]|10)$' or not(p_command ? 'research_run_id') then
    return public.nexus_finding_timeline_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);
  end if;
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if role_name is null or role_name not in('editor','admin','owner') then raise exception 'NR:FORBIDDEN'; end if;
  select * into r from public.research_runs where id=(p_command->>'research_run_id')::uuid and workspace_id=ws and owner_id=actor for update;
  if r.mode is distinct from 'CONTRADICTION_ANALYSIS' then return public.nexus_finding_timeline_v1(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash); end if;
  if p_command->>'run_id' is not null then raise exception 'NR:INVALID_SCOPE'; end if;
  position=(p_command->>'result_index')::integer;
  select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
  if existing.id is null then
    answer=r.results->position;
    if position>=r.position or answer is null then raise exception 'NR:VERSION_CONFLICT'; end if;
    if not public.nexus_research_sources_current(ws,r.source_snapshot) then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
    if answer->>'claim_state'<>'REVIEW_REQUIRED' or answer->'abstained' is distinct from 'false'::jsonb or coalesce(jsonb_array_length(answer->'validated_citation_ids'),0)=0 then raise exception 'NR:EVIDENCE_REQUIRED'; end if;
  end if;
  result=public.workbench_finding(p_context,'create',null,p_command,p_revision,p_key,p_hash);p_id=(result->>'id')::uuid;
  if existing.id is null then
    update public.findings set source_research_run_id=r.id,source_research_position=position where id=p_id;
    update public.finding_versions set generated_markdown=answer->>'answer' where workspace_id=ws and finding_id=p_id and revision=1;
  end if;
  result=public.nexus_research_finding_view(p_context,p_id);
  if (result->>'source_unavailable')::boolean then raise exception 'NR:SOURCE_UNAVAILABLE'; end if;
  if existing.id is null then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end; $$;

create or replace function public.nexus_finding_obligations_v1(p_context jsonb,p_operation text,p_id uuid,p_command jsonb,p_revision bigint,p_key text,p_hash text)
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
  if existing.id is null then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.create','finding',p_id::text,jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end; $$;
