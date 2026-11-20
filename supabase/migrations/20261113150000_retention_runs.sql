-- Lets a workspace's retention schedule actually remove old content (NX-16).
--
-- The schedule could be stored and claimed, but nothing carried it out and nothing could change it. After this
-- migration:
--   * nexus_set_retention turns the schedule on or off for an owner or administrator. Turning it on makes a run
--     due at once; turning it off stops runs, including one in progress.
--   * nexus_retention_sweep is the database half of one run, under the lease that claim_workspace_retention or
--     claim_retention_schedules handed out. With cutoff = now - retention_days, it
--       - marks documents uploaded before the cutoff for deletion, through the same tombstone as a person's delete;
--         the gateway's deletion cron then erases their index entries, originals and rows. A document stored as a
--         Radar page is kept: it records a reviewed change and is removed by a person;
--       - deletes chat messages written before the cutoff, clears the titles of conversations started before it,
--         and removes conversations not used since: a conversation that workbench runs belong to is closed the way
--         deleting it in the workbench does, and any other is removed outright, so a chat that is still open in a
--         browser simply starts again with its next question;
--       - removes the question and answer of workbench runs started before the cutoff and the events they wrote,
--         and deletes research runs created before it, unless a saved finding cites the run;
--       - deletes the copies of new conversations kept to answer retried requests.
--     Each part works in a bounded batch; the result says whether more is due, and finish_retention_claim then
--     schedules the next run in an hour instead of a day. Saved findings, audit events and deletion receipts are
--     not removed by retention.

begin;

create function public.nexus_set_retention(p_workspace uuid, p_actor uuid, p_enabled boolean, p_days integer)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare saved public.workspace_settings%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_actor is null or p_enabled is null
     or (p_enabled and (p_days is null or p_days not between 1 and 3650)) then
    raise exception 'NR:INVALID_SCOPE';
  end if;
  -- Member-management operations lock the same row before changing authority.
  perform 1 from public.workspaces where id = p_workspace and lifecycle_state = 'active' for update;
  if not found then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  if public.nexus_resolve_confirmed_member(p_actor::text) is distinct from p_actor
     or not exists (select 1 from public.workspace_members
                     where workspace_id = p_workspace and user_id = p_actor and role in ('owner', 'admin')) then
    raise exception 'NR:FORBIDDEN';
  end if;
  insert into public.workspace_settings (workspace_id) values (p_workspace) on conflict (workspace_id) do nothing;
  -- Turning retention off keeps the number of days, so turning it back on starts from the same value.
  update public.workspace_settings
     set retention_enabled = p_enabled,
         retention_days = case when p_enabled then p_days else retention_days end,
         next_retention_at = case when p_enabled then now() else null end,
         updated_at = now()
   where workspace_id = p_workspace
  returning * into saved;
  return jsonb_build_object('retention_enabled', saved.retention_enabled, 'retention_days', saved.retention_days,
    'last_retention_at', saved.last_retention_at, 'next_retention_at', saved.next_retention_at);
end
$fn$;
revoke all on function public.nexus_set_retention(uuid, uuid, boolean, integer) from public, anon, authenticated;
grant execute on function public.nexus_set_retention(uuid, uuid, boolean, integer) to service_role;

create function public.nexus_retention_sweep(p_workspace uuid, p_worker_id text, p_lease_expires_at timestamptz,
                                             p_limit integer default 25, p_actor uuid default null)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare
  settings public.workspace_settings%rowtype;
  actor uuid;
  cutoff timestamptz;
  item record;
  marked jsonb := '[]'::jsonb;
  kept_radar bigint;
  kept_findings bigint;
  idle uuid[];
  redacted uuid[];
  messages bigint;
  sessions_removed bigint;
  sessions_closed bigint;
  titles bigint;
  research bigint;
  copies bigint;
  more boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_worker_id is null or p_lease_expires_at is null or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception 'NR:INVALID_SCOPE';
  end if;
  select * into settings from public.workspace_settings where workspace_id = p_workspace for update;
  -- Only the holder of an unexpired lease may run, and only while the schedule is on.
  if not found or settings.retention_lease_owner is distinct from p_worker_id
     or settings.retention_lease_expires_at is distinct from p_lease_expires_at
     or settings.retention_lease_expires_at <= clock_timestamp()
     or not settings.retention_enabled or settings.retention_days not between 1 and 3650 then
    raise exception 'NR:VERSION_CONFLICT';
  end if;
  -- A scheduled run acts for the workspace owner; a manual run for the person who asked.
  actor := coalesce(p_actor, (select owner_id from public.workspaces where id = p_workspace and lifecycle_state = 'active'));
  if actor is null then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  cutoff := clock_timestamp() - make_interval(days => settings.retention_days);

  -- Documents.
  for item in
    select d.id from public.documents d
     where d.workspace_id = p_workspace and d.lifecycle_state = 'active' and d.created_at < cutoff
       and not exists (select 1 from public.radar_snapshots r where r.workspace_id = p_workspace and r.document_id = d.id)
     order by d.created_at, d.id
     limit p_limit
  loop
    marked := marked || jsonb_build_array(jsonb_build_object('document_id', item.id,
      'operation_id', public.tombstone_document(p_workspace, item.id, actor)));
  end loop;
  select count(*) into kept_radar from public.documents d
   where d.workspace_id = p_workspace and d.lifecycle_state = 'active' and d.created_at < cutoff
     and exists (select 1 from public.radar_snapshots r where r.workspace_id = p_workspace and r.document_id = d.id);
  more := exists (select 1 from public.documents d
                   where d.workspace_id = p_workspace and d.lifecycle_state = 'active' and d.created_at < cutoff
                     and not exists (select 1 from public.radar_snapshots r
                                      where r.workspace_id = p_workspace and r.document_id = d.id));

  -- Conversations not used since the cutoff, found before deleting messages touches every conversation it changes.
  select array_agg(id) into idle from (
    select s.id from public.chat_sessions s
     where s.workspace_id = p_workspace and s.deleted_at is null and s.updated_at < cutoff
       and not exists (select 1 from public.query_runs r where r.workspace_id = p_workspace and r.session_id = s.id
                          and r.state in ('accepted', 'running'))
     order by s.updated_at, s.id limit 200) due;
  idle := coalesce(idle, '{}');

  -- Messages.
  with doomed as (
    select m.id from public.chat_messages m
     where m.workspace_id = p_workspace and m.created_at < cutoff
     order by m.created_at, m.id limit 5000)
  delete from public.chat_messages m using doomed where m.id = doomed.id;
  get diagnostics messages = row_count;
  more := more or exists (select 1 from public.chat_messages m where m.workspace_id = p_workspace and m.created_at < cutoff);

  -- Workbench runs keep their record, without the question, the answer or the events they wrote.
  with doomed as (
    select r.id from public.query_runs r
     where r.workspace_id = p_workspace and r.created_at < cutoff
       and r.state in ('completed', 'failed', 'cancelled', 'interrupted')
       and (r.final_answer is not null or r.request->>'question' is distinct from '[deleted]')
       and not exists (select 1 from public.findings f
                        where f.workspace_id = p_workspace and f.source_run_id = r.id and f.deleted_at is null)
     order by r.created_at, r.id limit 500),
  changed as (
    update public.query_runs r set request = jsonb_set(r.request, '{question}', '"[deleted]"'::jsonb), final_answer = null
      from doomed where r.id = doomed.id
    returning r.id)
  select array_agg(id) into redacted from changed;
  redacted := coalesce(redacted, '{}');
  update public.query_events e set payload = '{}'::jsonb, redacted_at = clock_timestamp()
   where e.workspace_id = p_workspace and e.run_id = any(redacted) and e.redacted_at is null;
  more := more or exists (
    select 1 from public.query_runs r
     where r.workspace_id = p_workspace and r.created_at < cutoff
       and r.state in ('completed', 'failed', 'cancelled', 'interrupted')
       and (r.final_answer is not null or r.request->>'question' is distinct from '[deleted]')
       and not exists (select 1 from public.findings f
                        where f.workspace_id = p_workspace and f.source_run_id = r.id and f.deleted_at is null));

  -- Research runs.
  with doomed as (
    select r.id from public.research_runs r
     where r.workspace_id = p_workspace and r.created_at < cutoff and r.state in ('completed', 'cancelled', 'interrupted')
       and not exists (select 1 from public.findings f
                        where f.workspace_id = p_workspace and f.source_research_run_id = r.id and f.deleted_at is null)
     order by r.created_at, r.id limit 200)
  delete from public.research_runs r using doomed where r.id = doomed.id;
  get diagnostics research = row_count;
  more := more or exists (
    select 1 from public.research_runs r
     where r.workspace_id = p_workspace and r.created_at < cutoff and r.state in ('completed', 'cancelled', 'interrupted')
       and not exists (select 1 from public.findings f
                        where f.workspace_id = p_workspace and f.source_research_run_id = r.id and f.deleted_at is null));
  select (select count(*) from public.query_runs r
           where r.workspace_id = p_workspace and r.created_at < cutoff
             and exists (select 1 from public.findings f
                          where f.workspace_id = p_workspace and f.source_run_id = r.id and f.deleted_at is null))
       + (select count(*) from public.research_runs r
           where r.workspace_id = p_workspace and r.created_at < cutoff
             and exists (select 1 from public.findings f
                          where f.workspace_id = p_workspace and f.source_research_run_id = r.id and f.deleted_at is null))
    into kept_findings;

  -- Idle conversations with nothing left: removed, or closed when workbench runs belong to them.
  delete from public.chat_sessions s
   where s.workspace_id = p_workspace and s.id = any(idle)
     and not exists (select 1 from public.chat_messages m where m.workspace_id = p_workspace and m.session_id = s.id)
     and not exists (select 1 from public.query_runs r where r.workspace_id = p_workspace and r.session_id = s.id);
  get diagnostics sessions_removed = row_count;
  update public.chat_sessions s set title = null, deleted_at = clock_timestamp(), revision = s.revision + 1
   where s.workspace_id = p_workspace and s.id = any(idle) and s.deleted_at is null
     and not exists (select 1 from public.chat_messages m where m.workspace_id = p_workspace and m.session_id = s.id);
  get diagnostics sessions_closed = row_count;
  more := more or exists (
    select 1 from public.chat_sessions s
     where s.workspace_id = p_workspace and s.deleted_at is null and s.updated_at < cutoff and not (s.id = any(idle))
       and not exists (select 1 from public.query_runs r where r.workspace_id = p_workspace and r.session_id = s.id
                          and r.state in ('accepted', 'running')));
  -- A title copies the question that started the conversation.
  update public.chat_sessions s set title = null
   where s.workspace_id = p_workspace and s.created_at < cutoff and s.title is not null;
  get diagnostics titles = row_count;

  -- Kept only so a retried request gets the same answer; each holds a copy of the conversation it created.
  delete from public.workbench_mutations w
   where w.workspace_id = p_workspace and w.operation = 'conversation.create' and w.created_at < cutoff;
  get diagnostics copies = row_count;

  return jsonb_build_object('cutoff', cutoff, 'documents', marked, 'documents_kept_for_radar', kept_radar,
    'chat_messages_deleted', messages, 'chat_sessions_deleted', sessions_removed + sessions_closed,
    'chat_titles_cleared', titles, 'workbench_runs_redacted', cardinality(redacted),
    'research_runs_deleted', research, 'runs_kept_for_findings', kept_findings,
    'retry_copies_deleted', copies, 'more', more);
end
$fn$;
revoke all on function public.nexus_retention_sweep(uuid, text, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.nexus_retention_sweep(uuid, text, timestamptz, integer, uuid) to service_role;

commit;
