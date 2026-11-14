-- Owner-only history cleanup. The live session remains reusable.
begin;

create function nexusrag_private.clear_private_history(p_workspace uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid=auth.uid(); deleted_count bigint;
begin
 if actor is null then return '[]'::jsonb; end if;
 -- Match management lock order and recheck authority after any wait.
 perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for no key update;
 if not found then return '[]'::jsonb; end if;
 -- Direct member DELETE takes this row before its workspace-revision trigger.
 -- Fail busy before deleting anything, rather than deadlocking that revocation.
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor for update nowait;
 if not found then return '[]'::jsonb; end if;
 perform 1 from public.chat_sessions
 where workspace_id=p_workspace and id=p_session and user_id=actor and deleted_at is null for update;
 if not found then return '[]'::jsonb; end if;
 delete from public.chat_messages where workspace_id=p_workspace and session_id=p_session;
 get diagnostics deleted_count=row_count;
 update public.chat_sessions set revision=revision+1,updated_at=clock_timestamp()
 where workspace_id=p_workspace and id=p_session;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,
   'success',true,'durable_messages_deleted',deleted_count));
end
$$;

create function public.clear_private_history(p_workspace uuid,p_session uuid)
returns jsonb language sql security invoker set search_path=''
as $$ select nexusrag_private.clear_private_history(p_workspace,p_session) $$;

revoke all on function nexusrag_private.clear_private_history(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.clear_private_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function nexusrag_private.clear_private_history(uuid,uuid) to authenticated;
grant execute on function public.clear_private_history(uuid,uuid) to authenticated;
commit;
