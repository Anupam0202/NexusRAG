\set ON_ERROR_STOP on
-- Deleting an account removes the workspaces the person owns and their private material elsewhere, hands what
-- they contributed to other people's workspaces to those workspaces, and leaves nothing that stops Supabase Auth
-- from removing the sign-in. Called the way the gateway calls it: as the service role. Rolled back.
begin;
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';

-- C owns workspace WC and is an editor in workspace W (owned by A). Written with triggers off.
set local session_replication_role = replica;
insert into auth.users(id, email, email_confirmed_at)
values ('af0c0000-0000-4000-8000-00000000000c', 'c-deletes-account@example.invalid', now()),
       ('af0d0000-0000-4000-8000-00000000000d', 'd-deletes-account@example.invalid', now());
insert into public.profiles(id) values ('af0c0000-0000-4000-8000-00000000000c'), ('af0d0000-0000-4000-8000-00000000000d');
update auth.users set email_confirmed_at = now() where id = '22222222-2222-4222-8222-222222222222';
insert into public.workspaces(id, name, slug, owner_id)
values ('af5c0000-0000-4000-8000-00000000000c', 'C workspace', 'c-workspace-account-deletion', 'af0c0000-0000-4000-8000-00000000000c');
insert into public.workspace_members(workspace_id, user_id, role)
values ('af5c0000-0000-4000-8000-00000000000c', 'af0c0000-0000-4000-8000-00000000000c', 'owner'),
       ('af5c0000-0000-4000-8000-00000000000c', '22222222-2222-4222-8222-222222222222', 'editor'),
       ('11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'editor');
insert into public.documents(id, workspace_id, uploaded_by, filename, original_filename, status)
values ('af1c0000-0000-4000-8000-000000000001', 'af5c0000-0000-4000-8000-00000000000c', 'af0c0000-0000-4000-8000-00000000000c', 'own.txt', 'own.txt', 'ready'),
       ('af1c0000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'shared.txt', 'shared.txt', 'ready');
-- In W: a private chat, a workbench conversation with a run, an unshared and a shared finding, invitations.
insert into public.chat_sessions(id, workspace_id, user_id, title)
values ('af4c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'c private'),
       ('af4c0000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'c workbench');
insert into public.chat_messages(workspace_id, session_id, role, content)
values ('11111111-1111-4111-8111-111111111111', 'af4c0000-0000-4000-8000-000000000001', 'user', 'c question'),
       ('11111111-1111-4111-8111-111111111111', 'af4c0000-0000-4000-8000-000000000001', 'assistant', 'c answer');
insert into public.ingestion_jobs(id, workspace_id, status, kind)
values ('af3c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'completed', 'queries');
insert into public.usage_reservations(id, workspace_id, actor_id, operation_id, reserved_queries, reserved_tokens, state, expires_at)
values ('af3d0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c',
        gen_random_uuid(), 1, 1, 'settled', now());
insert into public.query_runs(id, workspace_id, user_id, session_id, job_id, reservation_id, idempotency_key, payload_hash, request,
  context, state, deadline, final_answer)
values ('af6c0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c',
        'af4c0000-0000-4000-8000-000000000002', 'af3c0000-0000-4000-8000-000000000001', 'af3d0000-0000-4000-8000-000000000001',
        'c-run', repeat('c', 64), '{"mode":"ask","question":"c workbench question"}', '{}', 'completed', now(), '{"markdown":"c workbench answer"}');
insert into public.query_events(workspace_id, run_id, sequence, event_id, event_hash, event_type, attempt_id, payload)
values ('11111111-1111-4111-8111-111111111111', 'af6c0000-0000-4000-8000-000000000001', 1, gen_random_uuid(), repeat('e', 64),
        'token', gen_random_uuid(), '{"text":"c streamed"}');
insert into public.findings(id, workspace_id, owner_id, title, create_key, payload_hash)
values ('afbc0000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'c private finding', 'c-1', repeat('f', 64)),
       ('afbc0000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'c shared finding', 'c-2', repeat('f', 64));
insert into public.finding_versions(workspace_id, finding_id, revision, author_id, title, authored_markdown)
values ('11111111-1111-4111-8111-111111111111', 'afbc0000-0000-4000-8000-000000000001', 1, 'af0c0000-0000-4000-8000-00000000000c', 'c private finding', 'c notes'),
       ('11111111-1111-4111-8111-111111111111', 'afbc0000-0000-4000-8000-000000000002', 1, 'af0c0000-0000-4000-8000-00000000000c', 'c shared finding', 'c shared notes');
insert into public.finding_reviews(workspace_id, finding_id, revision, reviewer_id, decision, comment)
values ('11111111-1111-4111-8111-111111111111', 'afbc0000-0000-4000-8000-000000000001', 1, '22222222-2222-4222-8222-222222222222', 'approved', 'fine');
insert into public.finding_participants(workspace_id, finding_id, user_id, permission)
values ('11111111-1111-4111-8111-111111111111', 'afbc0000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'read');
insert into public.workspace_invitations(workspace_id, created_by, recipient_email, role, token_hash, idempotency_key, payload_hash, state, accepted_by)
values ('11111111-1111-4111-8111-111111111111', 'af0c0000-0000-4000-8000-00000000000c', 'someone@example.invalid', 'viewer', repeat('1', 64), 'c-invite', repeat('2', 64), 'pending', null),
       ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'c-deletes-account@example.invalid', 'editor', repeat('3', 64), 'c-accepted', repeat('4', 64), 'accepted', 'af0c0000-0000-4000-8000-00000000000c');
-- D asks to delete an account that owns nothing, to test the cron's claim.
insert into public.account_deletions(user_id) values ('af0d0000-0000-4000-8000-00000000000d');
set local session_replication_role = origin;

set local role service_role;
do $$
declare
  c constant uuid := 'af0c0000-0000-4000-8000-00000000000c';
  r jsonb; operation uuid;
begin
  -- 1. The request starts the owned workspace's deletion and cleans up what C left in W.
  r := public.nexus_begin_account_deletion(c);
  if r->>'state' <> 'STARTED' or jsonb_array_length(r->'workspaces') <> 1
     or r->'workspaces'->0->>'workspace_id' <> 'af5c0000-0000-4000-8000-00000000000c'
     or (r->'removed'->>'conversations')::int <> 2 or (r->'removed'->>'messages')::int <> 2
     or (r->'removed'->>'findings_deleted')::int <> 1 or (r->'removed'->>'findings_handed_over')::int <> 1
     or (r->'removed'->>'documents_handed_over')::int <> 1 or (r->'removed'->>'invitations')::int <> 1
     or (r->'removed'->>'memberships')::int <> 1 then
    raise exception 'unexpected start: %', r; end if;
  if (select lifecycle_state from public.workspaces where id = 'af5c0000-0000-4000-8000-00000000000c') <> 'deleting' then
    raise exception 'the owned workspace was not hidden'; end if;
  -- Asking again changes nothing more.
  if public.nexus_begin_account_deletion(c)->>'state' <> 'STARTED' then raise exception 'a repeated request failed'; end if;

  -- 2. The sign-in waits for the owned workspace's erasure.
  if public.nexus_account_deletion_status(c)->>'state' <> 'WAITING' then raise exception 'the sign-in was not held back'; end if;
  operation := (select id from public.deletion_operations where resource_id = 'af5c0000-0000-4000-8000-00000000000c' and state <> 'verified');
  update public.deletion_targets set verified_at = clock_timestamp()
   where operation_id = operation and kind in ('workspace_index', 'workspace_originals');
  if public.nexus_purge_workspace('af5c0000-0000-4000-8000-00000000000c', operation)->>'state' <> 'VERIFIED' then
    raise exception 'the owned workspace was not purged'; end if;
end $$;
reset role;

-- C creates another workspace before the sign-in is removed.
set local session_replication_role = replica;
insert into public.workspaces(id, name, slug, owner_id)
values ('af5c0000-0000-4000-8000-0000000000c2', 'C late workspace', 'c-late-workspace-account-deletion', 'af0c0000-0000-4000-8000-00000000000c');
insert into public.workspace_members(workspace_id, user_id, role)
values ('af5c0000-0000-4000-8000-0000000000c2', 'af0c0000-0000-4000-8000-00000000000c', 'owner');
set local session_replication_role = origin;

set local role service_role;
do $$
declare
  c constant uuid := 'af0c0000-0000-4000-8000-00000000000c';
  late constant uuid := 'af5c0000-0000-4000-8000-0000000000c2';
  operation uuid;
begin
  -- 2b. The next check finds it and deletes it like the first (read in a statement of its own, after the call).
  if public.nexus_account_deletion_status(c)->>'state' <> 'WAITING' then raise exception 'the late workspace did not hold the sign-in'; end if;
  if (select lifecycle_state from public.workspaces where id = late) <> 'deleting' then
    raise exception 'a workspace created after the request was not deleted'; end if;
  operation := (select id from public.deletion_operations where resource_id = late and state <> 'verified');
  update public.deletion_targets set verified_at = clock_timestamp()
   where operation_id = operation and kind in ('workspace_index', 'workspace_originals');
  perform public.nexus_purge_workspace(late, operation);
  if public.nexus_account_deletion_status(c)->>'state' <> 'READY' then raise exception 'the sign-in is still held back'; end if;
end $$;
reset role;

-- 3. What C left in W: private material gone, contributions handed to W's owner, membership and invitations gone.
do $$
begin
  if exists (select 1 from public.chat_sessions where id = 'af4c0000-0000-4000-8000-000000000001')
     or exists (select 1 from public.chat_messages where session_id = 'af4c0000-0000-4000-8000-000000000001') then
    raise exception 'the private conversation remains'; end if;
  if (select (deleted_at is not null and title is null) from public.chat_sessions where id = 'af4c0000-0000-4000-8000-000000000002') is not true
     or (select request->>'question' || '/' || coalesce(final_answer::text, '-') from public.query_runs where id = 'af6c0000-0000-4000-8000-000000000001') <> '[deleted]/-'
     or (select payload::text from public.query_events where run_id = 'af6c0000-0000-4000-8000-000000000001') <> '{}' then
    raise exception 'the workbench conversation was not closed and redacted'; end if;
  if (select deleted_at is not null and title = '[deleted]' from public.findings where id = 'afbc0000-0000-4000-8000-000000000001') is not true
     or (select authored_markdown from public.finding_versions where finding_id = 'afbc0000-0000-4000-8000-000000000001') <> ''
     or exists (select 1 from public.finding_reviews where finding_id = 'afbc0000-0000-4000-8000-000000000001') then
    raise exception 'the unshared finding was not deleted'; end if;
  if (select owner_id::text || '/' || title from public.findings where id = 'afbc0000-0000-4000-8000-000000000002')
     <> '22222222-2222-4222-8222-222222222222/c shared finding' then
    raise exception 'the shared finding was not handed to the workspace owner'; end if;
  if (select uploaded_by from public.documents where id = 'af1c0000-0000-4000-8000-000000000002') <> '22222222-2222-4222-8222-222222222222' then
    raise exception 'the uploaded document was not handed to the workspace owner'; end if;
  if exists (select 1 from public.workspace_members where user_id = 'af0c0000-0000-4000-8000-00000000000c')
     or exists (select 1 from public.workspace_invitations where created_by = 'af0c0000-0000-4000-8000-00000000000c' or accepted_by = 'af0c0000-0000-4000-8000-00000000000c') then
    raise exception 'a membership or invitation remains'; end if;
  if (select count(*) from public.workspace_invitations where idempotency_key = 'c-accepted') <> 1 then
    raise exception 'an invitation C did not create was removed'; end if;
end $$;

-- 4. Supabase Auth can now remove the sign-in, from its own session without the service role's settings.
set local request.jwt.claims = '';
set local request.jwt.claim.role = '';
delete from auth.users where id = 'af0c0000-0000-4000-8000-00000000000c';
set local request.jwt.claims = '{"role":"service_role"}';
set local request.jwt.claim.role = 'service_role';

set local role service_role;
do $$
declare claimed jsonb;
begin
  -- 5. The record closes only once the sign-in and the profile are gone.
  if public.nexus_finish_account_deletion('af0c0000-0000-4000-8000-00000000000c')->>'state' <> 'VERIFIED' then
    raise exception 'the deletion was not closed'; end if;
  begin
    perform public.nexus_finish_account_deletion('af0d0000-0000-4000-8000-00000000000d');
    raise exception 'an account whose sign-in remains was closed';
  exception when raise_exception then if sqlerrm <> 'NR:DELETE_UNVERIFIED' then raise; end if; end;

  -- 6. The cron finds a waiting deletion once, then waits before trying it again.
  claimed := public.nexus_claim_account_deletions(5);
  if claimed <> '["af0d0000-0000-4000-8000-00000000000d"]'::jsonb then raise exception 'unexpected claim: %', claimed; end if;
  if jsonb_array_length(public.nexus_claim_account_deletions(5)) <> 0 then raise exception 'a deletion was claimed twice at once'; end if;
end $$;
reset role;

do $$
begin
  if exists (select 1 from public.profiles where id = 'af0c0000-0000-4000-8000-00000000000c') then
    raise exception 'the profile outlived the sign-in'; end if;
  if (select state from public.account_deletions where user_id = 'af0c0000-0000-4000-8000-00000000000c') <> 'verified' then
    raise exception 'the deletion record was not closed'; end if;
  -- 7. Browser roles can use none of it, and cannot read the records.
  if has_function_privilege('anon', 'public.nexus_begin_account_deletion(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_begin_account_deletion(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_account_deletion_status(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_finish_account_deletion(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.nexus_claim_account_deletions(integer)', 'execute')
     or has_table_privilege('authenticated', 'public.account_deletions', 'select') then
    raise exception 'a browser role can reach account deletion'; end if;
end $$;
rollback;
select 'ACCOUNT_DELETION_SQL_PASS';
