-- Enforce tenant authorization invariants below the FastAPI layer.
-- Apply after 006_pgvector_retrieval_filters.sql.

create schema if not exists nexusrag_private;
revoke all on schema nexusrag_private from public, anon;
grant usage on schema nexusrag_private to authenticated, service_role;

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.uuid_or_null(text) set search_path = public, pg_temp;

create or replace function nexusrag_private.workspace_role(target_workspace uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace
    and wm.user_id = (select auth.uid())
  limit 1
$$;

create or replace function nexusrag_private.owns_workspace(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = target_workspace
      and w.owner_id = (select auth.uid())
  )
$$;

revoke execute on all functions in schema nexusrag_private from public, anon;
grant execute on function nexusrag_private.workspace_role(uuid) to authenticated, service_role;
grant execute on function nexusrag_private.owns_workspace(uuid) to authenticated, service_role;

create or replace function public.workspace_role(target_workspace uuid)
returns text
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select nexusrag_private.workspace_role(target_workspace)
$$;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select nexusrag_private.workspace_role(target_workspace) is not null
$$;

create or replace function public.has_workspace_role(
  target_workspace uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(nexusrag_private.workspace_role(target_workspace) = any(allowed_roles), false)
$$;

create or replace function public.owns_workspace(target_workspace uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select nexusrag_private.owns_workspace(target_workspace)
$$;

revoke execute on function public.workspace_role(uuid) from public, anon;
revoke execute on function public.is_workspace_member(uuid) from public, anon;
revoke execute on function public.has_workspace_role(uuid, text[]) from public, anon;
revoke execute on function public.owns_workspace(uuid) from public, anon;
grant execute on function public.workspace_role(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.owns_workspace(uuid) to authenticated, service_role;

create or replace function nexusrag_private.enforce_workspace_member_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_role text;
  workspace_owner uuid;
  target_workspace uuid;
  request_role text;
begin
  request_role := coalesce(current_setting('request.jwt.claim.role', true), '');
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
$$;

revoke execute on function nexusrag_private.enforce_workspace_member_invariants()
from public, anon, authenticated;

drop trigger if exists workspace_members_enforce_invariants on public.workspace_members;
create trigger workspace_members_enforce_invariants
before insert or update or delete on public.workspace_members
for each row execute function nexusrag_private.enforce_workspace_member_invariants();

create or replace function nexusrag_private.enforce_workspace_identity_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
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
$$;

revoke execute on function nexusrag_private.enforce_workspace_identity_immutable()
from public, anon, authenticated;

drop trigger if exists workspaces_enforce_identity_immutable on public.workspaces;
create trigger workspaces_enforce_identity_immutable
before update on public.workspaces
for each row execute function nexusrag_private.enforce_workspace_identity_immutable();

drop policy if exists "workspace_members_insert_admins" on public.workspace_members;
create policy "workspace_members_insert_admins"
on public.workspace_members for insert to authenticated
with check (
  (
    public.owns_workspace(workspace_id)
    and (
      role in ('admin', 'editor', 'viewer')
      or (user_id = (select auth.uid()) and role = 'owner')
    )
  )
  or (
    public.workspace_role(workspace_id) = 'admin'
    and role in ('editor', 'viewer')
  )
);

drop policy if exists "workspace_members_update_admins" on public.workspace_members;
create policy "workspace_members_update_admins"
on public.workspace_members for update to authenticated
using (
  (
    public.workspace_role(workspace_id) = 'owner'
    and role <> 'owner'
  )
  or (
    public.workspace_role(workspace_id) = 'admin'
    and role in ('editor', 'viewer')
  )
)
with check (
  (
    public.workspace_role(workspace_id) = 'owner'
    and role in ('admin', 'editor', 'viewer')
  )
  or (
    public.workspace_role(workspace_id) = 'admin'
    and role in ('editor', 'viewer')
  )
);

drop policy if exists "workspace_members_delete_admins" on public.workspace_members;
create policy "workspace_members_delete_admins"
on public.workspace_members for delete to authenticated
using (
  (
    public.workspace_role(workspace_id) = 'owner'
    and role <> 'owner'
  )
  or (
    public.workspace_role(workspace_id) = 'admin'
    and role in ('editor', 'viewer')
  )
);

create or replace function nexusrag_private.enforce_document_identity_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
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
$$;

revoke execute on function nexusrag_private.enforce_document_identity_immutable()
from public, anon, authenticated;

drop trigger if exists documents_enforce_identity_immutable on public.documents;
create trigger documents_enforce_identity_immutable
before update on public.documents
for each row execute function nexusrag_private.enforce_document_identity_immutable();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

create or replace function nexusrag_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();
  return new;
end;
$$;

revoke execute on function nexusrag_private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function nexusrag_private.handle_new_user();

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

create index if not exists api_keys_user_id_idx
on public.api_keys(user_id);

create index if not exists chat_messages_workspace_id_idx
on public.chat_messages(workspace_id);

create index if not exists chat_sessions_user_id_idx
on public.chat_sessions(user_id);

create index if not exists eval_results_workspace_id_idx
on public.eval_results(workspace_id);

create index if not exists eval_runs_user_id_idx
on public.eval_runs(user_id);

create index if not exists llm_usage_events_user_id_idx
on public.llm_usage_events(user_id);

drop index if exists public.llm_usage_workspace_created_idx;
