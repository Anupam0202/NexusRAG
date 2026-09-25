-- Candidate only. Adds idempotent bounded chunk-batch staging for Worker ingestion.
-- The existing all-at-once workbench_stage_chunks API remains unchanged.
begin;

create or replace function public.workbench_stage_chunk_batch(
  p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint,
  p_space text, p_index text, p_manifest jsonb, p_total_chunks integer, p_offset integer, p_chunks jsonb
) returns jsonb language plpgsql set search_path=public,pg_temp as $fn$
declare
  j public.ingestion_jobs%rowtype;
  v public.document_versions%rowtype;
  item jsonb;
  existing public.document_chunks%rowtype;
  i integer := 0;
  total bigint;
  lo integer;
  hi integer;
  manifest_hash text;
  expected_manifest jsonb;
begin
  j := public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);
  if j.kind <> 'ingestion' or p_space is null or length(p_space) not between 1 and 200
     or p_index is null or length(p_index) not between 1 and 200
     or p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or octet_length(p_manifest::text) > 8192
     or p_total_chunks not between 1 and 400 or p_offset < 0
     or p_chunks is null or jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) not between 1 and 3
     or p_offset + jsonb_array_length(p_chunks) > p_total_chunks then
    raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';
  end if;
  expected_manifest := p_manifest || jsonb_build_object('expected_chunks',p_total_chunks);
  select * into strict v from public.document_versions
    where workspace_id=p_workspace and document_id=j.document_id and id=p_version for update;
  if v.publication_state='staged' then
    if p_offset <> 0 then raise exception 'NR:VERSION_CONFLICT'; end if;
    delete from public.document_chunks where workspace_id=p_workspace and version_id=p_version;
    update public.document_versions set publication_state='processing',embedding_space_id=p_space,
      index_generation=p_index,extraction_manifest=expected_manifest,staged_by_generation=p_generation,
      staged_manifest_hash=null where workspace_id=p_workspace and id=p_version returning * into v;
  elsif v.publication_state='processing' then
    if v.embedding_space_id is distinct from p_space or v.index_generation is distinct from p_index
       or v.extraction_manifest is distinct from expected_manifest then
      raise exception 'NR:VERSION_CONFLICT';
    end if;
  else
    raise exception 'NR:VERSION_CONFLICT';
  end if;

  for item in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(item) <> 'object'
       or (item->>'workspace_id')::uuid is distinct from p_workspace
       or (item->>'document_id')::uuid is distinct from j.document_id
       or (item->>'version_id')::uuid is distinct from p_version
       or (item->>'ordinal')::integer is distinct from p_offset+i
       or item->>'chunk_id' !~ '^[0-9a-f-]{36}$'
       or length(coalesce(item->>'original_text',''))=0
       or octet_length(item->>'original_text') > 32768
       or item->>'original_content_hash' !~ '^[0-9a-f]{64}$'
       or item->>'original_content_hash' <> encode(sha256(convert_to(item->>'original_text','UTF8')),'hex') then
      raise exception 'NR:INVALID_SCOPE';
    end if;
    insert into public.document_chunks(
      id,workspace_id,document_id,version_id,chunk_index,content,content_hash,original_text,
      original_content_hash,enrichment_text,location,embedding_space_id,qdrant_point_id,metadata
    ) values (
      (item->>'chunk_id')::uuid,p_workspace,j.document_id,p_version,(item->>'ordinal')::integer,
      item->>'original_text',item->>'original_content_hash',item->>'original_text',
      item->>'original_content_hash',coalesce(item->>'retrieval_text',item->>'original_text'),
      coalesce(item->'location','{}'::jsonb),p_space,item->>'chunk_id',
      jsonb_build_object('extraction',coalesce(item->'extraction','{}'::jsonb))
    ) on conflict do nothing;
    select * into strict existing from public.document_chunks
      where workspace_id=p_workspace and version_id=p_version and chunk_index=p_offset+i;
    if existing.id::text <> item->>'chunk_id'
       or existing.original_content_hash <> item->>'original_content_hash'
       or existing.original_text <> item->>'original_text' then
      raise exception 'NR:VERSION_CONFLICT';
    end if;
    i := i+1;
  end loop;
  select count(*),min(chunk_index),max(chunk_index) into total,lo,hi
    from public.document_chunks where workspace_id=p_workspace and version_id=p_version;
  if total > p_total_chunks or (total > 0 and (lo<>0 or hi<>total-1)) then
    raise exception 'NR:VERSION_CONFLICT';
  end if;
  select encode(sha256(convert_to(string_agg(id::text||':'||original_content_hash,',' order by chunk_index),'UTF8')),'hex')
    into manifest_hash from public.document_chunks where workspace_id=p_workspace and version_id=p_version;
  update public.document_versions set staged_by_generation=p_generation,
    staged_manifest_hash=manifest_hash where workspace_id=p_workspace and id=p_version;
  return jsonb_build_object('count',total,'expected_chunks',p_total_chunks,'manifest_hash',manifest_hash,
                            'next_offset',p_offset+jsonb_array_length(p_chunks));
end
$fn$;

create or replace function public.workbench_finalize_chunk_stage(
  p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint,
  p_total_chunks integer, p_index text
) returns jsonb language plpgsql set search_path=public,pg_temp as $fn$
declare
  j public.ingestion_jobs%rowtype;
  v public.document_versions%rowtype;
  total bigint;
  lo integer;
  hi integer;
  manifest_hash text;
begin
  j := public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);
  if j.kind <> 'ingestion' or p_total_chunks not between 1 and 400 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED'; end if;
  select * into strict v from public.document_versions
    where workspace_id=p_workspace and document_id=j.document_id and id=p_version for update;
  if v.publication_state<>'processing' or v.staged_by_generation<>p_generation
     or v.index_generation is distinct from p_index
     or (v.extraction_manifest->>'expected_chunks')::integer is distinct from p_total_chunks then
    raise exception 'NR:VERSION_CONFLICT';
  end if;
  select count(*),min(chunk_index),max(chunk_index) into total,lo,hi
    from public.document_chunks where workspace_id=p_workspace and version_id=p_version;
  if total<>p_total_chunks or lo<>0 or hi<>p_total_chunks-1 then raise exception 'NR:INGESTION_FAILED'; end if;
  select encode(sha256(convert_to(string_agg(id::text||':'||original_content_hash,',' order by chunk_index),'UTF8')),'hex')
    into manifest_hash from public.document_chunks where workspace_id=p_workspace and version_id=p_version;
  update public.document_versions set staged_manifest_hash=manifest_hash where workspace_id=p_workspace and id=p_version;
  return jsonb_build_object('count',total,'manifest_hash',manifest_hash,'index_generation',p_index);
end
$fn$;

revoke execute on function public.workbench_stage_chunk_batch(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,integer,jsonb) from public,anon,authenticated;
revoke execute on function public.workbench_finalize_chunk_stage(uuid,uuid,text,bigint,uuid,bigint,integer,text) from public,anon,authenticated;
grant execute on function public.workbench_stage_chunk_batch(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,integer,jsonb) to service_role;
grant execute on function public.workbench_finalize_chunk_stage(uuid,uuid,text,bigint,uuid,bigint,integer,text) to service_role;
commit;
