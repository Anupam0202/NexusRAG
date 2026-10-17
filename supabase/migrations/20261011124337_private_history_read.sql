-- Caller-bound history projection without granting browser table access.
begin;

create function nexusrag_private.read_private_history(
 p_workspace uuid, p_session uuid, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
 if p_limit is null or p_limit not between 1 and 100 then
  raise exception 'Invalid history limit' using errcode='22023';
 end if;
 -- Authorization and projection share the statement snapshot. No client actor argument.
 if auth.uid() is null or not nexusrag_private.can_read_conversation(p_workspace,p_session) then
  return '[]'::jsonb;
 end if;
 return (
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb)
  from (
   select * from public.chat_messages
   where workspace_id=p_workspace and session_id=p_session
   order by created_at,id limit p_limit
  ) m
 );
end
$$;

-- The exposed wrapper is invoker-only; privileged implementation stays unexposed.
create function public.read_private_history(
 p_workspace uuid, p_session uuid, p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$ select nexusrag_private.read_private_history(p_workspace,p_session,p_limit) $$;

revoke all on function nexusrag_private.read_private_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.read_private_history(uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function nexusrag_private.read_private_history(uuid,uuid,integer) to authenticated;
grant execute on function public.read_private_history(uuid,uuid,integer) to authenticated;

commit;
