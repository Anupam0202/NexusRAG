-- Retained Python private turns: caller authority, server attestation and atomicity.
begin;

alter table public.chat_sessions add column history_epoch bigint not null default 0
 check(history_epoch>=0 and history_epoch<9007199254740991);

-- Old workbench writers do not advance revision. Fence all history mutations
-- separately, preserving existing read/clear/Gateway revision contracts.
create function nexusrag_private.advance_chat_history_epoch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='INSERT' then
  update public.chat_sessions s set history_epoch=history_epoch+1
  where exists(select 1 from new_messages m where m.workspace_id=s.workspace_id and m.session_id=s.id);
 elsif TG_OP='DELETE' then
  update public.chat_sessions s set history_epoch=history_epoch+1
  where exists(select 1 from old_messages m where m.workspace_id=s.workspace_id and m.session_id=s.id);
 else
  update public.chat_sessions s set history_epoch=history_epoch+1
  where exists(select 1 from (select workspace_id,session_id from old_messages
    union select workspace_id,session_id from new_messages) m
    where m.workspace_id=s.workspace_id and m.session_id=s.id);
 end if;
 return null;
end $$;
revoke all on function nexusrag_private.advance_chat_history_epoch() from public,anon,authenticated,service_role;
create trigger backend_chat_insert_epoch after insert on public.chat_messages
 referencing new table as new_messages for each statement execute function nexusrag_private.advance_chat_history_epoch();
create trigger backend_chat_delete_epoch after delete on public.chat_messages
 referencing old table as old_messages for each statement execute function nexusrag_private.advance_chat_history_epoch();
create trigger backend_chat_update_epoch after update on public.chat_messages
 referencing old table as old_messages new table as new_messages for each statement execute function nexusrag_private.advance_chat_history_epoch();

create function nexusrag_private.fence_chat_identity_epoch()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.history_epoch<old.history_epoch then raise exception 'History epoch cannot decrease' using errcode='22023'; end if;
 if new.user_id is distinct from old.user_id or new.visibility is distinct from old.visibility
 or new.deleted_at is distinct from old.deleted_at then new.history_epoch=old.history_epoch+1; end if;
 return new;
end $$;
revoke all on function nexusrag_private.fence_chat_identity_epoch() from public,anon,authenticated,service_role;
create trigger backend_chat_identity_epoch before update on public.chat_sessions
 for each row execute function nexusrag_private.fence_chat_identity_epoch();

-- Protected hash-only staging uses the existing expiring operation store but
-- cannot be mistaken for Gateway account quota admission.
alter table public.nexus_account_operations drop constraint nexus_account_operations_operation_check;
alter table public.nexus_account_operations add constraint nexus_account_operations_operation_check
 check(operation in ('chat','document','backend_private_turn'));

create function nexusrag_private.backend_auth_session()
returns uuid language plpgsql volatile security definer set search_path='' as $$
declare actor uuid=auth.uid(); claims jsonb=auth.jwt(); login uuid; valid_until timestamptz;
begin
 if actor is null or auth.role() is distinct from 'authenticated'
 or jsonb_typeof(claims->'exp') is distinct from 'number' then return null; end if;
 begin login=(claims->>'session_id')::uuid; exception when invalid_text_representation then return null; end;
 if login is null then return null; end if;
 select not_after into valid_until from auth.sessions where id=login and user_id=actor for share nowait;
 if not found or (valid_until is not null and valid_until<=clock_timestamp())
 or (claims->>'exp')::numeric<=extract(epoch from clock_timestamp()) then return null; end if;
 return actor;
end $$;
revoke all on function nexusrag_private.backend_auth_session() from public,anon,authenticated,service_role;

create function nexusrag_private.backend_private_turn_hash(p_workspace uuid,p_session uuid,p_key uuid,
 p_revision bigint,p_epoch bigint,p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns text language sql immutable security invoker set search_path='' as $$
 select encode(sha256(convert_to(jsonb_build_object('workspace',p_workspace,'session',p_session,'key',p_key,
 'revision',p_revision,'epoch',p_epoch,'question',p_question,'answer',p_answer,'sources',p_sources,'metadata',p_metadata)::text,'UTF8')),'hex')
$$;
revoke all on function nexusrag_private.backend_private_turn_hash(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb)
 from public,anon,authenticated,service_role;

create function nexusrag_private.read_backend_private_turn_context(p_workspace uuid,p_session uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare actor uuid=nexusrag_private.backend_auth_session(); s public.chat_sessions%rowtype; history jsonb;
begin
 if actor is null or p_workspace is null or p_session is null then return '[]'::jsonb; end if;
 perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for no key update;
 if not found then return '[]'::jsonb; end if;
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor
  and role in ('owner','admin','editor','viewer') for share nowait;
 if not found then return '[]'::jsonb; end if;
 select * into s from public.chat_sessions where id=p_session for share nowait;
 if found then
  if s.workspace_id<>p_workspace or s.user_id is distinct from actor or s.deleted_at is not null
  or s.visibility<>'private' then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('role',(recent.m).role,'content',left(
   case when (recent.m).run_id is not null then public.workbench_message_projection(recent.m)->>'content'
   else (recent.m).content end,5000)) order by (recent.m).created_at,(recent.m).id),'[]'::jsonb)
  into history from(select m from public.chat_messages m where workspace_id=p_workspace and session_id=p_session
   order by created_at desc,id desc limit 50) recent;
 else
  s.revision=0; s.history_epoch=0; history='[]'::jsonb;
 end if;
 if nexusrag_private.backend_auth_session() is null then return '[]'::jsonb; end if;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,
  'actor_id',actor,'revision',s.revision,'history_epoch',s.history_epoch,'history',history));
end $$;

create function public.stage_backend_private_turn(p_actor uuid,p_workspace uuid,p_session uuid,p_key uuid,
 p_revision bigint,p_epoch bigint,p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare expected_hash text; staged public.nexus_account_operations%rowtype;
begin
 if auth.role() is distinct from 'service_role' or p_actor is null or p_workspace is null or p_session is null
 or p_key is null or p_revision is null or p_epoch is null or p_revision<0 or p_epoch<0
 or p_revision>=9007199254740990 or p_epoch>=9007199254740990
 or p_question is null or length(btrim(p_question)) not between 1 and 10000
 or p_answer is null or length(p_answer) not between 1 and 100000
 or jsonb_typeof(p_sources) is distinct from 'array' or octet_length(p_sources::text)>524288
 or jsonb_typeof(p_metadata) is distinct from 'object' or octet_length(p_metadata::text)>65536 then return '[]'::jsonb; end if;
 expected_hash=nexusrag_private.backend_private_turn_hash(p_workspace,p_session,p_key,p_revision,p_epoch,p_question,p_answer,p_sources,p_metadata);
 insert into public.nexus_account_operations(user_id,operation,idempotency_key,outcome)
 values(p_actor,'backend_private_turn',p_key,jsonb_build_object('backend_turn_hash',expected_hash))
 on conflict(user_id,operation,idempotency_key) do nothing;
 select * into staged from public.nexus_account_operations
 where user_id=p_actor and operation='backend_private_turn' and idempotency_key=p_key for update nowait;
 if staged.outcome->>'backend_turn_hash' is distinct from expected_hash or staged.outcome->>'committed'='true'
 or staged.created_at<clock_timestamp()-interval '15 minutes' then return '[]'::jsonb; end if;
 return jsonb_build_array(jsonb_build_object('workspace_id',p_workspace,'session_id',p_session,
  'revision',p_revision,'history_epoch',p_epoch,'state','STAGED'));
end $$;
revoke all on function public.stage_backend_private_turn(uuid,uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb)
 from public,anon,authenticated;
grant execute on function public.stage_backend_private_turn(uuid,uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb) to service_role;

create function nexusrag_private.commit_backend_private_turn(p_workspace uuid,p_session uuid,p_key uuid,
 p_revision bigint,p_epoch bigint,p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid=nexusrag_private.backend_auth_session(); s public.chat_sessions%rowtype;
 staged public.nexus_account_operations%rowtype; inserted uuid; turn_time timestamptz;
begin
 if actor is null or p_workspace is null or p_session is null or p_key is null then return '[]'::jsonb; end if;
 if p_revision is null or p_epoch is null or p_revision<0 or p_epoch<0
 or p_revision>=9007199254740990 or p_epoch>=9007199254740990 then return '[]'::jsonb; end if;
 perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for no key update;
 if not found then return '[]'::jsonb; end if;
 perform 1 from public.workspace_members where workspace_id=p_workspace and user_id=actor
 and role in ('owner','admin','editor','viewer') for update nowait;
 if not found then return '[]'::jsonb; end if;
 select * into staged from public.nexus_account_operations
 where user_id=actor and operation='backend_private_turn' and idempotency_key=p_key for update nowait;
 if not found or staged.created_at<clock_timestamp()-interval '15 minutes'
 or staged.outcome->>'backend_turn_hash' is distinct from
 nexusrag_private.backend_private_turn_hash(p_workspace,p_session,p_key,p_revision,p_epoch,p_question,p_answer,p_sources,p_metadata)
 then return '[]'::jsonb; end if;
 if staged.outcome->>'committed'='true' then
  return jsonb_build_array(jsonb_build_object('state','CONFLICT','workspace_id',p_workspace,'session_id',p_session)); end if;
 select * into s from public.chat_sessions where id=p_session for update nowait;
 if nexusrag_private.backend_auth_session() is null then return '[]'::jsonb; end if;
 if found then
  if s.workspace_id<>p_workspace or s.user_id is distinct from actor or s.deleted_at is not null
  or s.visibility<>'private' then return '[]'::jsonb; end if;
  if s.revision<>p_revision or s.history_epoch<>p_epoch then
   return jsonb_build_array(jsonb_build_object('state','CONFLICT','workspace_id',p_workspace,'session_id',p_session)); end if;
 else
  if p_revision<>0 or p_epoch<>0 then
   return jsonb_build_array(jsonb_build_object('state','CONFLICT','workspace_id',p_workspace,'session_id',p_session)); end if;
  insert into public.chat_sessions(id,workspace_id,user_id,title,visibility,revision)
   values(p_session,p_workspace,actor,left(p_question,120),'private',0)
   on conflict(id) do nothing returning id into inserted;
  if inserted is null then
   return jsonb_build_array(jsonb_build_object('state','CONFLICT','workspace_id',p_workspace,'session_id',p_session)); end if;
 end if;
 turn_time=clock_timestamp();
 insert into public.chat_messages(workspace_id,session_id,role,content,sources,metadata,created_at)
 values(p_workspace,p_session,'user',p_question,'[]','{"source":"python_private_chat"}',turn_time),
 (p_workspace,p_session,'assistant',p_answer,p_sources,p_metadata||jsonb_build_object('session_revision',p_revision+1),turn_time+interval '1 microsecond');
 update public.chat_sessions set revision=p_revision+1,updated_at=clock_timestamp()
 where workspace_id=p_workspace and id=p_session;
 update public.nexus_account_operations set outcome=outcome||jsonb_build_object('committed',true)
 where user_id=actor and operation='backend_private_turn' and idempotency_key=p_key;
 return jsonb_build_array(jsonb_build_object('state','COMMITTED','workspace_id',p_workspace,
  'session_id',p_session,'revision',p_revision+1,'history_epoch',p_epoch+1,'messages_written',2));
end $$;

create function public.read_backend_private_turn_context(p_workspace uuid,p_session uuid)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select nexusrag_private.read_backend_private_turn_context(p_workspace,p_session) $$;
create function public.commit_backend_private_turn(p_workspace uuid,p_session uuid,p_key uuid,
 p_revision bigint,p_epoch bigint,p_question text,p_answer text,p_sources jsonb,p_metadata jsonb)
returns jsonb language sql volatile security invoker set search_path='' as $$
 select nexusrag_private.commit_backend_private_turn(p_workspace,p_session,p_key,p_revision,p_epoch,p_question,p_answer,p_sources,p_metadata) $$;
revoke all on function nexusrag_private.read_backend_private_turn_context(uuid,uuid),public.read_backend_private_turn_context(uuid,uuid)
 from public,anon,authenticated,service_role;
revoke all on function nexusrag_private.commit_backend_private_turn(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb),
 public.commit_backend_private_turn(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function nexusrag_private.read_backend_private_turn_context(uuid,uuid),public.read_backend_private_turn_context(uuid,uuid) to authenticated;
grant execute on function nexusrag_private.commit_backend_private_turn(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb),
 public.commit_backend_private_turn(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb) to authenticated;
commit;
