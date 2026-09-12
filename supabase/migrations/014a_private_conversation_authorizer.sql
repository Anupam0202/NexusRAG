-- Move conversation authorization behind the non-exposed helper schema.
-- Recovered from the applied database definition and policy state.
begin;

create or replace function nexusrag_private.can_read_conversation(
 p_workspace uuid,
 p_session uuid
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
 select exists(
  select 1
  from public.chat_sessions s
  where s.workspace_id=p_workspace
   and s.id=p_session
   and s.deleted_at is null
   and public.is_workspace_member(s.workspace_id)
   and (
    s.user_id=auth.uid()
    or s.visibility='legacy_workspace'
    or exists(
     select 1
     from public.conversation_participants p
     where p.workspace_id=s.workspace_id
      and p.session_id=s.id
      and p.user_id=auth.uid()
    )
   )
 )
$$;

revoke execute on function nexusrag_private.can_read_conversation(uuid,uuid) from public,anon;
grant execute on function nexusrag_private.can_read_conversation(uuid,uuid) to authenticated,service_role;

drop policy if exists chat_sessions_read_authorized on public.chat_sessions;
drop policy if exists chat_messages_read_authorized on public.chat_messages;

create policy chat_sessions_read_authorized
on public.chat_sessions for select to authenticated
using(nexusrag_private.can_read_conversation(workspace_id,id));

create policy chat_messages_read_authorized
on public.chat_messages for select to authenticated
using(nexusrag_private.can_read_conversation(workspace_id,session_id));

drop function if exists public.can_read_conversation(uuid,uuid);

commit;
