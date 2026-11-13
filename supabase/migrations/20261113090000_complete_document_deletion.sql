-- Lets a document deletion finish.
--
-- Before this migration no deletion could complete. Deleting a document marks it as "deleting" (which hides it
-- from lists and answers at once) and records five things to clean up. The gateway knew how to remove two of
-- them (the stored original and the search index entries) and refused to go on while the other three were
-- open, so every deleted document stayed half-deleted for good, with its file, its index entries and its text
-- still stored. The final row delete would have failed as well, because versions, uploads and answer links
-- still pointed at the document.
--
-- After it:
--   * nexus_begin_document_purge closes the document's unfinished processing jobs and says whether a job may
--     still be writing. The gateway removes the original and the index entries only once nothing is writing.
--   * nexus_purge_document removes every row that belongs to the document in one transaction, blanks the
--     passages quoted from it in past answers, and writes the three remaining receipts in that same
--     transaction, so a receipt exists only if the rows are gone. Saved findings and research results that
--     used the document are the person's own work and are kept as they are (the existing triggers withdraw
--     their sharing and export rights); the receipt counts them, so it never implies they were erased.
--   * nexus_claim_document_purges hands unfinished deletions to the gateway's cron, with a growing delay
--     between attempts.
--   * A document that is the stored page of a Radar snapshot is refused before anything is marked.

begin;

-- An answer keeps its link to a source that has been removed. workbench_sources_available already treats a
-- missing document as "withhold this answer"; without the link, an answer that also used another, still
-- active document would be shown again.
alter table public.query_run_sources
  drop constraint if exists query_run_sources_workspace_id_document_id_version_id_fkey;

-- Same behaviour as before, plus one refusal: a deletion that cannot be finished is not started.
create or replace function public.tombstone_document(p_workspace uuid, p_document uuid, p_actor uuid)
returns uuid language plpgsql
set search_path to 'public', 'pg_temp' as $fn$
declare operation uuid; epoch bigint;
begin
  if not exists (select 1 from public.workspace_members
                  where workspace_id = p_workspace and user_id = p_actor and role in ('owner','admin','editor')) then
    raise exception 'Document mutation denied' using errcode = '42501';
  end if;
  perform 1 from public.documents
    where workspace_id = p_workspace and id = p_document and lifecycle_state = 'active' for update;
  if not found then
    raise exception 'Document unavailable or deletion already begun' using errcode = '40001';
  end if;
  -- Radar compares snapshots of stored pages; removing the page would break the history of a reviewed change.
  if exists (select 1 from public.radar_snapshots where workspace_id = p_workspace and document_id = p_document) then
    raise exception 'NR:DOCUMENT_IN_USE';
  end if;
  update public.documents set lifecycle_state = 'deleting', lifecycle_epoch = lifecycle_epoch + 1, revision = revision + 1
    where workspace_id = p_workspace and id = p_document returning lifecycle_epoch into epoch;
  update public.ingestion_jobs set cancellation_requested_at = clock_timestamp(), lease_generation = lease_generation + 1
    where workspace_id = p_workspace and document_id = p_document and status in ('processing','queued','retry_wait');
  insert into public.deletion_operations (workspace_id, resource_id, tombstone_epoch)
    values (p_workspace, p_document, epoch) returning id into operation;
  insert into public.deletion_targets (workspace_id, operation_id, kind, resource_id, bucket, object_key)
    select p_workspace, operation, 'original', id, original_bucket, original_key
      from public.document_versions where workspace_id = p_workspace and document_id = p_document;
  insert into public.deletion_targets (workspace_id, operation_id, kind, resource_id, inventory)
    select p_workspace, operation, 'version_index', id,
           jsonb_build_object('index_generation', index_generation, 'embedding_space_id', embedding_space_id)
      from public.document_versions where workspace_id = p_workspace and document_id = p_document;
  insert into public.deletion_targets (workspace_id, operation_id, kind, resource_id)
    values (p_workspace, operation, 'chunks', p_document),
           (p_workspace, operation, 'derived_content_review', p_document),
           (p_workspace, operation, 'outstanding_remote_writes', p_document);
  insert into public.workbench_outbox (workspace_id, aggregate_id, aggregate_version, event_type)
    values (p_workspace, p_document, epoch, 'document.tombstoned');
  return operation;
end
$fn$;

-- Closes the document's unfinished processing jobs and returns the time until which one of them may still be
-- writing to the search index, or null when nothing can be. The tombstone has already taken every job's
-- lease away, so no new step can start; a step that was running then ends within two minutes at the latest
-- (one batch of three chunks, each call with its own deadline).
create function public.nexus_document_writers_until(p_workspace uuid, p_document uuid)
returns timestamptz language plpgsql
set search_path = pg_catalog, public as $fn$
declare until timestamptz;
begin
  update public.ingestion_jobs
     set status = 'cancelled', stage = 'cancelled', error_code = coalesce(error_code, 'CANCELLED'),
         completed_at = clock_timestamp(), cancellation_requested_at = coalesce(cancellation_requested_at, clock_timestamp()),
         lease_generation = lease_generation + 1, lease_owner = null, lease_expires_at = null
   where workspace_id = p_workspace and document_id = p_document
     and (status in ('queued','retry_wait')
          or (status = 'processing'
              and (lease_expires_at is null or lease_expires_at <= clock_timestamp()
                   or cancellation_requested_at <= clock_timestamp() - interval '2 minutes')));
  select max(least(lease_expires_at, coalesce(cancellation_requested_at, clock_timestamp()) + interval '2 minutes'))
    into until
    from public.ingestion_jobs
   where workspace_id = p_workspace and document_id = p_document and status = 'processing';
  return until;
end
$fn$;
revoke all on function public.nexus_document_writers_until(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_document_writers_until(uuid, uuid) to service_role;

-- First step of finishing a deletion. READY means the original and the index entries may be removed now.
create function public.nexus_begin_document_purge(p_workspace uuid, p_document uuid, p_operation uuid)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare op public.deletion_operations%rowtype; until timestamptz;
begin
  select * into op from public.deletion_operations
   where workspace_id = p_workspace and id = p_operation and resource_id = p_document for update;
  if not found then return jsonb_build_object('state','NOT_FOUND'); end if;
  if op.state = 'verified' then return jsonb_build_object('state','VERIFIED'); end if;
  perform 1 from public.documents
    where workspace_id = p_workspace and id = p_document and lifecycle_state = 'deleting' for update;
  if not found then return jsonb_build_object('state','NOT_FOUND'); end if;
  -- Only for deletions begun before the tombstone refused such documents.
  if exists (select 1 from public.radar_snapshots where workspace_id = p_workspace and document_id = p_document) then
    update public.deletion_operations set state = 'blocked' where id = p_operation;
    update public.deletion_targets set failure_code = 'RADAR_SNAPSHOT'
      where operation_id = p_operation and kind = 'derived_content_review' and verified_at is null;
    return jsonb_build_object('state','BLOCKED','reason','RADAR_SNAPSHOT');
  end if;
  until := public.nexus_document_writers_until(p_workspace, p_document);
  if until is not null then
    update public.deletion_operations set state = 'pending' where id = p_operation;
    return jsonb_build_object('state','WAITING','reason','JOB_RUNNING','retry_at', until);
  end if;
  update public.deletion_operations set state = 'cleaning' where id = p_operation;
  return jsonb_build_object('state','READY');
end
$fn$;
revoke all on function public.nexus_begin_document_purge(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_begin_document_purge(uuid, uuid, uuid) to service_role;

-- Last step: removes every row that belongs to the document and records what was removed. It refuses while
-- the original or the index entries are still unverified, or while a job may still be writing.
create function public.nexus_purge_document(p_workspace uuid, p_document uuid, p_operation uuid)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare
  op public.deletion_operations%rowtype;
  until timestamptz;
  verified timestamptz := clock_timestamp();
  removed jsonb;
  chunks bigint; versions bigint; jobs bigint; uploads bigint; answers bigint; withheld bigint; remaining bigint;
  kept jsonb;
  target record;
begin
  select * into op from public.deletion_operations
   where workspace_id = p_workspace and id = p_operation and resource_id = p_document for update;
  if not found then return jsonb_build_object('state','NOT_FOUND'); end if;
  if op.state = 'verified' then return jsonb_build_object('state','VERIFIED'); end if;
  perform 1 from public.documents
    where workspace_id = p_workspace and id = p_document and lifecycle_state = 'deleting' for update;
  if not found then return jsonb_build_object('state','NOT_FOUND'); end if;
  if exists (select 1 from public.radar_snapshots where workspace_id = p_workspace and document_id = p_document) then
    return jsonb_build_object('state','BLOCKED','reason','RADAR_SNAPSHOT');
  end if;
  if exists (select 1 from public.deletion_targets
              where operation_id = p_operation and kind in ('original','version_index') and verified_at is null) then
    return jsonb_build_object('state','BLOCKED','reason','REMOTE_TARGETS_PENDING');
  end if;
  until := public.nexus_document_writers_until(p_workspace, p_document);
  if until is not null then
    return jsonb_build_object('state','WAITING','reason','JOB_RUNNING','retry_at', until);
  end if;

  -- Passages quoted from this document in past answers are blanked; the answer and its citation stay, marked
  -- as deleted, because the conversation is the person's own record and has its own "clear history".
  update public.chat_messages m
     set sources = (select coalesce(jsonb_agg(
                      case when item -> 'metadata' ->> 'document_id' = p_document::text
                           then item || jsonb_build_object('content', '', 'deleted', true)
                           else item end order by position), '[]'::jsonb)
                      from jsonb_array_elements(m.sources) with ordinality as quoted(item, position))
   where m.workspace_id = p_workspace and jsonb_typeof(m.sources) = 'array'
     and m.sources @> jsonb_build_array(jsonb_build_object('metadata', jsonb_build_object('document_id', p_document::text)));
  get diagnostics answers = row_count;
  select count(distinct run_id) into withheld from public.query_run_sources
   where workspace_id = p_workspace and document_id = p_document;
  -- Kept on purpose and counted, so the receipt says what still mentions the document.
  select jsonb_build_object(
    'findings', (select count(*) from public.findings f
                  where f.workspace_id = p_workspace and f.deleted_at is null
                    and (f.source_run_id in (select run_id from public.query_run_sources
                                              where workspace_id = p_workspace and document_id = p_document)
                         or f.source_research_run_id in (select id from public.research_runs
                                                          where workspace_id = p_workspace
                                                            and source_snapshot @> jsonb_build_array(jsonb_build_object('document_id', p_document::text))))),
    'research_runs', (select count(*) from public.research_runs
                       where workspace_id = p_workspace
                         and source_snapshot @> jsonb_build_array(jsonb_build_object('document_id', p_document::text))))
    into kept;

  delete from public.document_chunks where workspace_id = p_workspace and document_id = p_document;
  get diagnostics chunks = row_count;
  delete from public.ingestion_jobs where workspace_id = p_workspace and document_id = p_document;
  get diagnostics jobs = row_count;
  delete from public.document_uploads where workspace_id = p_workspace and document_id = p_document;
  get diagnostics uploads = row_count;
  delete from public.document_versions where workspace_id = p_workspace and document_id = p_document;
  get diagnostics versions = row_count;
  delete from public.documents where workspace_id = p_workspace and id = p_document;

  select (select count(*) from public.documents where id = p_document)
       + (select count(*) from public.document_versions where document_id = p_document)
       + (select count(*) from public.document_chunks where document_id = p_document)
       + (select count(*) from public.ingestion_jobs where document_id = p_document)
       + (select count(*) from public.document_uploads where document_id = p_document)
    into remaining;
  if remaining <> 0 then raise exception 'NR:DELETE_UNVERIFIED'; end if;

  removed := jsonb_build_object('chunks', chunks, 'versions', versions, 'processing_jobs', jobs, 'uploads', uploads,
                                'answers_with_passages_removed', answers, 'answers_withheld', withheld);
  removed := removed || jsonb_build_object('kept', kept);
  for target in
    select id, kind from public.deletion_targets
     where operation_id = p_operation and kind in ('chunks','derived_content_review','outstanding_remote_writes')
       and verified_at is null
  loop
    update public.deletion_targets
       set verified_at = verified, attempts = attempts + 1, failure_code = null,
           inventory = case target.kind
             when 'chunks' then jsonb_build_object('chunks', chunks, 'versions', versions, 'uploads', uploads)
             when 'derived_content_review' then jsonb_build_object('answers_with_passages_removed', answers, 'answers_withheld', withheld,
                                                                   'findings_kept', kept -> 'findings', 'research_runs_kept', kept -> 'research_runs')
             else jsonb_build_object('processing_jobs', jobs) end
     where id = target.id;
    insert into public.deletion_receipts (workspace_id, operation_id, target_id, provider, receipt_hash, verified_at)
    values (p_workspace, p_operation, target.id, 'supabase',
            encode(sha256(convert_to(jsonb_build_object('workspace', p_workspace, 'operation_id', p_operation,
              'target_id', target.id, 'kind', target.kind, 'provider', 'supabase', 'verified_at', verified,
              'removed', removed)::text, 'UTF8')), 'hex'), verified)
    on conflict (workspace_id, target_id, provider) do nothing;
  end loop;
  update public.deletion_operations set state = 'verified', verified_at = verified where id = p_operation;
  return jsonb_build_object('state','VERIFIED','removed', removed,
    'receipts', (select count(*) from public.deletion_receipts where operation_id = p_operation));
end
$fn$;
revoke all on function public.nexus_purge_document(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_purge_document(uuid, uuid, uuid) to service_role;

-- Unfinished deletions for the gateway's cron, oldest attempt first. Each claim pushes the next attempt back
-- (5 minutes, doubling up to 6 hours), so one deletion that cannot finish does not hold up the others.
create function public.nexus_claim_document_purges(p_limit integer default 2)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare claimed jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10 then raise exception 'NR:INVALID_SCOPE'; end if;
  with due as (
    select t.id as target_id, o.workspace_id, o.id as operation_id, o.resource_id as document_id
      from public.deletion_operations o
      join public.deletion_targets t on t.operation_id = o.id and t.kind = 'chunks' and t.verified_at is null
      join public.documents d on d.workspace_id = o.workspace_id and d.id = o.resource_id and d.lifecycle_state = 'deleting'
     where o.state in ('pending','cleaning','blocked')
       and t.next_attempt_at <= clock_timestamp()
     order by t.next_attempt_at asc, o.created_at asc
     limit p_limit
     for update of t skip locked
  ), pushed as (
    update public.deletion_targets t
       set attempts = t.attempts + 1,
           next_attempt_at = clock_timestamp() + least(interval '6 hours', interval '5 minutes' * power(2, least(t.attempts, 8)))
      from due where t.id = due.target_id
    returning due.workspace_id, due.operation_id, due.document_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('workspace_id', workspace_id, 'operation_id', operation_id, 'document_id', document_id)), '[]'::jsonb)
    into claimed from pushed;
  return claimed;
end
$fn$;
revoke all on function public.nexus_claim_document_purges(integer) from public, anon, authenticated;
grant execute on function public.nexus_claim_document_purges(integer) to service_role;

commit;
