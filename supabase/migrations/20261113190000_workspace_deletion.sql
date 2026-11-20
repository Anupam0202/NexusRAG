-- Lets a workspace owner delete the workspace and everything in it (NX-16).
--
--   * nexus_begin_workspace_deletion: the owner, with a confirmed account, marks the workspace `deleting`. That
--     hides it from every member at once, because every gateway route and database function requires an active
--     workspace. It records one deletion operation with three things to clean up: the search index entries, the
--     stored originals and the database rows.
--   * nexus_begin_workspace_purge: stops the workspace's jobs and says whether one may still be writing; when none
--     is, it hands the gateway the stored originals it knows of. The gateway then removes the index entries and
--     the originals and records a verified receipt for each.
--   * nexus_purge_workspace: once both are verified, removes every row of the workspace from every table that has
--     a workspace_id, in as many passes as their references need, then the workspace itself, and checks that
--     nothing is left. The deletion record, its receipts and one audit event saying who deleted which workspace
--     are kept; the workspace's own audit trail, with its addresses and browsers, goes with it.
--   * nexus_claim_workspace_purges: hands the gateway's cron the deletions that could not finish, with a growing
--     delay between attempts.
-- A person's own account data (their profile, their Gemini key, their free-trial usage) is not part of a
-- workspace and is kept.

begin;

create function public.nexus_begin_workspace_deletion(p_workspace uuid, p_actor uuid)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare
  ws public.workspaces%rowtype;
  operation uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_actor is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into ws from public.workspaces where id = p_workspace for update;
  if not found or ws.lifecycle_state = 'deleted' then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if ws.owner_id is distinct from p_actor or public.nexus_resolve_confirmed_member(p_actor::text) is distinct from p_actor then
    raise exception 'NR:FORBIDDEN';
  end if;
  if ws.lifecycle_state = 'active' then
    update public.workspaces
       set lifecycle_state = 'deleting', capability_revision = capability_revision + 1, updated_at = now()
     where id = p_workspace;
    insert into public.deletion_operations (workspace_id, resource_id, tombstone_epoch, state)
    values (p_workspace, p_workspace, ws.capability_revision + 1, 'pending')
    returning id into operation;
    insert into public.deletion_targets (workspace_id, operation_id, kind, resource_id, bucket, object_key)
    values (p_workspace, operation, 'workspace_index', p_workspace, null, null),
           (p_workspace, operation, 'workspace_originals', p_workspace, 'documents', p_workspace::text),
           (p_workspace, operation, 'workspace_rows', p_workspace, null, null);
  else
    -- Asked again while it is being deleted: the same deletion goes on.
    select id into operation from public.deletion_operations
     where workspace_id = p_workspace and resource_id = p_workspace and state <> 'verified'
     order by created_at desc limit 1;
    if operation is null then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  end if;
  return jsonb_build_object('state', 'STARTED', 'operation_id', operation);
end
$fn$;
revoke all on function public.nexus_begin_workspace_deletion(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_begin_workspace_deletion(uuid, uuid) to service_role;

create function public.nexus_begin_workspace_purge(p_workspace uuid, p_operation uuid)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare
  op public.deletion_operations%rowtype;
  until timestamptz;
  originals jsonb;
  targets jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_operation is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into op from public.deletion_operations
   where workspace_id = p_workspace and id = p_operation and resource_id = p_workspace for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if op.state = 'verified' then return jsonb_build_object('state', 'VERIFIED'); end if;
  if not exists (select 1 from public.workspaces where id = p_workspace and lifecycle_state = 'deleting') then
    return jsonb_build_object('state', 'NOT_FOUND');
  end if;
  -- Jobs that have not started are cancelled; a running one is asked to stop and is given two minutes.
  update public.ingestion_jobs
     set status = 'cancelled', stage = 'cancelled', error_code = coalesce(error_code, 'CANCELLED'),
         completed_at = clock_timestamp(), cancellation_requested_at = coalesce(cancellation_requested_at, clock_timestamp()),
         lease_generation = lease_generation + 1, lease_owner = null, lease_expires_at = null
   where workspace_id = p_workspace
     and (status in ('queued', 'retry_wait')
          or (status = 'processing'
              and (lease_expires_at is null or lease_expires_at <= clock_timestamp()
                   or cancellation_requested_at <= clock_timestamp() - interval '2 minutes')));
  update public.ingestion_jobs set cancellation_requested_at = clock_timestamp()
   where workspace_id = p_workspace and status = 'processing' and cancellation_requested_at is null;
  select max(least(lease_expires_at, cancellation_requested_at + interval '2 minutes')) into until
    from public.ingestion_jobs where workspace_id = p_workspace and status = 'processing';
  if until is not null and until > clock_timestamp() then
    return jsonb_build_object('state', 'WAITING', 'reason', 'JOB_RUNNING', 'retry_at', until);
  end if;
  update public.deletion_operations set state = 'cleaning' where id = op.id and state <> 'verified';
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into originals from (
    select original_key as key from public.document_versions where workspace_id = p_workspace and original_key is not null
    union select storage_path from public.documents where workspace_id = p_workspace and storage_path is not null
    union select original_key from public.document_uploads where workspace_id = p_workspace and original_key is not null) known;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'attempts', attempts) order by kind), '[]'::jsonb)
    into targets from public.deletion_targets
   where operation_id = op.id and kind in ('workspace_index', 'workspace_originals') and verified_at is null;
  return jsonb_build_object('state', 'READY', 'originals', originals, 'targets', targets);
end
$fn$;
revoke all on function public.nexus_begin_workspace_purge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_begin_workspace_purge(uuid, uuid) to service_role;

-- Runs with its owner's rights: some tables, such as workspace_invitations, are closed to the service role and
-- reached only through their own functions, yet a workspace deletion must remove and check them too. Only the
-- service role may call it, and it checks that.
create function public.nexus_purge_workspace(p_workspace uuid, p_operation uuid)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  op public.deletion_operations%rowtype;
  ws public.workspaces%rowtype;
  item record;
  pass integer;
  progressed boolean;
  removed_rows bigint;
  found_rows boolean;
  remaining text[] := '{}';
  removed jsonb;
  verified timestamptz;
  -- The record of this deletion outlives the workspace.
  kept constant text[] := array['deletion_operations', 'deletion_targets', 'deletion_receipts'];
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_operation is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into op from public.deletion_operations
   where workspace_id = p_workspace and id = p_operation and resource_id = p_workspace for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if op.state = 'verified' then
    return jsonb_build_object('state', 'VERIFIED', 'removed',
      (select inventory from public.deletion_targets where operation_id = op.id and kind = 'workspace_rows'),
      'receipts', (select count(*) from public.deletion_receipts where operation_id = op.id));
  end if;
  select * into ws from public.workspaces where id = p_workspace and lifecycle_state = 'deleting' for update;
  if not found then return jsonb_build_object('state', 'NOT_FOUND'); end if;
  if exists (select 1 from public.deletion_targets
              where operation_id = op.id and kind in ('workspace_index', 'workspace_originals') and verified_at is null) then
    return jsonb_build_object('state', 'BLOCKED', 'reason', 'STORED_COPIES_REMAIN');
  end if;
  if exists (select 1 from public.ingestion_jobs
              where workspace_id = p_workspace and status = 'processing' and lease_expires_at > clock_timestamp()) then
    return jsonb_build_object('state', 'WAITING', 'reason', 'JOB_RUNNING');
  end if;

  removed := jsonb_build_object(
    'documents', (select count(*) from public.documents where workspace_id = p_workspace),
    'chunks', (select count(*) from public.document_chunks where workspace_id = p_workspace),
    'chat_sessions', (select count(*) from public.chat_sessions where workspace_id = p_workspace),
    'chat_messages', (select count(*) from public.chat_messages where workspace_id = p_workspace),
    'findings', (select count(*) from public.findings where workspace_id = p_workspace),
    'members', (select count(*) from public.workspace_members where workspace_id = p_workspace));

  -- Document deletions still open in this workspace end here: their copies went with the workspace's.
  verified := clock_timestamp();
  update public.deletion_targets set verified_at = verified, failure_code = null
   where workspace_id = p_workspace and operation_id <> op.id and verified_at is null;
  update public.deletion_operations set state = 'verified', verified_at = verified
   where workspace_id = p_workspace and id <> op.id and state <> 'verified';

  -- Every table with a workspace_id, until nothing more can go; a table whose rows are still referenced is
  -- tried again in the next pass. Memberships go with the workspace row, whose foreign key cascades to them.
  -- Tables are read from the catalog, so one the caller lacks rights on fails loudly instead of being skipped.
  for pass in 1..20 loop
    progressed := false;
    for item in
      select c.relname::text as table_name
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
         and a.attname = 'workspace_id' and a.attnum > 0 and not a.attisdropped
         and c.relname::text <> all (kept) and c.relname::text <> 'workspace_members'
       order by c.relname
    loop
      begin
        execute format('delete from public.%I where workspace_id = $1', item.table_name) using p_workspace;
        get diagnostics removed_rows = row_count;
        progressed := progressed or removed_rows > 0;
      exception when others then
        null; -- Still referenced; the next pass tries again.
      end;
    end loop;
    exit when not progressed;
  end loop;
  begin
    delete from public.workspaces where id = p_workspace;
  exception when others then
    remaining := remaining || 'workspaces'::text;
  end;

  for item in
    select c.relname::text as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       and a.attname = 'workspace_id' and a.attnum > 0 and not a.attisdropped
       and c.relname::text <> all (kept)
  loop
    execute format('select exists (select 1 from public.%I where workspace_id = $1)', item.table_name)
      into found_rows using p_workspace;
    if found_rows then remaining := remaining || item.table_name::text; end if;
  end loop;
  if cardinality(remaining) > 0 or exists (select 1 from public.workspaces where id = p_workspace) then
    raise exception 'NR:DELETE_UNVERIFIED' using detail = array_to_string(remaining, ', ');
  end if;

  update public.deletion_targets set verified_at = verified, attempts = attempts + 1, failure_code = null, inventory = removed
   where operation_id = op.id and kind = 'workspace_rows';
  insert into public.deletion_receipts (workspace_id, operation_id, target_id, provider, receipt_hash, verified_at)
  select p_workspace, op.id, t.id, 'supabase',
         encode(sha256(convert_to(jsonb_build_object('workspace', p_workspace, 'operation_id', op.id, 'target_id', t.id,
           'kind', t.kind, 'provider', 'supabase', 'verified_at', verified, 'removed', removed)::text, 'UTF8')), 'hex'), verified
    from public.deletion_targets t where t.operation_id = op.id and t.kind = 'workspace_rows'
  on conflict (workspace_id, target_id, provider) do nothing;
  update public.deletion_operations set state = 'verified', verified_at = verified where id = op.id;
  insert into public.audit_events (workspace_id, user_id, action, resource_type, resource_id, metadata)
  values (null, ws.owner_id, 'workspace.delete', 'workspace', p_workspace::text,
          jsonb_build_object('workspace_id', p_workspace, 'operation_id', op.id, 'removed', removed));
  return jsonb_build_object('state', 'VERIFIED', 'removed', removed,
    'receipts', (select count(*) from public.deletion_receipts where operation_id = op.id));
end
$fn$;
revoke all on function public.nexus_purge_workspace(uuid, uuid) from public, anon, authenticated;
grant execute on function public.nexus_purge_workspace(uuid, uuid) to service_role;

-- Unfinished workspace deletions for the gateway's cron, oldest attempt first; each claim pushes the next
-- attempt back (5 minutes, doubling up to 6 hours).
create function public.nexus_claim_workspace_purges(p_limit integer default 1)
returns jsonb language plpgsql
set search_path = pg_catalog, public as $fn$
declare claimed jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 5 then raise exception 'NR:INVALID_SCOPE'; end if;
  with due as (
    select t.id as target_id, o.workspace_id, o.id as operation_id
      from public.deletion_operations o
      join public.deletion_targets t on t.operation_id = o.id and t.kind = 'workspace_rows' and t.verified_at is null
     where o.resource_id = o.workspace_id and o.state in ('pending', 'cleaning', 'blocked')
       and t.next_attempt_at <= clock_timestamp()
     order by t.next_attempt_at asc, o.created_at asc
     limit p_limit
     for update of t skip locked
  ), pushed as (
    update public.deletion_targets t
       set next_attempt_at = clock_timestamp() + least(interval '6 hours', interval '5 minutes' * power(2, least(t.attempts, 8))),
           attempts = t.attempts + 1
      from due where t.id = due.target_id
    returning due.workspace_id, due.operation_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('workspace_id', workspace_id, 'operation_id', operation_id)), '[]'::jsonb)
    into claimed from pushed;
  return claimed;
end
$fn$;
revoke all on function public.nexus_claim_workspace_purges(integer) from public, anon, authenticated;
grant execute on function public.nexus_claim_workspace_purges(integer) to service_role;

commit;
