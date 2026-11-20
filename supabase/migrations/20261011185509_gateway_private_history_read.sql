-- Preserve the gateway's oldest-500 history contract without a service-role read.
begin;

-- Keep the existing bounded RPC contract, but close its direct lifecycle bypass.
create or replace function nexusrag_private.read_private_history(
 p_workspace uuid,p_session uuid,p_limit integer default 50
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
 if auth.uid() is null
 or not exists(select 1 from public.workspaces where id=p_workspace and lifecycle_state='active')
 or not nexusrag_private.can_read_conversation(p_workspace,p_session) then
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

create function nexusrag_private.read_gateway_private_history(p_workspace uuid,p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
 -- Authorization and projection use the same statement snapshot, not an HTTP preflight.
 if auth.uid() is null
 or not exists(select 1 from public.workspaces where id=p_workspace and lifecycle_state='active')
 or not nexusrag_private.can_read_conversation(p_workspace,p_session) then
  return '[]'::jsonb;
 end if;
 return (
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]'::jsonb)
  from (
   select id,workspace_id,session_id,role,content,sources,metadata,created_at
   from public.chat_messages
   where workspace_id=p_workspace and session_id=p_session
   order by created_at,id limit 500
  ) m
 );
end
$$;

create function public.read_gateway_private_history(p_workspace uuid,p_session uuid)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$ select nexusrag_private.read_gateway_private_history(p_workspace,p_session) $$;

revoke all on function nexusrag_private.read_gateway_private_history(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.read_gateway_private_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function nexusrag_private.read_gateway_private_history(uuid,uuid) to authenticated;
grant execute on function public.read_gateway_private_history(uuid,uuid) to authenticated;

commit;
