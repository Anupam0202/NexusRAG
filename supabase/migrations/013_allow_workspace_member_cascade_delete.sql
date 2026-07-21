-- Preserve direct workspace-member invariants while allowing the database's
-- ON DELETE CASCADE to remove memberships after its parent workspace is gone.
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
$$;

revoke execute on function nexusrag_private.enforce_workspace_member_invariants()
from public, anon, authenticated;
