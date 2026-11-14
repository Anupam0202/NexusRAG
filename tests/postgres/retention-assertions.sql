\set ON_ERROR_STOP on
-- A retention run may remove only what is older than the schedule allows, only under the lease it was handed,
-- and only for an owner or administrator; what a saved finding or a Radar page still cites stays.
-- Called the way the gateway calls it: as the service role. Fixtures live in a workspace of their own.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';
update auth.users set email_confirmed_at = now()
 where id in ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', 'a6000000-0000-4000-8000-000000000001');

-- Written as the database owner with triggers off, so the dates stay as set.
set local session_replication_role = replica;
insert into public.workspaces(id, name, slug, owner_id)
values ('ae500000-0000-4000-8000-000000000001', 'Retention', 'retention-assertions', '22222222-2222-4222-8222-222222222222');
insert into public.workspace_members(workspace_id, user_id, role)
values ('ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'owner'),
       ('ae500000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'editor');
insert into public.documents(id, workspace_id, uploaded_by, filename, original_filename, status, created_at)
select ('ae100000-0000-4000-8000-0000000000' || n)::uuid, w::uuid, '22222222-2222-4222-8222-222222222222', name, name, 'ready',
       now() - age::interval
  from (values ('01', 'ae500000-0000-4000-8000-000000000001', 'oldest.txt', '45 days'),
               ('02', 'ae500000-0000-4000-8000-000000000001', 'old.txt', '40 days'),
               ('03', 'ae500000-0000-4000-8000-000000000001', 'old-radar-page.txt', '35 days'),
               ('04', 'ae500000-0000-4000-8000-000000000001', 'recent.txt', '2 days'),
               ('05', '44444444-4444-4444-8444-444444444444', 'other-workspace.txt', '90 days')) d(n, w, name, age);
insert into public.radar_snapshots(id, workspace_id, source_id, revision, document_id, version_id, document_original_hash,
  document_original_bytes, selection_hash, normalized_hash, chunk_ids, selections, selected_utf8_bytes, stored_chunk_count,
  comparison_complete, captured_at, actor_id, rights_rationale, rights_receipts, change_id)
values ('ae800000-0000-4000-8000-000000000003', 'ae500000-0000-4000-8000-000000000001', 'ae900000-0000-4000-8000-000000000001', 1,
        'ae100000-0000-4000-8000-000000000003', 'ae200000-0000-4000-8000-000000000003', repeat('d', 64), 64, repeat('a', 64),
        repeat('b', 64), '["ae000000-0000-4000-8000-000000000001"]', '[{"id":"ae000000-0000-4000-8000-000000000001"}]', 10, 1, true,
        now(), '22222222-2222-4222-8222-222222222222', 'synthetic', '[]', 'aea00000-0000-4000-8000-000000000001');
-- 1: an open chat, unused for 60 days. 2: a workbench conversation, unused for 50 days. 3: started 40 days ago, used
-- yesterday. 4: from two days ago. 5: in another workspace.
insert into public.chat_sessions(id, workspace_id, user_id, title, created_at, updated_at)
select ('ae400000-0000-4000-8000-00000000000' || n)::uuid, w::uuid, u::uuid, title, now() - made::interval, now() - used::interval
  from (values ('1', 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'a question from long ago', '60 days', '60 days'),
               ('2', 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'a workbench question', '50 days', '50 days'),
               ('3', 'ae500000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'started long ago', '40 days', '1 day'),
               ('4', 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'recent', '2 days', '2 days'),
               ('5', '44444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'elsewhere', '90 days', '90 days')) s(n, w, u, title, made, used);
insert into public.chat_messages(workspace_id, session_id, role, content, created_at)
select w::uuid, ('ae400000-0000-4000-8000-00000000000' || n)::uuid, r, 'message ' || r, now() - age::interval
  from (values ('ae500000-0000-4000-8000-000000000001', '1', '60 days'), ('ae500000-0000-4000-8000-000000000001', '2', '50 days'),
               ('ae500000-0000-4000-8000-000000000001', '3', '40 days'), ('ae500000-0000-4000-8000-000000000001', '3', '1 day'),
               ('ae500000-0000-4000-8000-000000000001', '4', '2 days'), ('44444444-4444-4444-8444-444444444444', '5', '90 days')) m(w, n, age)
 cross join unnest(array['user', 'assistant']) r;
-- Workbench runs: 1 is old, 2 is old and cited by a saved finding, 3 is recent. Changing a row inserted in this
-- transaction checks its foreign keys again, so each run gets a real job and reservation.
insert into public.ingestion_jobs(id, workspace_id, status, kind)
select ('ae300000-0000-4000-8000-00000000000' || n)::uuid, 'ae500000-0000-4000-8000-000000000001', 'completed', 'queries'
  from unnest(array['1', '2', '3']) n;
insert into public.usage_reservations(id, workspace_id, actor_id, operation_id, reserved_queries, reserved_tokens, state, expires_at)
select ('ae310000-0000-4000-8000-00000000000' || n)::uuid, 'ae500000-0000-4000-8000-000000000001',
       '22222222-2222-4222-8222-222222222222', gen_random_uuid(), 1, 1, 'settled', now()
  from unnest(array['1', '2', '3']) n;
insert into public.query_runs(id, workspace_id, user_id, session_id, job_id, reservation_id, idempotency_key, payload_hash, request,
  context, state, deadline, created_at, final_answer)
select ('ae600000-0000-4000-8000-00000000000' || n)::uuid, 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
       ('ae400000-0000-4000-8000-00000000000' || s)::uuid, ('ae300000-0000-4000-8000-00000000000' || n)::uuid,
       ('ae310000-0000-4000-8000-00000000000' || n)::uuid, 'run-' || n, repeat('c', 64),
       jsonb_build_object('mode', 'ask', 'question', 'workbench question ' || n), '{}', 'completed', now() - age::interval,
       now() - age::interval, jsonb_build_object('markdown', 'workbench answer ' || n)
  from (values ('1', '2', '50 days'), ('2', '3', '40 days'), ('3', '3', '1 day')) r(n, s, age);
insert into public.query_events(workspace_id, run_id, sequence, event_id, event_hash, event_type, attempt_id, payload)
select 'ae500000-0000-4000-8000-000000000001', ('ae600000-0000-4000-8000-00000000000' || n)::uuid, 1, gen_random_uuid(),
       repeat('e', 64), 'token', gen_random_uuid(), jsonb_build_object('text', 'streamed answer ' || n)
  from unnest(array['1', '2', '3']) n;
-- Research runs: 1 is old, 2 is old and cited by a saved finding, 3 is recent.
insert into public.research_runs(id, workspace_id, owner_id, plan_id, idempotency_key, mode, questions, source_snapshot, state,
  admission, created_at)
select ('ae700000-0000-4000-8000-00000000000' || n)::uuid, 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
       gen_random_uuid(), 'research-' || n, 'QUICK_LOOKUP', '["a research question"]', '[{"document_id":"x"}]', 'completed', '{}',
       now() - age::interval
  from (values ('1', '50 days'), ('2', '50 days'), ('3', '1 day')) r(n, age);
insert into public.findings(id, workspace_id, owner_id, title, create_key, payload_hash, source_run_id)
values ('aeb00000-0000-4000-8000-000000000001', 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
        'kept from a run', 'finding-1', repeat('f', 64), 'ae600000-0000-4000-8000-000000000002');
insert into public.findings(id, workspace_id, owner_id, title, create_key, payload_hash, source_research_run_id, source_research_position)
values ('aeb00000-0000-4000-8000-000000000002', 'ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
        'kept from research', 'finding-2', repeat('f', 64), 'ae700000-0000-4000-8000-000000000002', 0);
insert into public.workbench_mutations(workspace_id, actor_id, operation, idempotency_key, payload_hash, response, created_at)
values ('ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'conversation.create', 'old', repeat('h', 64),
        '{"title":"a workbench question"}', now() - interval '50 days'),
       ('ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'conversation.create', 'new', repeat('h', 64),
        '{"title":"recent"}', now() - interval '1 day'),
       ('ae500000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'finding.package', 'old', repeat('h', 64),
        '{}', now() - interval '50 days');
set local session_replication_role = origin;

set local role service_role;
do $$
declare
  w constant uuid := 'ae500000-0000-4000-8000-000000000001';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; claim jsonb; lease timestamptz;
begin
  -- 1. Only an owner or administrator changes the schedule, within its bounds.
  begin
    perform public.nexus_set_retention(w, '33333333-3333-4333-8333-333333333333', true, 30);
    raise exception 'an editor changed the retention schedule';
  exception when raise_exception then if sqlerrm <> 'NR:FORBIDDEN' then raise; end if; end;
  begin
    perform public.nexus_set_retention(w, 'a6000000-0000-4000-8000-000000000001', true, 30);
    raise exception 'someone outside the workspace changed its retention schedule';
  exception when raise_exception then if sqlerrm <> 'NR:FORBIDDEN' then raise; end if; end;
  begin
    perform public.nexus_set_retention(w, a, true, 0);
    raise exception 'a zero-day retention was accepted';
  exception when raise_exception then if sqlerrm <> 'NR:INVALID_SCOPE' then raise; end if; end;
  begin
    perform public.nexus_set_retention(w, a, true, 3651);
    raise exception 'a retention beyond ten years was accepted';
  exception when raise_exception then if sqlerrm <> 'NR:INVALID_SCOPE' then raise; end if; end;
  r := public.nexus_set_retention(w, a, true, 30);
  if r->>'retention_enabled' <> 'true' or (r->>'retention_days')::int <> 30
     or (r->>'next_retention_at')::timestamptz > clock_timestamp() then
    raise exception 'turning retention on did not make a run due: %', r; end if;

  -- 2. A run needs the lease it was handed.
  claim := public.claim_workspace_retention(w, a, 'worker-1', 300);
  lease := (claim->>'retention_lease_expires_at')::timestamptz;
  begin
    perform public.nexus_retention_sweep(w, 'worker-2', lease, 25, a);
    raise exception 'a run without the lease went ahead';
  exception when raise_exception then if sqlerrm <> 'NR:VERSION_CONFLICT' then raise; end if; end;

  -- 3. A run removes what is older than the cutoff, a bounded batch of documents at a time.
  r := public.nexus_retention_sweep(w, 'worker-1', lease, 1, a);
  if jsonb_array_length(r->'documents') <> 1 or r->'documents'->0->>'document_id' <> 'ae100000-0000-4000-8000-000000000001'
     or r->>'more' <> 'true' or (r->>'documents_kept_for_radar')::int <> 1
     or (r->>'chat_messages_deleted')::int <> 6 or (r->>'chat_sessions_deleted')::int <> 2 or (r->>'chat_titles_cleared')::int <> 1
     or (r->>'workbench_runs_redacted')::int <> 1 or (r->>'research_runs_deleted')::int <> 1
     or (r->>'runs_kept_for_findings')::int <> 2 or (r->>'retry_copies_deleted')::int <> 1 then
    raise exception 'unexpected first run: %', r; end if;
  if (select lifecycle_state from public.documents where id = 'ae100000-0000-4000-8000-000000000001') <> 'deleting'
     or not exists (select 1 from public.deletion_operations where id = (r->'documents'->0->>'operation_id')::uuid) then
    raise exception 'the expired document was not marked for deletion through the tombstone'; end if;

  -- 4. The next batch takes the rest; a Radar page is kept and does not count as still due.
  r := public.nexus_retention_sweep(w, 'worker-1', lease, 25, a);
  if jsonb_array_length(r->'documents') <> 1 or r->'documents'->0->>'document_id' <> 'ae100000-0000-4000-8000-000000000002'
     or (r->>'documents_kept_for_radar')::int <> 1 or r->>'more' <> 'false' or (r->>'chat_messages_deleted')::int <> 0
     or (r->>'chat_sessions_deleted')::int <> 0 or (r->>'workbench_runs_redacted')::int <> 0 then
    raise exception 'unexpected second run: %', r; end if;
  if public.finish_retention_claim(w, 'worker-1', lease, 30, true) is not true then raise exception 'claim not finished'; end if;
end $$;

-- 5. Exactly the old content went; what is recent, cited, or in another workspace stayed.
do $$
begin
  if (select string_agg(right(id::text, 2) || '=' || lifecycle_state, ',' order by id) from public.documents where id::text like 'ae100000-%')
     <> '01=deleting,02=deleting,03=active,04=active,05=active' then
    raise exception 'retention touched the wrong documents'; end if;
  if exists (select 1 from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000001') then
    raise exception 'an unused chat was not removed'; end if;
  if (select (deleted_at is not null and title is null) from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000002') is not true then
    raise exception 'an unused workbench conversation was not closed'; end if;
  if (select (deleted_at is null and title is null) from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000003') is not true
     or (select title from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000004') <> 'recent'
     or (select title from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000005') <> 'elsewhere' then
    raise exception 'conversations in use were changed wrongly'; end if;
  if (select string_agg(right(session_id::text, 1) || ':' || count, ',' order by session_id)
        from (select session_id, count(*) from public.chat_messages where session_id::text like 'ae400000-%' group by session_id) c)
     <> '3:2,4:2,5:2' then
    raise exception 'messages were not removed exactly'; end if;
  if exists (select 1 from public.chat_messages where session_id = 'ae400000-0000-4000-8000-000000000003'
               and created_at < now() - interval '30 days') then
    raise exception 'an old message survived in a conversation still in use'; end if;
  if (select string_agg(right(id::text, 1) || '=' || (request->>'question') || '/' || coalesce(final_answer->>'markdown', '-'), ',' order by id)
        from public.query_runs where id::text like 'ae600000-%')
     <> '1=[deleted]/-,2=workbench question 2/workbench answer 2,3=workbench question 3/workbench answer 3' then
    raise exception 'workbench runs were not redacted exactly'; end if;
  if (select string_agg(right(run_id::text, 1) || '=' || payload::text || '/' || (redacted_at is not null)::text, ',' order by run_id)
        from public.query_events where run_id::text like 'ae600000-%')
     <> '1={}/true,2={"text": "streamed answer 2"}/false,3={"text": "streamed answer 3"}/false' then
    raise exception 'workbench events were not redacted exactly'; end if;
  if (select string_agg(right(id::text, 1), ',' order by id) from public.research_runs where id::text like 'ae700000-%') <> '2,3' then
    raise exception 'research runs were not removed exactly'; end if;
  if (select count(*) from public.findings where id::text like 'aeb00000-%' and deleted_at is null) <> 2 then
    raise exception 'a saved finding was touched'; end if;
  if (select string_agg(operation || ':' || idempotency_key, ',' order by operation, idempotency_key) from public.workbench_mutations
       where workspace_id = 'ae500000-0000-4000-8000-000000000001') <> 'conversation.create:new,finding.package:old' then
    raise exception 'retry copies were not removed exactly'; end if;
  if (select (last_retention_at is not null and next_retention_at > now() + interval '23 hours' and retention_lease_owner is null)
        from public.workspace_settings where workspace_id = 'ae500000-0000-4000-8000-000000000001') is not true then
    raise exception 'the finished run was not recorded'; end if;
end $$;

do $$
declare
  w constant uuid := 'ae500000-0000-4000-8000-000000000001';
  a constant uuid := '22222222-2222-4222-8222-222222222222';
  r jsonb; claim jsonb; due record;
begin
  -- 6. A scheduled run acts for the workspace owner.
  perform public.nexus_set_retention(w, a, true, 1);
  select * into due from public.claim_retention_schedules('worker-3', 500, 300) where workspace_id = w;
  if due.workspace_id is null then raise exception 'a due schedule was not handed out'; end if;
  r := public.nexus_retention_sweep(w, 'worker-3', due.retention_lease_expires_at, 25);
  if jsonb_array_length(r->'documents') <> 1 or r->'documents'->0->>'document_id' <> 'ae100000-0000-4000-8000-000000000004' then
    raise exception 'unexpected scheduled run: %', r; end if;
  if exists (select 1 from public.chat_sessions where id = 'ae400000-0000-4000-8000-000000000004') then
    raise exception 'the scheduled run kept a conversation unused for two days'; end if;
  perform public.finish_retention_claim(w, 'worker-3', due.retention_lease_expires_at, 1, true);

  -- 7. Turning it off stops a run in progress and keeps the number of days for next time.
  perform public.nexus_set_retention(w, a, true, 7);
  claim := public.claim_workspace_retention(w, a, 'worker-4', 300);
  r := public.nexus_set_retention(w, a, false, null);
  if r->>'retention_enabled' <> 'false' or (r->>'retention_days')::int <> 7 or r->>'next_retention_at' is not null then
    raise exception 'turning retention off failed: %', r; end if;
  begin
    perform public.nexus_retention_sweep(w, 'worker-4', (claim->>'retention_lease_expires_at')::timestamptz, 25, a);
    raise exception 'a run went on after retention was turned off';
  exception when raise_exception then if sqlerrm <> 'NR:VERSION_CONFLICT' then raise; end if; end;
  if public.claim_workspace_retention(w, a, 'worker-5', 300) is not null then raise exception 'a disabled schedule was claimed'; end if;
end $$;
reset role;

-- 8. Browser roles can use none of it.
do $$
begin
  if has_function_privilege('anon', 'public.nexus_set_retention(uuid,uuid,boolean,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_set_retention(uuid,uuid,boolean,integer)', 'execute')
     or has_function_privilege('anon', 'public.nexus_retention_sweep(uuid,text,timestamptz,integer,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_retention_sweep(uuid,text,timestamptz,integer,uuid)', 'execute') then
    raise exception 'a browser role can run retention'; end if;
end $$;
rollback;
select 'RETENTION_SQL_PASS';
