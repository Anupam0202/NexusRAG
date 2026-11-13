-- Lets a person delete their own account (NX-27).
--
-- Before this migration an account could not be deleted at all once it had used the app: its workspace (owner_id)
-- and the documents it uploaded (uploaded_by) hold the person's profile with RESTRICT, its invitations hold the
-- sign-in, and the membership trigger refuses a removal that is not made by the service role, so even the Supabase
-- dashboard's "Delete user" failed. Nothing stored outside the database (originals, index entries) would have gone.
--
--   * nexus_begin_account_deletion records the request and, for the person:
--       - starts the deletion of every workspace they own, with everything in it, for every member
--         (nexus_begin_workspace_deletion; the gateway and its cron finish them);
--       - in other people's workspaces, removes their private conversations (and the questions and answers of
--         their workbench runs) and their unshared findings; hands the documents they uploaded and the findings
--         they shared to that workspace's owner, since those belong to the workspace; removes their invitations
--         and their memberships.
--   * nexus_account_deletion_status says whether the sign-in can be removed: once no workspace they own is left.
--     It repeats the cleanup first, so a workspace created in the meantime is deleted too.
--   * The gateway then removes the sign-in through Supabase Auth's admin API, which removes the profile, Gemini
--     keys, workspace API keys, trial usage and research plans and runs with it, and calls
--     nexus_finish_account_deletion, which checks the sign-in is gone and closes the record.
--   * nexus_claim_account_deletions hands the cron the deletions still waiting, with a growing delay.
-- The record keeps only the account id and dates.

begin;

create table public.account_deletions (
  user_id uuid primary key,
  requested_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'verified')),
  verified_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  removed jsonb not null default '{}'::jsonb
);
alter table public.account_deletions enable row level security;
create policy account_deletions_service_only on public.account_deletions
  as restrictive for all to anon, authenticated using (false) with check (false);
revoke all on public.account_deletions from public, anon, authenticated;
grant select, insert, update on public.account_deletions to service_role;

-- Runs with its owner's rights: it reads the sign-in and changes rows across every workspace the person is in.
create function public.nexus_begin_account_deletion(p_user uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  item record;
  started jsonb := '[]'::jsonb;
  redacted uuid[];
  conversations bigint;
  closed bigint;
  messages bigint;
  findings_deleted bigint;
  findings_handed_over bigint;
  documents_handed_over bigint;
  invitations bigint;
  memberships bigint;
  summary jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_user is null then raise exception 'NR:INVALID_SCOPE'; end if;
  if not exists (select 1 from auth.users where id = p_user) then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  insert into public.account_deletions (user_id) values (p_user) on conflict (user_id) do nothing;
  -- The membership and document triggers let the service role make these changes.
  perform set_config('request.jwt.claim.role', 'service_role', true);

  -- Workspaces the person owns go, with everything in them.
  for item in
    select id from public.workspaces where owner_id = p_user and lifecycle_state in ('active', 'deleting') order by created_at, id
  loop
    started := started || jsonb_build_array(jsonb_build_object('workspace_id', item.id,
      'operation_id', public.nexus_begin_workspace_deletion(item.id, p_user)->>'operation_id'));
  end loop;

  -- Their private conversations: workbench runs keep their record without the question, the answer or the events.
  with changed as (
    update public.query_runs r set request = jsonb_set(r.request, '{question}', '"[deleted]"'::jsonb), final_answer = null
     where r.user_id = p_user
    returning r.id)
  select array_agg(id) into redacted from changed;
  update public.query_events e set payload = '{}'::jsonb, redacted_at = clock_timestamp()
   where e.run_id = any(coalesce(redacted, '{}')) and e.redacted_at is null;
  delete from public.chat_messages m using public.chat_sessions s
   where s.user_id = p_user and m.workspace_id = s.workspace_id and m.session_id = s.id;
  get diagnostics messages = row_count;
  delete from public.chat_sessions s
   where s.user_id = p_user
     and not exists (select 1 from public.query_runs r where r.workspace_id = s.workspace_id and r.session_id = s.id);
  get diagnostics conversations = row_count;
  update public.chat_sessions set title = null, deleted_at = coalesce(deleted_at, clock_timestamp()), revision = revision + 1
   where user_id = p_user;
  get diagnostics closed = row_count;

  -- Their unshared findings go, the way the workbench deletes a finding; shared ones stay with the workspace.
  with doomed as (
    update public.findings f set deleted_at = clock_timestamp(), title = '[deleted]'
     where f.owner_id = p_user and f.deleted_at is null
       and not exists (select 1 from public.finding_participants p where p.workspace_id = f.workspace_id and p.finding_id = f.id)
    returning f.workspace_id, f.id)
  , versions as (
    update public.finding_versions v set authored_markdown = '', generated_markdown = null, title = '[deleted]', redacted_at = clock_timestamp()
      from doomed where v.workspace_id = doomed.workspace_id and v.finding_id = doomed.id
    returning 1)
  , reviews as (
    delete from public.finding_reviews r using doomed where r.workspace_id = doomed.workspace_id and r.finding_id = doomed.id
    returning 1)
  select count(*) into findings_deleted from doomed;
  update public.findings f set owner_id = w.owner_id, updated_at = clock_timestamp()
    from public.workspaces w
   where f.owner_id = p_user and f.deleted_at is null and w.id = f.workspace_id and w.owner_id <> p_user;
  get diagnostics findings_handed_over = row_count;

  -- What they added to other people's workspaces belongs to those workspaces.
  update public.documents d set uploaded_by = w.owner_id
    from public.workspaces w
   where d.uploaded_by = p_user and w.id = d.workspace_id and w.owner_id <> p_user;
  get diagnostics documents_handed_over = row_count;
  delete from public.workspace_invitations i
   where i.created_by = p_user and not exists (select 1 from public.workspaces w where w.id = i.workspace_id and w.owner_id = p_user);
  get diagnostics invitations = row_count;
  update public.workspace_invitations set accepted_by = null where accepted_by = p_user;
  delete from public.workspace_members m
   where m.user_id = p_user and not exists (select 1 from public.workspaces w where w.id = m.workspace_id and w.owner_id = p_user);
  get diagnostics memberships = row_count;

  summary := jsonb_build_object('workspaces', jsonb_array_length(started), 'conversations', conversations + closed,
    'messages', messages, 'findings_deleted', findings_deleted, 'findings_handed_over', findings_handed_over,
    'documents_handed_over', documents_handed_over, 'invitations', invitations, 'memberships', memberships);
  update public.account_deletions a set removed = a.removed || summary where a.user_id = p_user;
  return jsonb_build_object('state', 'STARTED', 'workspaces', started, 'removed', summary);
end
$fn$;
revoke all on function public.nexus_begin_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.nexus_begin_account_deletion(uuid) to service_role;

-- READY once no workspace the person owns is left, so removing the sign-in cannot fail on it. Until the sign-in is
-- removed the person can still act, so each check first repeats the cleanup: a workspace created or a membership
-- accepted since the request is handled like the rest.
create function public.nexus_account_deletion_status(p_user uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare record public.account_deletions%rowtype; owned bigint;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_user is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into record from public.account_deletions where user_id = p_user;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if record.state = 'verified' then return jsonb_build_object('state', 'VERIFIED'); end if;
  if exists (select 1 from auth.users where id = p_user) then perform public.nexus_begin_account_deletion(p_user); end if;
  select count(*) into owned from public.workspaces where owner_id = p_user;
  return jsonb_build_object('state', case when owned = 0 then 'READY' else 'WAITING' end, 'workspaces_remaining', owned);
end
$fn$;
revoke all on function public.nexus_account_deletion_status(uuid) from public, anon, authenticated;
grant execute on function public.nexus_account_deletion_status(uuid) to service_role;

-- Called after Supabase Auth removed the sign-in: checks it is gone and closes the record.
create function public.nexus_finish_account_deletion(p_user uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_user is null then raise exception 'NR:INVALID_SCOPE'; end if;
  if exists (select 1 from auth.users where id = p_user) or exists (select 1 from public.profiles where id = p_user) then
    raise exception 'NR:DELETE_UNVERIFIED';
  end if;
  update public.account_deletions set state = 'verified', verified_at = coalesce(verified_at, clock_timestamp())
   where user_id = p_user;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  return jsonb_build_object('state', 'VERIFIED');
end
$fn$;
revoke all on function public.nexus_finish_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.nexus_finish_account_deletion(uuid) to service_role;

-- Account deletions still waiting, oldest attempt first; each claim pushes the next attempt back (5 minutes,
-- doubling up to 6 hours).
create function public.nexus_claim_account_deletions(p_limit integer default 1)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare claimed jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'NR:INVALID_SCOPE'; end if;
  with due as (
    select user_id from public.account_deletions
     where state = 'pending' and next_attempt_at <= clock_timestamp()
     order by next_attempt_at, requested_at limit p_limit
     for update skip locked
  ), pushed as (
    update public.account_deletions a
       set attempts = a.attempts + 1,
           next_attempt_at = clock_timestamp() + least(interval '6 hours', interval '5 minutes' * power(2, least(a.attempts, 8)))
      from due where a.user_id = due.user_id
    returning a.user_id)
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into claimed from pushed;
  return claimed;
end
$fn$;
revoke all on function public.nexus_claim_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.nexus_claim_account_deletions(integer) to service_role;

commit;
