\set ON_ERROR_STOP on
-- A deleted document must really be gone, a receipt may exist only for what was removed, and nothing that
-- belongs to another document or workspace may be touched. The functions are called the way the gateway
-- calls them: as the service role.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';

-- Fixtures, written as the database owner. Documents: 01 is deleted, 11 must survive, 21 is a Radar page,
-- 31 is still being processed, 41 belongs to workspace B, 51 waits for the cron, 61 was marked before Radar
-- pages were refused.
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count)
select ('de100000-0000-4000-8000-0000000000' || n)::uuid, w::uuid, u::uuid, name, name, 'ready', 1
  from (values ('01','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','delete-me.txt'),
               ('11','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','keep-me.txt'),
               ('21','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','radar-page.txt'),
               ('31','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','still-processing.txt'),
               ('41','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','other-workspace.txt'),
               ('51','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','for-the-cron.txt'),
               ('61','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','old-radar-page.txt')) d(n,w,u,name);
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
  original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation)
select ('de200000-0000-4000-8000-0000000000' || right(id::text, 2))::uuid, workspace_id, id, 'documents',
       workspace_id || '/' || id || '/original.txt', repeat('d', 64), 64, now(), 'test', 'test', 1, 'ready', 'generation-1'
  from public.documents where id::text like 'de100000-0000-4000-8000-0000000000%';
update public.documents d set active_version_id = v.id, storage_path = v.original_key
  from public.document_versions v where v.document_id = d.id and d.id::text like 'de100000-0000-4000-8000-0000000000%';
-- A document from before versions existed: its file is known only by documents.storage_path, and its chunks
-- have no version.
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count,storage_path)
values ('de100000-0000-4000-8000-000000000071','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'legacy.pdf','legacy.pdf','ready',2,'legacy/11111111-1111-4111-8111-111111111111/legacy.pdf');
insert into public.document_chunks(id,workspace_id,document_id,chunk_index,content)
values (gen_random_uuid(),'11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000071',0,'Legacy passage one'),
       (gen_random_uuid(),'11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000071',1,'Legacy passage two');
insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
select gen_random_uuid(), v.workspace_id, v.document_id, v.id, n, passage, passage, encode(sha256(convert_to(passage, 'UTF8')), 'hex'), 1,
       '{"page":1}', 'synthetic-space'
  from public.document_versions v cross join generate_series(0, 2) n
  cross join lateral (select 'Passage ' || n || ' of ' || v.document_id as passage) text
 where v.document_id::text like 'de100000-0000-4000-8000-0000000000%';
insert into public.ingestion_jobs(id,workspace_id,document_id,version_id,status,progress,stage,attempts,max_attempts,kind,lifecycle_epoch,lease_generation,payload)
values ('de300000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000001',
        'de200000-0000-4000-8000-000000000001','completed',100,'completed',1,3,'ingestion',1,2,'{}'),
       ('de300000-0000-4000-8000-000000000011','11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000011',
        'de200000-0000-4000-8000-000000000011','completed',100,'completed',1,3,'ingestion',1,2,'{}');
insert into public.ingestion_jobs(id,workspace_id,document_id,version_id,status,progress,stage,attempts,max_attempts,kind,lifecycle_epoch,lease_owner,lease_generation,lease_expires_at,payload)
values ('de300000-0000-4000-8000-000000000031','11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000031',
        'de200000-0000-4000-8000-000000000031','processing',40,'embedding',1,3,'ingestion',1,'worker-1',4,now() + interval '5 minutes','{}'),
       ('de300000-0000-4000-8000-000000000032','11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000031',
        'de200000-0000-4000-8000-000000000031','queued',0,'queued',0,3,'ingestion',1,null,1,null,'{}');
insert into public.document_uploads(workspace_id,actor_id,document_id,version_id,lifecycle_epoch,filename,content_type,expected_bytes,original_bucket,original_key,begin_key,begin_hash)
values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','de100000-0000-4000-8000-000000000001',
        'de200000-0000-4000-8000-000000000001',1,'delete-me.txt','text/plain',64,'documents','synthetic/delete-me.txt','deletion-test-upload',repeat('e',64));

-- An answer from the chat page quotes passages of two documents; workspace B has an answer of its own.
insert into public.chat_sessions(id,workspace_id,user_id) values
  ('de400000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),
  ('de400000-0000-4000-8000-000000000041','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333');
insert into public.chat_messages(id,workspace_id,session_id,role,content,sources) values
  ('de500000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','de400000-0000-4000-8000-000000000001','assistant',
   'Retention is 47 days and backups run on Tuesday. [S1] [S2]',
   '[{"content":"Retention is 47 days.","filename":"delete-me.txt","page_number":0,"chunk_index":0,"metadata":{"document_id":"de100000-0000-4000-8000-000000000001","version_id":"de200000-0000-4000-8000-000000000001"}},
     {"content":"Backups run on Tuesday.","filename":"keep-me.txt","page_number":0,"chunk_index":0,"metadata":{"document_id":"de100000-0000-4000-8000-000000000011"}}]'),
  ('de500000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','de400000-0000-4000-8000-000000000001','assistant',
   'Backups run on Tuesday. [S1]',
   '[{"content":"Backups run on Tuesday.","filename":"keep-me.txt","metadata":{"document_id":"de100000-0000-4000-8000-000000000011"}}]'),
  -- Workspace B cannot be reached through an identifier it happens to store.
  ('de500000-0000-4000-8000-000000000041','44444444-4444-4444-8444-444444444444','de400000-0000-4000-8000-000000000041','assistant',
   'Unrelated answer. [S1]',
   '[{"content":"Text that belongs to workspace B.","filename":"other-workspace.txt","metadata":{"document_id":"de100000-0000-4000-8000-000000000001"}}]');

-- An older answer recorded as a run that used both documents.
insert into public.ingestion_jobs(id,workspace_id,kind) values ('de300000-0000-4000-8000-000000000099','11111111-1111-4111-8111-111111111111','queries');
insert into public.usage_reservations(id,workspace_id,actor_id,operation_id,reserved_queries,reserved_tokens,state,expires_at) values
  ('de600000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
   'de300000-0000-4000-8000-000000000099',1,10,'reserved',now() + interval '1 hour');
insert into public.query_runs(id,workspace_id,user_id,session_id,job_id,reservation_id,idempotency_key,payload_hash,request,context,state,deadline) values
  ('de700000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
   'de400000-0000-4000-8000-000000000001','de300000-0000-4000-8000-000000000099','de600000-0000-4000-8000-000000000001',
   'deletion-test-run',repeat('a',64),'{}','{}','completed',now() + interval '1 hour');
insert into public.query_run_sources(workspace_id,run_id,document_id,version_id,lifecycle_epoch)
select workspace_id, 'de700000-0000-4000-8000-000000000001', id, active_version_id, lifecycle_epoch
  from public.documents where id in ('de100000-0000-4000-8000-000000000001','de100000-0000-4000-8000-000000000011');
-- The person saved that answer as a finding.
insert into public.findings(id,workspace_id,owner_id,title,source_run_id,create_key,payload_hash)
values ('dec00000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
        'Retention and backups','de700000-0000-4000-8000-000000000001','deletion-test-finding',repeat('f',64));

-- Radar snapshots of two stored pages. Only the reference to the page matters here, so the rest of the Radar
-- records are left out.
set local session_replication_role = replica;
insert into public.radar_snapshots(id,workspace_id,source_id,revision,document_id,version_id,document_original_hash,document_original_bytes,
  selection_hash,normalized_hash,chunk_ids,selections,selected_utf8_bytes,stored_chunk_count,comparison_complete,captured_at,actor_id,
  rights_rationale,rights_receipts,change_id)
values ('de800000-0000-4000-8000-000000000021','11111111-1111-4111-8111-111111111111','de900000-0000-4000-8000-000000000001',1,
        'de100000-0000-4000-8000-000000000021','de200000-0000-4000-8000-000000000021',repeat('d',64),64,repeat('a',64),repeat('b',64),
        '["de000000-0000-4000-8000-000000000001"]','[{"id":"de000000-0000-4000-8000-000000000001"}]',10,1,true,now(),
        '22222222-2222-4222-8222-222222222222','synthetic','[]','dea00000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

set local role service_role;
do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  wb constant uuid := '44444444-4444-4444-8444-444444444444';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  outsider constant uuid := 'de0f0000-0000-4000-8000-000000000001'; -- member of nothing
  doc constant uuid := 'de100000-0000-4000-8000-000000000001';
  kept constant uuid := 'de100000-0000-4000-8000-000000000011';
  radar constant uuid := 'de100000-0000-4000-8000-000000000021';
  busy constant uuid := 'de100000-0000-4000-8000-000000000031';
  foreign_doc constant uuid := 'de100000-0000-4000-8000-000000000041';
  later constant uuid := 'de100000-0000-4000-8000-000000000051';
  run constant uuid := 'de700000-0000-4000-8000-000000000001';
  op uuid; busy_op uuid; later_op uuid; r jsonb; claimed jsonb; n bigint; quoted jsonb;
begin
  -- 1. A deletion that could not be finished is not started.
  begin
    perform public.tombstone_document(w, radar, a);
    raise exception 'a Radar page was marked for deletion';
  exception when raise_exception then if sqlerrm <> 'NR:DOCUMENT_IN_USE' then raise; end if; end;
  if (select lifecycle_state from public.documents where id = radar) <> 'active'
     or exists (select 1 from public.deletion_operations where resource_id = radar) then
    raise exception 'the refused deletion left a mark';
  end if;
  begin
    perform public.tombstone_document(w, doc, outsider);
    raise exception 'someone outside the workspace started a deletion';
  exception when insufficient_privilege then null; end;
  if not public.workbench_sources_available(run) then raise exception 'fixture: the older answer should be visible before deletion'; end if;

  -- 2. Marking hides the document; nothing is removed or receipted yet.
  op := public.tombstone_document(w, doc, a);
  if (select count(*) from public.deletion_targets where operation_id = op and kind = 'original') <> 1 then
    raise exception 'the original of an uploaded document was listed more than once'; end if;
  if (select lifecycle_state from public.documents where id = doc) <> 'deleting' then raise exception 'document not marked'; end if;
  if public.nexus_begin_document_purge(wb, doc, op)->>'state' <> 'NOT_FOUND'
     or public.nexus_purge_document(wb, doc, op)->>'state' <> 'NOT_FOUND'
     or public.nexus_begin_document_purge(w, kept, op)->>'state' <> 'NOT_FOUND' then
    raise exception 'a deletion was reachable through another workspace or document';
  end if;
  r := public.nexus_begin_document_purge(w, doc, op);
  if r->>'state' <> 'READY' or (select state from public.deletion_operations where id = op) <> 'cleaning' then
    raise exception 'idle document not ready to purge: %', r; end if;

  -- 3. The rows stay until the stored original and the index entries are verified gone.
  r := public.nexus_purge_document(w, doc, op);
  if r->>'state' <> 'BLOCKED' or r->>'reason' <> 'REMOTE_TARGETS_PENDING' then raise exception 'purged before remote cleanup: %', r; end if;
  if (select count(*) from public.document_chunks where document_id = doc) <> 3
     or exists (select 1 from public.deletion_receipts where operation_id = op) then
    raise exception 'a refused purge removed rows or wrote a receipt';
  end if;
  -- What the gateway records after it removed the file and the index entries.
  update public.deletion_targets set verified_at = clock_timestamp() where operation_id = op and kind in ('original','version_index');

  -- 4. The purge removes everything that belongs to the document, and says what it removed.
  r := public.nexus_purge_document(w, doc, op);
  if r->>'state' <> 'VERIFIED' or r->'removed' <> jsonb_build_object('chunks', 3, 'versions', 1, 'processing_jobs', 1, 'uploads', 1,
       'answers_with_passages_removed', 1, 'answers_withheld', 1, 'kept', jsonb_build_object('findings', 1, 'research_runs', 0))
     or (r->>'receipts')::int <> 3 then raise exception 'unexpected purge result: %', r; end if;
  -- The saved finding is the person's own work: it stays.
  if not exists (select 1 from public.findings where id = 'dec00000-0000-4000-8000-000000000001' and deleted_at is null) then
    raise exception 'a saved finding was removed'; end if;
  select (select count(*) from public.documents where id = doc) + (select count(*) from public.document_versions where document_id = doc)
       + (select count(*) from public.document_chunks where document_id = doc) + (select count(*) from public.ingestion_jobs where document_id = doc)
       + (select count(*) from public.document_uploads where document_id = doc) into n;
  if n <> 0 then raise exception 'rows of the deleted document remain: %', n; end if;

  -- 5. Nothing else was touched.
  if (select count(*) from public.document_chunks where document_id = kept) <> 3
     or (select lifecycle_state from public.documents where id = kept) <> 'active'
     or (select count(*) from public.ingestion_jobs where document_id = kept) <> 1
     or (select count(*) from public.document_chunks where document_id = foreign_doc) <> 3 then
    raise exception 'another document lost rows';
  end if;

  -- 6. Past answers: the quoted passage of the deleted document is blank and marked, everything else is as it was.
  select sources into quoted from public.chat_messages where id = 'de500000-0000-4000-8000-000000000001';
  if quoted->0->>'content' <> '' or quoted->0->>'deleted' <> 'true' or quoted->0->>'filename' <> 'delete-me.txt'
     or quoted->1->>'content' <> 'Backups run on Tuesday.' or quoted->1 ? 'deleted' or jsonb_array_length(quoted) <> 2 then
    raise exception 'quoted passages not handled: %', quoted; end if;
  if (select content from public.chat_messages where id = 'de500000-0000-4000-8000-000000000001') <> 'Retention is 47 days and backups run on Tuesday. [S1] [S2]'
     or (select sources->0->>'content' from public.chat_messages where id = 'de500000-0000-4000-8000-000000000002') <> 'Backups run on Tuesday.'
     or (select sources->0->>'content' from public.chat_messages where id = 'de500000-0000-4000-8000-000000000041') <> 'Text that belongs to workspace B.' then
    raise exception 'an answer that should be untouched changed';
  end if;
  -- The older answer keeps its link to the removed source, so it stays withheld although its other source is active.
  if not exists (select 1 from public.query_run_sources where run_id = run and document_id = doc)
     or public.workbench_sources_available(run) then
    raise exception 'an answer that used the deleted document is shown again';
  end if;

  -- 7. Receipts exist for exactly what this transaction removed, and the record of the deletion stays.
  if (select count(*) from public.deletion_receipts where operation_id = op and provider = 'supabase' and receipt_hash ~ '^[0-9a-f]{64}$') <> 3
     or (select count(*) from public.deletion_targets where operation_id = op and verified_at is null) <> 0
     or (select inventory from public.deletion_targets where operation_id = op and kind = 'chunks') <> '{"chunks":3,"versions":1,"uploads":1}'::jsonb
     or (select inventory from public.deletion_targets where operation_id = op and kind = 'derived_content_review')
          <> '{"answers_with_passages_removed":1,"answers_withheld":1,"findings_kept":1,"research_runs_kept":0}'::jsonb
     or (select inventory from public.deletion_targets where operation_id = op and kind = 'outstanding_remote_writes') <> '{"processing_jobs":1}'::jsonb
     or (select state || ':' || (verified_at is not null) from public.deletion_operations where id = op) <> 'verified:true' then
    raise exception 'the deletion record is incomplete';
  end if;
  -- (A check reads the tables in a statement of its own: a statement does not see what a function it calls has changed.)
  if public.nexus_purge_document(w, doc, op)->>'state' <> 'VERIFIED' or public.nexus_begin_document_purge(w, doc, op)->>'state' <> 'VERIFIED' then
    raise exception 'a finished deletion did not report itself as finished'; end if;
  if (select count(*) from public.deletion_receipts where operation_id = op) <> 3 then
    raise exception 'repeating a finished deletion changed it'; end if;

  -- 8. A document that is being processed waits until the running step can no longer write.
  busy_op := public.tombstone_document(w, busy, a);
  r := public.nexus_begin_document_purge(w, busy, busy_op);
  if r->>'state' <> 'WAITING' or r->>'reason' <> 'JOB_RUNNING'
     or (r->>'retry_at')::timestamptz not between clock_timestamp() and clock_timestamp() + interval '2 minutes' then
    raise exception 'running job not waited for: %', r; end if;
  if (select state from public.deletion_operations where id = busy_op) <> 'pending'
     or (select status from public.ingestion_jobs where id = 'de300000-0000-4000-8000-000000000031') <> 'processing'
     or (select status from public.ingestion_jobs where id = 'de300000-0000-4000-8000-000000000032') <> 'cancelled' then
    raise exception 'jobs not handled while waiting';
  end if;
  update public.deletion_targets set verified_at = clock_timestamp() where operation_id = busy_op and kind in ('original','version_index');
  r := public.nexus_purge_document(w, busy, busy_op);
  if r->>'state' <> 'WAITING' or not exists (select 1 from public.documents where id = busy) then
    raise exception 'purged while a job could still write: %', r;
  end if;
  -- Two minutes after the mark, the step that was running has ended.
  update public.ingestion_jobs set cancellation_requested_at = clock_timestamp() - interval '3 minutes' where id = 'de300000-0000-4000-8000-000000000031';
  r := public.nexus_begin_document_purge(w, busy, busy_op);
  if r->>'state' <> 'READY' or (select status from public.ingestion_jobs where id = 'de300000-0000-4000-8000-000000000031') <> 'cancelled' then
    raise exception 'finished job still blocks the deletion: %', r;
  end if;
  r := public.nexus_purge_document(w, busy, busy_op);
  if r->>'state' <> 'VERIFIED' or (r->'removed'->>'processing_jobs')::int <> 2 or exists (select 1 from public.documents where id = busy) then
    raise exception 'deletion after waiting failed: %', r; end if;

  -- 9. The cron is handed unfinished deletions once, then again only after a delay.
  later_op := public.tombstone_document(w, later, a);
  claimed := public.nexus_claim_document_purges(10);
  if not claimed @> jsonb_build_array(jsonb_build_object('workspace_id', w, 'operation_id', later_op, 'document_id', later))
     or claimed @> jsonb_build_array(jsonb_build_object('operation_id', op))
     or claimed @> jsonb_build_array(jsonb_build_object('operation_id', busy_op)) then
    raise exception 'unexpected claim: %', claimed; end if;
  if public.nexus_claim_document_purges(10) @> jsonb_build_array(jsonb_build_object('operation_id', later_op)) then
    raise exception 'the same deletion was claimed twice in a row'; end if;
  if (select attempts || ':' || (next_attempt_at between clock_timestamp() + interval '4 minutes' and clock_timestamp() + interval '6 minutes')
        from public.deletion_targets where operation_id = later_op and kind = 'chunks') <> '1:true' then
    raise exception 'the next attempt was not scheduled';
  end if;
  update public.deletion_targets set next_attempt_at = clock_timestamp() - interval '1 second' where operation_id = later_op and kind = 'chunks';
  claimed := public.nexus_claim_document_purges(10);
  if not claimed @> jsonb_build_array(jsonb_build_object('operation_id', later_op))
     or (select next_attempt_at between clock_timestamp() + interval '9 minutes' and clock_timestamp() + interval '11 minutes'
           from public.deletion_targets where operation_id = later_op and kind = 'chunks') is not true then
    raise exception 'the delay between attempts did not grow: %', claimed;
  end if;
  begin
    perform public.nexus_claim_document_purges(0);
    raise exception 'an invalid limit was accepted';
  exception when raise_exception then if sqlerrm <> 'NR:INVALID_SCOPE' then raise; end if; end;
end $$;

-- 10. A document from before versions existed: its file is erased too, and its version-less chunks go.
do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  legacy constant uuid := 'de100000-0000-4000-8000-000000000071';
  op uuid; r jsonb;
begin
  op := public.tombstone_document(w, legacy, a);
  if (select string_agg(kind || '=' || coalesce(object_key, ''), ',' order by kind) from public.deletion_targets
       where operation_id = op and kind in ('original','version_index')) <> 'original=legacy/11111111-1111-4111-8111-111111111111/legacy.pdf' then
    raise exception 'the stored file of an old document was not listed for erasure'; end if;
  if public.nexus_begin_document_purge(w, legacy, op)->>'state' <> 'READY' then raise exception 'old document not ready to purge'; end if;
  r := public.nexus_purge_document(w, legacy, op);
  if r->>'reason' <> 'REMOTE_TARGETS_PENDING' then raise exception 'rows removed while the old file was still stored: %', r; end if;
  update public.deletion_targets set verified_at = clock_timestamp() where operation_id = op and kind = 'original';
  r := public.nexus_purge_document(w, legacy, op);
  if r->>'state' <> 'VERIFIED' or (r->'removed'->>'chunks')::int <> 2 or (r->'removed'->>'versions')::int <> 0 then
    raise exception 'old document not purged: %', r; end if;
  if exists (select 1 from public.documents where id = legacy) or exists (select 1 from public.document_chunks where document_id = legacy) then
    raise exception 'rows of the old document remain'; end if;
end $$;
reset role;

-- 11. A deletion begun before Radar pages were refused stays blocked, with the reason on record.
set local session_replication_role = replica;
insert into public.radar_snapshots(id,workspace_id,source_id,revision,document_id,version_id,document_original_hash,document_original_bytes,
  selection_hash,normalized_hash,chunk_ids,selections,selected_utf8_bytes,stored_chunk_count,comparison_complete,captured_at,actor_id,
  rights_rationale,rights_receipts,change_id)
values ('de800000-0000-4000-8000-000000000061','11111111-1111-4111-8111-111111111111','de900000-0000-4000-8000-000000000001',2,
        'de100000-0000-4000-8000-000000000061','de200000-0000-4000-8000-000000000061',repeat('d',64),64,repeat('a',64),repeat('b',64),
        '["de000000-0000-4000-8000-000000000002"]','[{"id":"de000000-0000-4000-8000-000000000002"}]',10,1,true,now(),
        '22222222-2222-4222-8222-222222222222','synthetic','[]','dea00000-0000-4000-8000-000000000002');
set local session_replication_role = origin;
update public.documents set lifecycle_state = 'deleting', lifecycle_epoch = lifecycle_epoch + 1 where id = 'de100000-0000-4000-8000-000000000061';
insert into public.deletion_operations(id,workspace_id,resource_id,tombstone_epoch)
  values ('deb00000-0000-4000-8000-000000000061','11111111-1111-4111-8111-111111111111','de100000-0000-4000-8000-000000000061',2);
insert into public.deletion_targets(workspace_id,operation_id,kind,resource_id)
  select '11111111-1111-4111-8111-111111111111','deb00000-0000-4000-8000-000000000061',kind,'de100000-0000-4000-8000-000000000061'
    from unnest(array['chunks','derived_content_review','outstanding_remote_writes']) kind;
set local role service_role;
do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  old constant uuid := 'de100000-0000-4000-8000-000000000061';
  op constant uuid := 'deb00000-0000-4000-8000-000000000061';
  r jsonb;
begin
  r := public.nexus_begin_document_purge(w, old, op);
  if r->>'state' <> 'BLOCKED' or r->>'reason' <> 'RADAR_SNAPSHOT'
     or (select state from public.deletion_operations where id = op) <> 'blocked'
     or (select failure_code from public.deletion_targets where operation_id = op and kind = 'derived_content_review') <> 'RADAR_SNAPSHOT' then
    raise exception 'an old deletion of a Radar page was not held: %', r;
  end if;
  r := public.nexus_purge_document(w, old, op);
  if r->>'reason' <> 'RADAR_SNAPSHOT' or (select count(*) from public.document_chunks where document_id = old) <> 3 then
    raise exception 'an old deletion of a Radar page was purged: %', r;
  end if;
end $$;
reset role;

-- 12. Browser roles can use none of it.
do $$
declare name text;
begin
  for name in select unnest(array[
    'public.nexus_document_writers_until(uuid,uuid)', 'public.nexus_begin_document_purge(uuid,uuid,uuid)',
    'public.nexus_purge_document(uuid,uuid,uuid)', 'public.nexus_claim_document_purges(integer)']) loop
    if has_function_privilege('anon', name, 'execute') or has_function_privilege('authenticated', name, 'execute') then
      raise exception 'browser role can execute %', name; end if;
  end loop;
end $$;
rollback;
select 'DOCUMENT_DELETION_SQL_PASS';
