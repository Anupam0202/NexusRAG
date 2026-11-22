-- Read the caller's role from the claims PostgREST actually sets (issue #33).
--
-- These five functions let the gateway's service role through only when the per-claim setting
-- request.jwt.claim.role is 'service_role'. PostgREST on hosted Supabase no longer sets per-claim settings: it sets
-- the verified claims only as JSON in request.jwt.claims (auth.role() reads both, so RPC-level checks pass). Live on
-- 2026-11-21 the membership trigger therefore refused the service role, and accepting a workspace invitation failed
-- with 42501; so does any service-role change to a non-owner membership. Owner rows passed only because auth.uid()
-- is NULL for the service role, which turns the owner checks into NULL, and PL/pgSQL treats NULL as false.
--
-- One helper reads the role from either setting; each function is otherwise unchanged.
begin;

create or replace function nexusrag_private.request_role()
returns text language sql stable set search_path = pg_catalog as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$fn$;
revoke all on function nexusrag_private.request_role() from public, anon, authenticated;

create or replace function nexusrag_private.can_read_document_object(p_name text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'storage', 'pg_temp'
as $function$
 select
  nexusrag_private.request_role()='service_role'
  or exists(
   select 1
   from public.document_versions v
   join public.documents d on d.workspace_id=v.workspace_id and d.id=v.document_id
   join public.workspaces w on w.id=v.workspace_id
   join public.workspace_members m on m.workspace_id=v.workspace_id
   where v.original_bucket='documents'
    and v.original_key=p_name
    and m.user_id=(select auth.uid())
    and w.lifecycle_state='active'
    and d.lifecycle_state='active'
    and v.publication_state='ready'
  )
$function$;

create or replace function nexusrag_private.can_write_document_object(p_name text)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'storage', 'pg_temp'
as $function$
 select
  nexusrag_private.request_role()='service_role'
  or exists(
   select 1
   from public.document_uploads u
   join public.workspaces w on w.id=u.workspace_id
   join public.workspace_members m on m.workspace_id=u.workspace_id
   where u.original_bucket='documents'
    and u.original_key=p_name
    and u.actor_id=(select auth.uid())
    and m.user_id=(select auth.uid())
    and m.role in('owner','admin','editor')
    and w.lifecycle_state='active'
    and u.state='receiving'
    and u.write_token is not null
    and u.expected_bytes between 1 and 25000000
    and u.expires_at>clock_timestamp()
  )
$function$;

create or replace function nexusrag_private.enforce_document_identity_immutable()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if nexusrag_private.request_role() = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.filename is distinct from old.filename
     or new.original_filename is distinct from old.original_filename
     or new.storage_bucket is distinct from old.storage_bucket
     or new.storage_path is distinct from old.storage_path
     or new.sha256 is distinct from old.sha256 then
    raise exception 'Document identity and storage fields are immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function nexusrag_private.enforce_workspace_identity_immutable()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if nexusrag_private.request_role() = 'service_role' then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.owner_id is distinct from old.owner_id
     or new.plan is distinct from old.plan then
    raise exception 'Workspace identity, ownership, and plan fields are immutable.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

create or replace function nexusrag_private.enforce_workspace_member_invariants()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  actor_role text;
  workspace_owner uuid;
  target_workspace uuid;
  request_role text;
begin
  request_role := nexusrag_private.request_role();
  if request_role = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  target_workspace := coalesce(new.workspace_id, old.workspace_id);
  select w.owner_id into workspace_owner
  from public.workspaces w
  where w.id = target_workspace;

  -- The parent owner_id is NOT NULL. A missing parent can therefore occur
  -- only while its foreign-key cascade is removing child membership rows.
  if tg_op = 'DELETE' and workspace_owner is null then
    return old;
  end if;

  actor_role := nexusrag_private.workspace_role(target_workspace);

  if tg_op in ('UPDATE', 'DELETE')
     and (old.user_id = workspace_owner or old.role = 'owner') then
    raise exception 'The workspace owner membership cannot be changed or removed.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT'
     and new.role = 'owner'
     and not (
       new.user_id = workspace_owner
       and (select auth.uid()) = workspace_owner
     ) then
    raise exception 'Only the workspace owner can hold the owner role.'
      using errcode = '42501';
  end if;

  if actor_role = 'owner' then
    if tg_op <> 'DELETE' and new.role = 'owner' then
      raise exception 'Owner membership must be created only for the workspace owner.'
        using errcode = '42501';
    end if;
  elsif actor_role = 'admin' then
    if (tg_op in ('UPDATE', 'DELETE') and old.role in ('owner', 'admin'))
       or (tg_op <> 'DELETE' and new.role in ('owner', 'admin')) then
      raise exception 'Administrators cannot manage owners or administrators.'
        using errcode = '42501';
    end if;
  elsif not (
    tg_op = 'INSERT'
    and new.user_id = workspace_owner
    and new.role = 'owner'
    and (select auth.uid()) = workspace_owner
  ) then
    raise exception 'Insufficient workspace member permissions.'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

commit;
