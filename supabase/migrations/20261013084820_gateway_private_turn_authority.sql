-- Caller-bound Gateway turn commits; no service-role fallback or table grants.
begin;

create function nexusrag_private.gateway_private_turn_hash(p_workspace uuid,p_session uuid,p_key uuid,p_revision bigint,
 p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns text language sql immutable security invoker set search_path=''
as $$ select encode(sha256(convert_to(jsonb_build_object('workspace',p_workspace,'session',p_session,
 'key',p_key,'revision',p_revision,'question',p_question,'answer',p_answer,'sources',p_sources,'metadata',p_metadata)::text,'UTF8')),'hex') $$;
revoke all on function nexusrag_private.gateway_private_turn_hash(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;

-- Only the verified Gateway can attest the exact generated and source-checked
-- payload. An outstanding admission alone is not trusted assistant evidence.
create function public.stage_gateway_private_turn(p_actor uuid,p_workspace uuid,p_session uuid,p_key uuid,p_revision bigint,
 p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare admission public.nexus_account_operations%rowtype; payload_hash text;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_actor is null or p_workspace is null or p_session is null
 or p_key is null or p_revision is null or p_revision<0 or p_revision>=9007199254740990
 or p_question is null or length(btrim(p_question)) not between 1 and 10000
 or p_answer is null or length(p_answer) not between 1 and 100000
 or p_sources is null or jsonb_typeof(p_sources)<>'array' or octet_length(p_sources::text)>524288
 or p_metadata is null or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>65536
 then return '[]'::jsonb; end if;
 select * into admission from public.nexus_account_operations
 where user_id=p_actor and operation='chat' and idempotency_key=p_key for update nowait;
 if not found or admission.outcome->>'state' is distinct from 'READY'
 or admission.created_at<clock_timestamp()-interval '24 hours'
 or admission.outcome->>'gateway_turn_committed'='true' then return '[]'::jsonb; end if;
 payload_hash=nexusrag_private.gateway_private_turn_hash(p_workspace,p_session,p_key,p_revision,p_question,p_answer,p_sources,p_metadata);
 if admission.outcome ? 'gateway_turn_hash' and admission.outcome->>'gateway_turn_hash' is distinct from payload_hash
 then return '[]'::jsonb; end if;
 update public.nexus_account_operations set outcome=outcome||jsonb_build_object('gateway_turn_hash',payload_hash)
 where user_id=p_actor and operation='chat' and idempotency_key=p_key;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'revision',p_revision,'state','STAGED'));
end
$$;
revoke all on function public.stage_gateway_private_turn(uuid,uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stage_gateway_private_turn(uuid,uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) to service_role;

create function nexusrag_private.read_gateway_private_turn_context(p_workspace uuid,p_session uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare actor uuid=auth.uid(); s public.chat_sessions%rowtype;
begin
 if actor is null or p_workspace is null or p_session is null
 or not exists(select 1 from public.workspaces where id=p_workspace and lifecycle_state='active')
 or not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor
   and role in ('owner','admin','editor')) then return '[]'::jsonb; end if;
 select * into s from public.chat_sessions where id=p_session;
 if found then
  if s.workspace_id<>p_workspace or s.user_id is distinct from actor or s.deleted_at is not null
   or s.visibility<>'private' then return '[]'::jsonb; end if;
  return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'revision',s.revision));
 end if;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'revision',0));
end
$$;

create function nexusrag_private.commit_gateway_private_turn(p_workspace uuid,p_session uuid,p_key uuid,p_revision bigint,
 p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid=auth.uid(); s public.chat_sessions%rowtype; inserted uuid;
 admission public.nexus_account_operations%rowtype;
 user_time timestamptz; answer_time timestamptz;
begin
 if actor is null or p_workspace is null or p_session is null or p_key is null then return '[]'::jsonb; end if;
 if p_revision is null or p_revision<0 or p_revision>=9007199254740990
 or p_question is null or length(btrim(p_question)) not between 1 and 10000
 or p_answer is null or length(p_answer) not between 1 and 100000
 or p_sources is null or jsonb_typeof(p_sources)<>'array' or octet_length(p_sources::text)>524288
 or p_metadata is null or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>65536
 then raise exception 'Invalid bounded turn' using errcode='22023'; end if;
 -- Match clear's order. NOWAIT avoids inverse member DELETE/trigger and old
 -- session-first writer deadlocks; busy requests never perform partial writes.
 perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for no key update;
 if not found then return '[]'::jsonb; end if;
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor
  and role in ('owner','admin','editor') for update nowait;
 if not found then return '[]'::jsonb; end if;
 -- Authenticated callers cannot mint admission or consume one key repeatedly.
 -- NOWAIT avoids inversion with the existing account-usage-first admission path.
 select * into admission from public.nexus_account_operations
 where user_id=actor and operation='chat' and idempotency_key=p_key for update nowait;
 if not found or admission.outcome->>'state' is distinct from 'READY'
 or admission.created_at<clock_timestamp()-interval '24 hours' then return '[]'::jsonb; end if;
 if admission.outcome->>'gateway_turn_committed'='true' then
  return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'state','CONFLICT'));
 end if;
 if admission.outcome->>'gateway_turn_hash' is distinct from
  nexusrag_private.gateway_private_turn_hash(p_workspace,p_session,p_key,p_revision,p_question,p_answer,p_sources,p_metadata)
 then return '[]'::jsonb; end if;
 select * into s from public.chat_sessions where id=p_session for update nowait;
 if found then
  if s.workspace_id<>p_workspace or s.user_id is distinct from actor or s.deleted_at is not null
   or s.visibility<>'private' then return '[]'::jsonb; end if;
  if s.revision<>p_revision then
   return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'state','CONFLICT'));
  end if;
 else
  if p_revision<>0 then
   return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'state','CONFLICT'));
  end if;
  insert into public.chat_sessions(id,workspace_id,user_id,title,visibility,revision)
   values(p_session,p_workspace,actor,left(p_question,120),'private',0)
   on conflict(id) do nothing returning id into inserted;
  if inserted is null then
   return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,'state','CONFLICT'));
  end if;
 end if;
 -- Preserve deterministic question-before-answer history despite one transaction.
 user_time=clock_timestamp(); answer_time=user_time+interval '1 microsecond';
 insert into public.chat_messages(workspace_id,session_id,role,content,sources,metadata,created_at)
 values(p_workspace,p_session,'user',p_question,'[]','{"query_type":"general"}',user_time),
       (p_workspace,p_session,'assistant',p_answer,p_sources,
        p_metadata||jsonb_build_object('session_revision',p_revision+1),answer_time);
 update public.chat_sessions set revision=p_revision+1,updated_at=clock_timestamp()
 where workspace_id=p_workspace and id=p_session;
 update public.nexus_account_operations
 set outcome=outcome||jsonb_build_object('gateway_turn_committed',true)
 where user_id=actor and operation='chat' and idempotency_key=p_key;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,
  'state','COMMITTED','revision',p_revision+1,'messages_written',2));
end
$$;

create function public.read_gateway_private_turn_context(p_workspace uuid,p_session uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select nexusrag_private.read_gateway_private_turn_context(p_workspace,p_session) $$;
create function public.commit_gateway_private_turn(p_workspace uuid,p_session uuid,p_key uuid,p_revision bigint,
 p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language sql security invoker set search_path=''
as $$ select nexusrag_private.commit_gateway_private_turn(p_workspace,p_session,p_key,p_revision,p_question,p_answer,p_sources,p_metadata) $$;

revoke all on function nexusrag_private.read_gateway_private_turn_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.read_gateway_private_turn_context(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function nexusrag_private.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function nexusrag_private.read_gateway_private_turn_context(uuid,uuid) to authenticated;
grant execute on function public.read_gateway_private_turn_context(uuid,uuid) to authenticated;
grant execute on function nexusrag_private.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb) to authenticated;
commit;
