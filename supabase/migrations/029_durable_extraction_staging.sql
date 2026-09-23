-- Candidate only. Preserve one bounded extraction across resumable vector batches.
-- Staging remains service-role-only and is removed on terminal job transitions.
begin;

create table if not exists public.ingestion_extraction_manifests (
  job_id uuid primary key references public.ingestion_jobs(id) on delete cascade,
  workspace_id uuid not null,
  document_id uuid not null,
  version_id uuid not null,
  total_chunks integer not null check (total_chunks between 1 and 400),
  extraction_manifest jsonb not null check (jsonb_typeof(extraction_manifest) = 'object'),
  total_bytes bigint not null check (total_bytes between 1 and 4194304),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '24 hours')
);

create index if not exists ingestion_extraction_manifests_expires_at_idx
  on public.ingestion_extraction_manifests(expires_at);

create table if not exists public.ingestion_extraction_chunks (
  job_id uuid not null references public.ingestion_extraction_manifests(job_id) on delete cascade,
  chunk_index integer not null check (chunk_index between 0 and 399),
  original_text text not null check (octet_length(original_text) between 1 and 32768),
  original_content_hash text not null check (original_content_hash ~ '^[0-9a-f]{64}$'),
  location jsonb not null check (jsonb_typeof(location) = 'object'),
  primary key (job_id, chunk_index)
);

alter table public.ingestion_extraction_manifests enable row level security;
alter table public.ingestion_extraction_chunks enable row level security;
revoke all on public.ingestion_extraction_manifests from public, anon, authenticated;
revoke all on public.ingestion_extraction_chunks from public, anon, authenticated;
grant select, insert, update, delete on public.ingestion_extraction_manifests to service_role;
grant select, insert, delete on public.ingestion_extraction_chunks to service_role;

create or replace function public.workbench_store_extracted_chunks(
  p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint,
  p_space text, p_index text, p_manifest jsonb, p_total_chunks integer, p_chunks jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  j public.ingestion_jobs%rowtype;
  v public.document_versions%rowtype;
  saved public.ingestion_extraction_manifests%rowtype;
  item jsonb;
  existing public.ingestion_extraction_chunks%rowtype;
  i integer := 0;
  total_bytes bigint := 0;
  expected_manifest jsonb;
begin
  j := public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);
  if j.kind <> 'ingestion' or p_space is null or length(p_space) not between 1 and 200
     or p_index is null or length(p_index) not between 1 and 200
     or p_manifest is null or jsonb_typeof(p_manifest) <> 'object'
     or octet_length(p_manifest::text) > 8192
     or p_total_chunks not between 1 and 400
     or p_chunks is null or jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) <> p_total_chunks
     or octet_length(p_chunks::text) > 4194304 then
    raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';
  end if;

  for item in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(item) <> 'object'
       or (item->>'ordinal')::integer is distinct from i
       or length(coalesce(item->>'original_text','')) = 0
       or octet_length(item->>'original_text') > 32768
       or item->>'original_content_hash' !~ '^[0-9a-f]{64}$'
       or item->>'original_content_hash' <> encode(sha256(convert_to(item->>'original_text','UTF8')),'hex')
       or jsonb_typeof(item->'location') <> 'object' then
      raise exception 'NR:INVALID_SCOPE';
    end if;
    total_bytes := total_bytes + octet_length(item->>'original_text');
    if total_bytes > 4194304 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED'; end if;
    i := i + 1;
  end loop;

  expected_manifest := p_manifest || jsonb_build_object('expected_chunks',p_total_chunks);
  select * into strict v from public.document_versions
    where workspace_id=p_workspace and document_id=j.document_id and id=p_version for update;
  if v.publication_state='staged' then
    update public.document_versions set publication_state='processing',embedding_space_id=p_space,
      index_generation=p_index,extraction_manifest=expected_manifest,staged_by_generation=p_generation,
      staged_manifest_hash=null where workspace_id=p_workspace and id=p_version returning * into v;
  elsif v.publication_state='processing' then
    if v.embedding_space_id is distinct from p_space
       or v.index_generation is distinct from p_index
       or v.extraction_manifest is distinct from expected_manifest then
      raise exception 'NR:VERSION_CONFLICT';
    end if;
    update public.document_versions set staged_by_generation=p_generation
      where workspace_id=p_workspace and id=p_version;
  else
    raise exception 'NR:VERSION_CONFLICT';
  end if;

  insert into public.ingestion_extraction_manifests(
    job_id,workspace_id,document_id,version_id,total_chunks,extraction_manifest,total_bytes,expires_at
  ) values (
    p_job,p_workspace,j.document_id,p_version,p_total_chunks,p_manifest,total_bytes,clock_timestamp()+interval '24 hours'
  ) on conflict (job_id) do nothing;
  select * into strict saved from public.ingestion_extraction_manifests where job_id=p_job for update;
  if saved.workspace_id is distinct from p_workspace
     or saved.document_id is distinct from j.document_id
     or saved.version_id is distinct from p_version
     or saved.total_chunks is distinct from p_total_chunks
     or saved.extraction_manifest is distinct from p_manifest
     or saved.total_bytes is distinct from total_bytes then
    raise exception 'NR:VERSION_CONFLICT';
  end if;

  i := 0;
  for item in select value from jsonb_array_elements(p_chunks) loop
    insert into public.ingestion_extraction_chunks(
      job_id,chunk_index,original_text,original_content_hash,location
    ) values (
      p_job,(item->>'ordinal')::integer,item->>'original_text',item->>'original_content_hash',item->'location'
    ) on conflict (job_id,chunk_index) do nothing;
    select * into strict existing from public.ingestion_extraction_chunks
      where job_id=p_job and chunk_index=(item->>'ordinal')::integer;
    if existing.original_text is distinct from item->>'original_text'
       or existing.original_content_hash is distinct from item->>'original_content_hash'
       or existing.location is distinct from item->'location' then
      raise exception 'NR:VERSION_CONFLICT';
    end if;
    i := i + 1;
  end loop;

  return jsonb_build_object('found',true,'count',p_total_chunks,'total_bytes',total_bytes,
                            'total_chunks',p_total_chunks,'manifest',p_manifest);
end
$fn$;

create or replace function public.workbench_read_extracted_batch(
  p_job uuid, p_workspace uuid, p_owner text, p_generation bigint, p_version uuid, p_epoch bigint,
  p_offset integer, p_limit integer
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  j public.ingestion_jobs%rowtype;
  saved public.ingestion_extraction_manifests%rowtype;
  result_chunks jsonb;
  expected integer;
begin
  j := public.assert_workbench_lease(p_job,p_workspace,p_owner,p_generation,p_version,p_epoch);
  if j.kind <> 'ingestion' or p_offset < 0 or p_limit not between 1 and 3 then
    raise exception 'NR:RESOURCE_LIMIT_EXCEEDED';
  end if;
  select * into saved from public.ingestion_extraction_manifests where job_id=p_job for update;
  if not found then
    if p_offset=0 then return jsonb_build_object('found',false); end if;
    raise exception 'NR:VERSION_CONFLICT';
  end if;
  if saved.workspace_id is distinct from p_workspace
     or saved.document_id is distinct from j.document_id
     or saved.version_id is distinct from p_version
     or p_offset >= saved.total_chunks then
    raise exception 'NR:VERSION_CONFLICT';
  end if;
  update public.ingestion_extraction_manifests set expires_at=clock_timestamp()+interval '24 hours'
    where job_id=p_job;
  expected := least(p_limit,saved.total_chunks-p_offset);
  select jsonb_agg(jsonb_build_object(
    'ordinal',c.chunk_index,'original_text',c.original_text,
    'original_content_hash',c.original_content_hash,'location',c.location
  ) order by c.chunk_index)
    into result_chunks
    from (
      select chunk_index,original_text,original_content_hash,location
      from public.ingestion_extraction_chunks
      where job_id=p_job and chunk_index>=p_offset
      order by chunk_index limit p_limit
    ) c;
  if coalesce(jsonb_array_length(result_chunks),0) <> expected then
    raise exception 'NR:INGESTION_FAILED';
  end if;
  return jsonb_build_object('found',true,'total_chunks',saved.total_chunks,
                            'manifest',saved.extraction_manifest,'chunks',result_chunks);
end
$fn$;

create or replace function public.workbench_cleanup_expired_extractions(p_limit integer default 50)
returns integer language plpgsql security definer set search_path=public,pg_temp as $fn$
declare removed integer;
begin
  if p_limit not between 1 and 500 then raise exception 'NR:RESOURCE_LIMIT_EXCEEDED'; end if;
  delete from public.ingestion_extraction_manifests m
   where m.job_id in (
     select job_id from public.ingestion_extraction_manifests
      where expires_at<=clock_timestamp() order by expires_at limit p_limit for update skip locked
   );
  get diagnostics removed = row_count;
  return removed;
end
$fn$;

create or replace function public.cleanup_terminal_ingestion_extraction()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $fn$
begin
  if new.status in ('completed','failed','cancelled') and old.status is distinct from new.status then
    delete from public.ingestion_extraction_manifests where job_id=new.id;
  end if;
  return new;
end
$fn$;

drop trigger if exists cleanup_terminal_ingestion_extraction on public.ingestion_jobs;
create trigger cleanup_terminal_ingestion_extraction
after update of status on public.ingestion_jobs
for each row execute function public.cleanup_terminal_ingestion_extraction();

revoke execute on function public.workbench_store_extracted_chunks(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,jsonb) from public,anon,authenticated;
revoke execute on function public.workbench_read_extracted_batch(uuid,uuid,text,bigint,uuid,bigint,integer,integer) from public,anon,authenticated;
revoke execute on function public.workbench_cleanup_expired_extractions(integer) from public,anon,authenticated;
grant execute on function public.workbench_store_extracted_chunks(uuid,uuid,text,bigint,uuid,bigint,text,text,jsonb,integer,jsonb) to service_role;
grant execute on function public.workbench_read_extracted_batch(uuid,uuid,text,bigint,uuid,bigint,integer,integer) to service_role;
grant execute on function public.workbench_cleanup_expired_extractions(integer) to service_role;

commit;