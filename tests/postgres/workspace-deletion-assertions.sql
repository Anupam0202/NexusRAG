\set ON_ERROR_STOP on
-- Deleting a workspace removes every row it owns from every table, only for its owner, only after its jobs have
-- stopped and its stored copies are verified gone, and touches no other workspace. Runs against the main
-- fixture workspace with whatever the earlier assertion files left in it, inside a transaction that is rolled
-- back. Called the way the gateway calls it: as the service role.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';
update auth.users set email_confirmed_at = now()
 where id in ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333');

-- What other assertion files may not have left: an editor, a conversation, a workbench run with an event, an
-- upload in progress, a running job and an open document deletion. Written with triggers off.
set local session_replication_role = replica;
insert into public.workspace_members(workspace_id, user_id, role)
values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'editor') on conflict do nothing;
insert into public.documents(id, workspace_id, uploaded_by, filename, original_filename, status, storage_path, lifecycle_state)
values ('af100000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'kept-until-now.txt', 'kept-until-now.txt', 'ready',
        '11111111-1111-4111-8111-111111111111/af100000-0000-4000-8000-000000000001/v/kept-until-now.txt', 'active'),
       ('af100000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'being-deleted.txt', 'being-deleted.txt', 'ready', null, 'deleting');
insert into public.deletion_operations(id, workspace_id, resource_id, tombstone_epoch, state)
values ('af200000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'af100000-0000-4000-8000-000000000002', 2, 'blocked');
insert into public.deletion_targets(workspace_id, operation_id, kind, resource_id)
values ('11111111-1111-4111-8111-111111111111', 'af200000-0000-4000-8000-000000000001', 'chunks', 'af100000-0000-4000-8000-000000000002');
insert into public.document_uploads(id, workspace_id, actor_id, document_id, lifecycle_epoch, filename, content_type, expected_bytes,
  original_bucket, original_key, begin_key, begin_hash)
values ('af300000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'af100000-0000-4000-8000-000000000003', 1, 'arriving.txt', 'text/plain', 10, 'documents',
        '11111111-1111-4111-8111-111111111111/af100000-0000-4000-8000-000000000003/v/arriving.txt', 'begin-1', repeat('b', 64));
insert into public.chat_sessions(id, workspace_id, user_id, title)
values ('af400000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333', 'a question');
insert into public.chat_messages(workspace_id, session_id, role, content)
values ('11111111-1111-4111-8111-111111111111', 'af400000-0000-4000-8000-000000000001', 'user', 'a question'),
       ('11111111-1111-4111-8111-111111111111', 'af400000-0000-4000-8000-000000000001', 'assistant', 'an answer');
insert into public.ingestion_jobs(id, workspace_id, status, kind, lease_owner, lease_expires_at)
values ('af500000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'completed', 'queries', null, null),
       ('af500000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'processing', 'ingestion', 'worker',
        clock_timestamp() + interval '10 minutes'),
       ('af500000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'queued', 'ingestion', null, null);
insert into public.usage_reservations(id, workspace_id, actor_id, operation_id, reserved_queries, reserved_tokens, state, expires_at)
values ('af510000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        gen_random_uuid(), 1, 1, 'settled', now());
insert into public.query_runs(id, workspace_id, user_id, session_id, job_id, reservation_id, idempotency_key, payload_hash, request,
  context, state, deadline)
values ('af600000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        'af400000-0000-4000-8000-000000000001', 'af500000-0000-4000-8000-000000000001', 'af510000-0000-4000-8000-000000000001',
        'workspace-deletion-run', repeat('c', 64), '{"mode":"ask","question":"q"}', '{}', 'completed', now());
insert into public.query_events(workspace_id, run_id, sequence, event_id, event_hash, event_type, attempt_id, payload)
values ('11111111-1111-4111-8111-111111111111', 'af600000-0000-4000-8000-000000000001', 1, gen_random_uuid(), repeat('e', 64),
        'token', gen_random_uuid(), '{"text":"streamed"}');
set local session_replication_role = origin;

-- Row counts of every other workspace, to compare afterwards.
create temporary table other_rows(phase text, table_name text, workspace_id uuid, rows bigint);
create function pg_temp.count_other_rows(p_phase text) returns void language plpgsql as $$
declare item record; begin
  for item in
    select c.relname::text as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'workspace_id' and not a.attisdropped
       and c.relname::text not in ('audit_events', 'deletion_operations', 'deletion_targets', 'deletion_receipts')
  loop
    -- Rows without a workspace (shared budgets, for example) are counted under the nil id, so they compare too.
    execute format('insert into other_rows select $1, $2, coalesce(workspace_id, ''00000000-0000-0000-0000-000000000000''), count(*)
                      from public.%I where workspace_id is distinct from $3 group by 3', item.table_name)
      using p_phase, item.table_name, '11111111-1111-4111-8111-111111111111'::uuid;
  end loop;
end $$;
select pg_temp.count_other_rows('before');

set local role service_role;
do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; operation uuid;
begin
  -- 1. Only the owner deletes the workspace; an editor cannot, nor can an owner whose account is unconfirmed.
  begin
    perform public.nexus_begin_workspace_deletion(w, '33333333-3333-4333-8333-333333333333');
    raise exception 'an editor deleted the workspace';
  exception when raise_exception then if sqlerrm <> 'NR:FORBIDDEN' then raise; end if; end;

  -- 2. The owner's request hides the workspace at once and records one deletion with three things to clean up.
  r := public.nexus_begin_workspace_deletion(w, a);
  operation := (r->>'operation_id')::uuid;
  if r->>'state' <> 'STARTED' or operation is null then raise exception 'deletion did not start: %', r; end if;
  if (select lifecycle_state from public.workspaces where id = w) <> 'deleting' then raise exception 'the workspace is still active'; end if;
  if (select string_agg(kind, ',' order by kind) from public.deletion_targets where operation_id = operation)
     <> 'workspace_index,workspace_originals,workspace_rows' then
    raise exception 'unexpected cleanup targets'; end if;
  if (public.nexus_begin_workspace_deletion(w, a)->>'operation_id')::uuid <> operation then
    raise exception 'asking again started a second deletion'; end if;

  -- 3. Nothing is erased while a job may still be writing; jobs that had not started are cancelled.
  r := public.nexus_begin_workspace_purge(w, operation);
  if r->>'state' <> 'WAITING' or r->>'reason' <> 'JOB_RUNNING' then raise exception 'a running job was not waited for: %', r; end if;
  if (select status from public.ingestion_jobs where id = 'af500000-0000-4000-8000-000000000003') <> 'cancelled' then
    raise exception 'a queued job was not cancelled'; end if;
  if (select cancellation_requested_at from public.ingestion_jobs where id = 'af500000-0000-4000-8000-000000000002') is null then
    raise exception 'the running job was not asked to stop'; end if;
end $$;

-- The running job stops (as its worker would).
reset role;
update public.ingestion_jobs set status = 'cancelled', lease_owner = null, lease_expires_at = null
 where id = 'af500000-0000-4000-8000-000000000002';
set local role service_role;

do $$
declare
  w constant uuid := '11111111-1111-4111-8111-111111111111';
  operation uuid := (select id from public.deletion_operations where workspace_id = w and resource_id = w and state <> 'verified');
  r jsonb;
begin
  -- 4. With the jobs stopped, the gateway is handed every original the database knows of.
  r := public.nexus_begin_workspace_purge(w, operation);
  if r->>'state' <> 'READY' or jsonb_array_length(r->'targets') <> 2
     or not (r->'originals' ? '11111111-1111-4111-8111-111111111111/af100000-0000-4000-8000-000000000001/v/kept-until-now.txt')
     or not (r->'originals' ? '11111111-1111-4111-8111-111111111111/af100000-0000-4000-8000-000000000003/v/arriving.txt') then
    raise exception 'unexpected purge start: %', r; end if;

  -- 5. Rows go only after the index entries and the originals are verified gone.
  r := public.nexus_purge_workspace(w, operation);
  if r->>'state' <> 'BLOCKED' or r->>'reason' <> 'STORED_COPIES_REMAIN' then raise exception 'rows went first: %', r; end if;
  if (select lifecycle_state from public.workspaces where id = w) <> 'deleting' then raise exception 'the workspace changed'; end if;

  -- What the gateway records once Qdrant and Storage confirm the copies are gone.
  update public.deletion_targets set verified_at = clock_timestamp(), attempts = attempts + 1
   where operation_id = operation and kind in ('workspace_index', 'workspace_originals');
  insert into public.deletion_receipts(workspace_id, operation_id, target_id, provider, receipt_hash, verified_at)
  select w, operation, id, case kind when 'workspace_index' then 'qdrant' else 'supabase_storage' end, repeat('a', 64), clock_timestamp()
    from public.deletion_targets where operation_id = operation and kind in ('workspace_index', 'workspace_originals');

  -- 6. Every row goes, and the receipts say so.
  r := public.nexus_purge_workspace(w, operation);
  if r->>'state' <> 'VERIFIED' or (r->>'receipts')::int <> 3 or (r->'removed'->>'chat_sessions')::int < 1
     or (r->'removed'->>'documents')::int < 2 or (r->'removed'->>'members')::int < 2 then
    raise exception 'unexpected purge: %', r; end if;
  -- Asking again changes nothing and says it is done.
  if public.nexus_purge_workspace(w, operation)->>'state' <> 'VERIFIED'
     or public.nexus_begin_workspace_deletion(w, '22222222-2222-4222-8222-222222222222')->>'state' <> 'NOT_FOUND' then
    raise exception 'a finished deletion did not stay finished'; end if;
end $$;
reset role;

-- 7. Nothing of the workspace is left anywhere; its deletion record, its receipts and one audit event remain.
do $$
declare item record; found_rows boolean; leftovers text := '';
begin
  for item in
    select c.relname::text as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r' and a.attname = 'workspace_id' and not a.attisdropped
       and c.relname::text not in ('deletion_operations', 'deletion_targets', 'deletion_receipts')
  loop
    execute format('select exists (select 1 from public.%I where workspace_id = $1)', item.table_name)
      into found_rows using '11111111-1111-4111-8111-111111111111'::uuid;
    if found_rows then leftovers := leftovers || item.table_name || ' '; end if;
  end loop;
  if leftovers <> '' then raise exception 'rows of the deleted workspace remain in: %', leftovers; end if;
  if exists (select 1 from public.workspaces where id = '11111111-1111-4111-8111-111111111111') then
    raise exception 'the workspace row remains'; end if;
  if exists (select 1 from public.deletion_operations where workspace_id = '11111111-1111-4111-8111-111111111111' and state <> 'verified') then
    raise exception 'an open deletion of the workspace was left open'; end if;
  if (select count(*) from public.audit_events where action = 'workspace.delete' and workspace_id is null
        and metadata->>'workspace_id' = '11111111-1111-4111-8111-111111111111'
        and user_id = '22222222-2222-4222-8222-222222222222') <> 1 then
    raise exception 'the deletion was not recorded in the audit trail'; end if;
end $$;

-- 8. Every other workspace still has exactly what it had.
select pg_temp.count_other_rows('after');
do $$
begin
  if exists (
    select 1 from (select table_name, workspace_id, rows from other_rows where phase = 'before') b
      full join (select table_name, workspace_id, rows from other_rows where phase = 'after') a using (table_name, workspace_id)
     where b.rows is distinct from a.rows) then
    raise exception 'another workspace lost or gained rows'; end if;
  if not exists (select 1 from other_rows where phase = 'before') then raise exception 'the comparison saw no other workspace'; end if;
end $$;

-- 9. The cron finds an unfinished deletion once, then waits before trying it again.
set local role service_role;
do $$
declare
  w constant uuid := '44444444-4444-4444-8444-444444444444';
  claimed jsonb;
begin
  perform public.nexus_begin_workspace_deletion(w, '33333333-3333-4333-8333-333333333333');
  claimed := public.nexus_claim_workspace_purges(5);
  if jsonb_array_length(claimed) <> 1 or claimed->0->>'workspace_id' <> w::text then
    raise exception 'unexpected claim: %', claimed; end if;
  if jsonb_array_length(public.nexus_claim_workspace_purges(5)) <> 0 then raise exception 'a deletion was claimed twice at once'; end if;
end $$;
reset role;

-- 10. Browser roles can use none of it.
do $$
declare fn text;
begin
  foreach fn in array array['public.nexus_begin_workspace_deletion(uuid,uuid)', 'public.nexus_begin_workspace_purge(uuid,uuid)',
                            'public.nexus_purge_workspace(uuid,uuid)', 'public.nexus_claim_workspace_purges(integer)'] loop
    if has_function_privilege('anon', fn, 'execute') or has_function_privilege('authenticated', fn, 'execute') then
      raise exception 'a browser role can run %', fn; end if;
  end loop;
end $$;
rollback;
select 'WORKSPACE_DELETION_SQL_PASS';
