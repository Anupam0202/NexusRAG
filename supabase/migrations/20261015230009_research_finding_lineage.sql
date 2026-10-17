-- Link a saved answer to the existing versioned Findings/Review workflow.
-- Installation performs no research, provider processing or existing-record update.
alter table public.findings
  add column source_research_run_id uuid references public.research_runs(id) on delete set null,
  add column source_research_position integer check(source_research_position between 0 and 4),
  add constraint findings_research_origin_check check(
    source_research_run_id is null or (source_research_position is not null and source_run_id is null));
create index findings_workspace_research_idx on public.findings(workspace_id,source_research_run_id)
  where source_research_position is not null;

create function public.nexus_research_finding_contract()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
  select jsonb_build_object('schema_version','research-finding/1');
$$;

create function public.nexus_research_finding_view(p_context jsonb,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb; r public.research_runs%rowtype; answer jsonb; quotes jsonb; available boolean;
begin
  f=public.workbench_finding(p_context,'read',p_id,'{}',null,null,null);
  if f->>'source_research_position' is null then return f; end if;
  select * into r from public.research_runs where workspace_id=(p_context->>'workspace_id')::uuid
    and id=(f->>'source_research_run_id')::uuid;
  answer=r.results->(f->>'source_research_position')::integer;
  available=coalesce(r.id is not null and answer is not null
    and public.nexus_research_sources_current(r.workspace_id,r.source_snapshot),false);
  if available then
    select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'document_id',c.document_id,'version_id',c.version_id,
      'citation_id',s->>'citation_id','filename',d.filename,'original_text',c.original_text,
      'original_content_hash',c.original_content_hash,'location',c.location,'available',true,'freshness','current')
      order by ordinal),'[]'::jsonb) into quotes
      from jsonb_array_elements(answer->'sources') with ordinality source(s,ordinal)
      join public.document_chunks c on c.workspace_id=r.workspace_id and c.id=(s->>'chunk_id')::uuid
        and c.document_id=(s->>'document_id')::uuid and c.version_id=(s->>'version_id')::uuid
        and c.original_content_hash=s->>'original_content_hash'
        and encode(sha256(convert_to(c.original_text,'UTF8')),'hex')=s->>'original_content_hash'
      join public.documents d on d.workspace_id=c.workspace_id and d.id=c.document_id
      where answer->'validated_citation_ids' ? (s->>'citation_id');
    available=jsonb_array_length(quotes)>0
      and jsonb_array_length(quotes)=jsonb_array_length(answer->'validated_citation_ids');
  end if;
  return f||jsonb_build_object('source_unavailable',not available,
    'generated_markdown',case when available then f->'generated_markdown' else 'null'::jsonb end,
    'evidence',case when available then quotes else '[]'::jsonb end,
    'research_origin',jsonb_build_object('run_id',f->'source_research_run_id','result_index',f->'source_research_position',
      'plan_id',r.plan_id,'question',case when available then answer->>'question' end,
      'claim_state','REVIEW_REQUIRED','completion_criteria','NOT_AUTOMATICALLY_VERIFIED',
      'source_state',case when available then 'CURRENT' else 'UNAVAILABLE_OR_CHANGED' end),
    'export_state','RIGHTS_REVIEW_REQUIRED');
end; $$;

create or replace function public.nexus_finding(
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
  if p_operation='create' and (p_command ? 'research_run_id' or p_command ? 'result_index') then
    if p_command->>'run_id' is not null or coalesce(p_command->>'result_index','')!~'^[0-4]$'
      or p_command->>'research_run_id' is null then raise exception 'NR:INVALID_SCOPE'; end if;
    position=(p_command->>'result_index')::integer;
    select * into existing from public.findings where workspace_id=ws and owner_id=actor and create_key=p_key;
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
  if p_operation not in('read','versions') then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.'||p_operation,'finding',coalesce(p_id::text,result->>'id'),
        jsonb_build_object('revision',result->'revision'));
  end if;
  if p_operation='delete' then return result; end if;
  return public.nexus_research_finding_view(p_context,coalesce(p_id,(result->>'id')::uuid));
end; $$;

-- Existing user-authored exports remain unchanged. New research-derived text
-- is not a manual note and needs an adopted source/export rights decision.
create or replace function public.nexus_record_finding_export(
  p_context jsonb,p_finding uuid,p_revision bigint,p_manifest_text text,p_hash text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare f jsonb; manifest jsonb; receipt public.evidence_exports%rowtype; role_name text;
begin
  perform 1 from public.workspaces where id=(p_context->>'workspace_id')::uuid for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=(p_context->>'workspace_id')::uuid
    and user_id=(p_context->>'user_id')::uuid;
  if role_name not in('editor','admin','owner') or role_name is null then raise exception 'NR:FORBIDDEN'; end if;
  perform 1 from public.findings where workspace_id=(p_context->>'workspace_id')::uuid and id=p_finding for update;
  f=public.nexus_research_finding_view(p_context,p_finding);
  if (f->>'revision')::bigint is distinct from p_revision then raise exception 'NR:VERSION_CONFLICT'; end if;
  if f->>'source_run_id' is not null or f->>'source_research_position' is not null then raise exception 'NR:RIGHTS_BLOCKED'; end if;
  if p_manifest_text is null or octet_length(p_manifest_text)>100000
    or encode(sha256(convert_to(p_manifest_text,'UTF8')),'hex') is distinct from p_hash then raise exception 'NR:INVALID_SCOPE'; end if;
  manifest=p_manifest_text::jsonb;
  if manifest->>'finding_id' is distinct from p_finding::text
    or manifest->>'workspace_id' is distinct from p_context->>'workspace_id'
    or (manifest->>'revision')::bigint is distinct from p_revision
    or manifest->>'title' is distinct from f->>'title'
    or manifest->>'authored_markdown' is distinct from f->>'authored_markdown'
    or manifest->'reviews' is distinct from f->'reviews'
    or manifest->'evidence' is distinct from f->'evidence' then raise exception 'NR:VERSION_CONFLICT'; end if;
  insert into public.evidence_exports(workspace_id,requested_by,format,state,manifest_hash)
    values((p_context->>'workspace_id')::uuid,(p_context->>'user_id')::uuid,'JSON_LD','ready',p_hash) returning * into receipt;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(receipt.workspace_id,receipt.requested_by,'finding.export','finding',p_finding::text,
      jsonb_build_object('revision',p_revision,'manifest_hash',p_hash,'export_id',receipt.id));
  return to_jsonb(receipt);
end; $$;

create function public.nexus_redact_removed_research_finding_text()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.finding_versions v set generated_markdown=null from public.findings f
    where f.workspace_id=old.workspace_id and f.source_research_run_id=old.id
      and v.workspace_id=f.workspace_id and v.finding_id=f.id;
  return old;
end; $$;
create trigger research_run_finding_text_removed before delete on public.research_runs
  for each row execute function public.nexus_redact_removed_research_finding_text();

revoke all on function public.nexus_research_finding_contract(),public.nexus_research_finding_view(jsonb,uuid),public.nexus_redact_removed_research_finding_text() from public,anon,authenticated;
grant execute on function public.nexus_research_finding_contract(),public.nexus_research_finding_view(jsonb,uuid),public.nexus_redact_removed_research_finding_text() to service_role;
