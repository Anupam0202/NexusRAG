\set ON_ERROR_STOP on
-- The reconciliation reports (NX-27) must find exactly what is out of step between the database, file storage and
-- the search index, and must leave alone what is still arriving, what is being deleted and what belongs elsewhere.
-- Earlier test files left documents of their own behind, so counts are compared with a reading taken before this
-- file's fixtures exist.
begin;

create temporary table reconciliation_before on commit drop as
select public.nexus_storage_reconciliation(3600, 1000) as storage,
       public.nexus_storage_reconciliation(600, 1000) as storage_short_grace,
       public.nexus_index_reconciliation('[]'::jsonb, true, 1000) as index;

-- Documents of workspace A. 01 is in order; 02 lost its original; 03 is from before versions existed and lost its
-- original; 04 is being deleted; 05 was only marked as deleted by an earlier release; 06 is known by its path only
-- and its file exists; 07 is answerable but the index holds nothing of it; 08 is ready but has no passages; 09 is
-- still being processed.
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count,storage_path,lifecycle_state)
select ('ec100000-0000-4000-8000-0000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111',
       '22222222-2222-4222-8222-222222222222', 'reconcile-' || n || '.txt', 'reconcile-' || n || '.txt', status, 0, path, lifecycle
  from (values ('01','ready',null,'active'), ('02','ready',null,'active'),
               ('03','ready','reconcile/legacy-lost.pdf','active'), ('04','ready',null,'deleting'),
               ('05','deleted','reconcile/marked-deleted.pdf','active'), ('06','ready','reconcile/legacy-kept.pdf','active'),
               ('07','ready',null,'active'), ('08','ready',null,'active'), ('09','processing',null,'active')) d(n,status,path,lifecycle);
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,
  original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation)
select ('ec200000-0000-4000-8000-0000000000' || n)::uuid, '11111111-1111-4111-8111-111111111111',
       ('ec100000-0000-4000-8000-0000000000' || n)::uuid, 'documents', 'reconcile/version-' || n || '.txt', repeat('e', 64), 64,
       now(), 'test', 'test', 1, state, 'generation-1'
  from (values ('01','ready'), ('02','ready'), ('04','ready'), ('07','ready'), ('08','ready'), ('09','processing')) v(n,state);
update public.documents d set active_version_id = v.id
  from public.document_versions v where v.document_id = d.id and d.id::text like 'ec100000-0000-4000-8000-0000000000%';
insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
select gen_random_uuid(), v.workspace_id, v.document_id, v.id, 0, 'Passage', 'Passage', encode(sha256(convert_to('Passage', 'UTF8')), 'hex'), 1,
       '{"page":1}', 'synthetic-space'
  from public.document_versions v
 where v.id in ('ec200000-0000-4000-8000-000000000001','ec200000-0000-4000-8000-000000000004','ec200000-0000-4000-8000-000000000007',
                'ec200000-0000-4000-8000-000000000009');
insert into public.document_uploads(workspace_id,actor_id,document_id,version_id,lifecycle_epoch,filename,content_type,expected_bytes,original_bucket,original_key,begin_key,begin_hash)
values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','ec100000-0000-4000-8000-000000000001',
        gen_random_uuid(),1,'arriving.txt','text/plain',64,'documents','reconcile/upload-arriving.txt','reconcile-upload',repeat('e',64));

-- Stored files. Old enough to be judged unless noted.
insert into storage.objects(bucket_id,name,created_at,metadata,is_delete_marker) values
  ('documents','reconcile/version-01.txt',          now() - interval '2 hours', '{"size":64}', false),  -- named by a version
  ('documents','reconcile/version-07.txt',          now() - interval '2 hours', '{"size":64}', false),
  ('documents','reconcile/version-08.txt',          now() - interval '2 hours', '{"size":64}', false),
  ('documents','reconcile/version-09.txt',          now() - interval '2 hours', '{"size":64}', false),
  ('documents','reconcile/legacy-kept.pdf',         now() - interval '2 hours', '{"size":64}', false),  -- named by a document
  ('documents','reconcile/upload-arriving.txt',     now() - interval '2 hours', '{"size":64}', false),  -- named by an upload
  ('documents','reconcile/orphan-old.pdf',          now() - interval '2 hours', '{"size":1234}', false),
  ('documents','reconcile/orphan-no-size.pdf',      now() - interval '3 hours', '{}', false),
  ('documents','reconcile/orphan-twenty-minutes.pdf', now() - interval '20 minutes', '{"size":10}', false),
  ('documents','reconcile/orphan-just-stored.pdf',  now(), '{"size":10}', false),                       -- may still get its rows
  ('documents','reconcile/orphan-marker.pdf',       now() - interval '2 hours', '{}', true),            -- not a stored file
  ('other-bucket','reconcile/orphan-old.pdf',       now() - interval '2 hours', '{"size":10}', false);  -- not the app's bucket

-- 1. Stored files no row names: only the old ones of the app's bucket, with their sizes, oldest first.
do $$
declare before jsonb; report jsonb; names text[];
begin
  select storage into before from reconciliation_before;
  report := public.nexus_storage_reconciliation(3600, 1000);
  select array_agg(o->>'name' order by ordinality) into names
    from jsonb_array_elements(report->'unreferenced_objects'->'objects') with ordinality as t(o, ordinality)
   where o->>'name' like 'reconcile/%';
  if names is distinct from array['reconcile/orphan-no-size.pdf', 'reconcile/orphan-old.pdf'] then
    raise exception 'unreferenced files were %, expected the two old orphans, oldest first', names; end if;
  if (report->'unreferenced_objects'->>'count')::int - (before->'unreferenced_objects'->>'count')::int <> 2
     or (report->'unreferenced_objects'->>'bytes')::bigint - (before->'unreferenced_objects'->>'bytes')::bigint <> 1234 then
    raise exception 'unreferenced totals are wrong: % after % before', report->'unreferenced_objects', before->'unreferenced_objects'; end if;
  if (select o->>'bytes' from jsonb_array_elements(report->'unreferenced_objects'->'objects') o where o->>'name' = 'reconcile/orphan-old.pdf') <> '1234'
     or (select o->'bytes' from jsonb_array_elements(report->'unreferenced_objects'->'objects') o where o->>'name' = 'reconcile/orphan-no-size.pdf') <> 'null'::jsonb then
    raise exception 'file sizes are wrong: %', report->'unreferenced_objects'->'objects'; end if;
  if report->>'format' <> 'nexusrag-storage-reconciliation/1' or (report->>'grace_seconds')::int <> 3600 or (report->>'limit')::int <> 1000 then
    raise exception 'the report does not describe itself: %', report - 'unreferenced_objects' - 'missing_originals'; end if;
end $$;

-- 2. The grace period: a file younger than it is left alone, and it cannot be set below ten minutes.
do $$
declare before jsonb; report jsonb;
begin
  select storage_short_grace into before from reconciliation_before;
  report := public.nexus_storage_reconciliation(0, 1000);
  if (report->>'grace_seconds')::int <> 600 then raise exception 'the grace period went below ten minutes: %', report->>'grace_seconds'; end if;
  if (report->'unreferenced_objects'->>'count')::int - (before->'unreferenced_objects'->>'count')::int <> 3 then
    raise exception 'a ten-minute grace period should add the twenty-minute-old file only: %', report->'unreferenced_objects'; end if;
  if exists (select 1 from jsonb_array_elements(report->'unreferenced_objects'->'objects') o where o->>'name' = 'reconcile/orphan-just-stored.pdf') then
    raise exception 'a file stored a moment ago was reported'; end if;
  if (public.nexus_storage_reconciliation(null, null)->>'grace_seconds')::int <> 3600 then raise exception 'the default grace period is not an hour'; end if;
end $$;

-- 3. Originals that are gone: the version and the legacy document, not what is being deleted or was marked deleted.
do $$
declare before jsonb; report jsonb; mine jsonb;
begin
  select storage into before from reconciliation_before;
  report := public.nexus_storage_reconciliation(3600, 1000);
  select jsonb_agg(r order by r->>'document_id') into mine
    from jsonb_array_elements(report->'missing_originals'->'rows') r where r->>'document_id' like 'ec100000-%';
  if mine is distinct from jsonb_build_array(
       jsonb_build_object('workspace_id','11111111-1111-4111-8111-111111111111','document_id','ec100000-0000-4000-8000-000000000002','version_id','ec200000-0000-4000-8000-000000000002'),
       jsonb_build_object('workspace_id','11111111-1111-4111-8111-111111111111','document_id','ec100000-0000-4000-8000-000000000003','version_id',null)) then
    raise exception 'missing originals were %', mine; end if;
  if (report->'missing_originals'->>'count')::int - (before->'missing_originals'->>'count')::int <> 2 then
    raise exception 'missing originals were counted wrongly: % after % before', report->'missing_originals'->>'count', before->'missing_originals'->>'count'; end if;
end $$;

-- 4. The limit bounds the lists, never the counts.
do $$
declare full_report jsonb; short jsonb;
begin
  full_report := public.nexus_storage_reconciliation(3600, 1000);
  short := public.nexus_storage_reconciliation(3600, 0);
  if short->'unreferenced_objects'->'objects' <> '[]'::jsonb or short->'missing_originals'->'rows' <> '[]'::jsonb
     or short->'unreferenced_objects'->'count' <> full_report->'unreferenced_objects'->'count'
     or short->'unreferenced_objects'->'bytes' <> full_report->'unreferenced_objects'->'bytes'
     or short->'missing_originals'->'count' <> full_report->'missing_originals'->'count' then
    raise exception 'a limit of zero changed the counts or kept a list: %', short; end if;
  if jsonb_array_length(public.nexus_storage_reconciliation(3600, 1)->'unreferenced_objects'->'objects') <> 1
     or (public.nexus_storage_reconciliation(3600, 5000)->>'limit')::int <> 1000 then
    raise exception 'the limit is not applied or not capped'; end if;
end $$;

-- 5. The index: entries of versions that do not exist are leftovers; an answerable document the index holds nothing
--    of is reported only when the list is the whole index.
do $$
declare before jsonb; report jsonb; mine jsonb;
  indexed jsonb := jsonb_build_array(
    jsonb_build_object('value', 'EC200000-0000-4000-8000-000000000001', 'count', 3),   -- document 01, in other letter case
    jsonb_build_object('value', 'ec200000-0000-4000-8000-000000000004', 'count', 4),   -- being deleted: its row exists
    jsonb_build_object('value', 'ec2fffff-0000-4000-8000-000000000001', 'count', 5),   -- no such version
    jsonb_build_object('value', 'not-an-identifier', 'count', 2),
    jsonb_build_object('value', 'ec2fffff-0000-4000-8000-000000000002'),               -- no count given
    'stray', jsonb_build_object('count', 9));                                          -- not entries at all
begin
  select index into before from reconciliation_before;
  report := public.nexus_index_reconciliation(indexed, true, 1000);
  if report->'orphaned_entries' <> jsonb_build_object('versions', 3, 'entries', 7, 'version_ids',
       jsonb_build_array('ec2fffff-0000-4000-8000-000000000001', 'ec2fffff-0000-4000-8000-000000000002', 'not-an-identifier')) then
    raise exception 'leftover index entries were %', report->'orphaned_entries'; end if;
  select jsonb_agg(r->>'document_id' order by r->>'document_id') into mine
    from jsonb_array_elements(report->'unindexed_versions'->'rows') r where r->>'document_id' like 'ec100000-%';
  if mine is distinct from jsonb_build_array('ec100000-0000-4000-8000-000000000007') then
    raise exception 'documents missing from the index were %', mine; end if;
  -- Before the fixtures every answerable document was missing from an empty index; now document 01 is answerable
  -- and indexed, and document 07 is answerable and not.
  if (report->'unindexed_versions'->>'count')::int - (before->'unindexed_versions'->>'count')::int <> 1 then
    raise exception 'documents missing from the index were counted wrongly: % after % before', report->'unindexed_versions'->>'count', before->'unindexed_versions'->>'count'; end if;
  if report->>'format' <> 'nexusrag-index-reconciliation/1' or (report->>'complete')::boolean is not true then
    raise exception 'the index report does not describe itself'; end if;

  -- A partial list proves nothing about what is missing, but its leftovers are still leftovers.
  report := public.nexus_index_reconciliation(indexed, false, 1);
  if report->'unindexed_versions' <> 'null'::jsonb or (report->>'complete')::boolean is not false
     or (report->'orphaned_entries'->>'versions')::int <> 3 or jsonb_array_length(report->'orphaned_entries'->'version_ids') <> 1 then
    raise exception 'a partial index list was misread: %', report; end if;
  if public.nexus_index_reconciliation('[]'::jsonb, null, 10)->'unindexed_versions' <> 'null'::jsonb then
    raise exception 'an unstated completeness was taken as complete'; end if;
end $$;

-- 6. Anything but a list is refused.
do $$
declare bad jsonb; refused boolean;
begin
  foreach bad in array array['{}'::jsonb, '"text"'::jsonb, 'null'::jsonb, null::jsonb] loop
    refused := false;
    begin
      perform public.nexus_index_reconciliation(bad, true, 10);
    exception when others then
      if sqlerrm like '%NR:INVALID_SCOPE%' then refused := true; else raise; end if;
    end;
    if not refused then raise exception 'index input % was accepted', bad; end if;
  end loop;
end $$;

-- 7. Neither report can change anything, and only the service role can run them: as the gateway does, with the
--    rights it has on hosted Supabase.
do $$
declare fn text;
begin
  foreach fn in array array['public.nexus_storage_reconciliation(integer,integer)', 'public.nexus_index_reconciliation(jsonb,boolean,integer)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'a browser role can run %', fn; end if;
    if not has_function_privilege('service_role', fn, 'execute') then raise exception 'the service role cannot run %', fn; end if;
    if (select provolatile from pg_proc where oid = fn::regprocedure) <> 's' then raise exception '% is not read-only', fn; end if;
  end loop;
  if not (select prosecdef from pg_proc where oid = 'public.nexus_storage_reconciliation(integer,integer)'::regprocedure) then
    raise exception 'the storage report must read storage.objects with its owner''s rights'; end if;
end $$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
declare report jsonb;
begin
  report := public.nexus_storage_reconciliation(3600, 1000);
  if not exists (select 1 from jsonb_array_elements(report->'unreferenced_objects'->'objects') o where o->>'name' = 'reconcile/orphan-old.pdf') then
    raise exception 'the service role does not get the storage report'; end if;
  report := public.nexus_index_reconciliation('[{"value":"ec2fffff-0000-4000-8000-000000000001","count":5}]'::jsonb, true, 1000);
  if (report->'orphaned_entries'->>'versions')::int <> 1
     or not exists (select 1 from jsonb_array_elements(report->'unindexed_versions'->'rows') r where r->>'document_id' = 'ec100000-0000-4000-8000-000000000007') then
    raise exception 'the service role does not get the index report: %', report; end if;
end $$;
rollback;
select 'RECONCILIATION_SQL_PASS';
