\set ON_ERROR_STOP on
-- Disposable fixtures only. No hosted data, user credentials or provider calls.
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','viewer');
insert into public.chat_sessions(id,workspace_id,user_id,visibility,deleted_at) values
 ('b1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',null),
 ('b4444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',null,'legacy_workspace',null),
 ('b5555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',now()),
 ('b6666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','private',null);
insert into public.chat_messages(workspace_id,session_id,role,content)
 select workspace_id,id,'user','Synthetic cleanup fixture' from public.chat_sessions where id::text like 'b%';
insert into public.conversation_participants(workspace_id,session_id,user_id,permission) values
 ('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','read'),
 ('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','contribute');

do $$ begin
 if has_table_privilege('authenticated','public.chat_messages','DELETE')
 or has_function_privilege('anon','public.clear_private_history(uuid,uuid)','EXECUTE')
 or has_function_privilege('service_role','public.clear_private_history(uuid,uuid)','EXECUTE')
 then raise exception 'cleanup authority widened'; end if;
end $$;
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ declare r jsonb; sid uuid; begin
 foreach sid in array array['b1111111-1111-4111-8111-111111111111'::uuid,
  'b2222222-2222-4222-8222-222222222222','b4444444-4444-4444-8444-444444444444',
  'b5555555-5555-4555-8555-555555555555','b6666666-6666-4666-8666-666666666666'] loop
  if public.clear_private_history('11111111-1111-4111-8111-111111111111',sid)<>'[]'
  then raise exception 'participant, legacy, tombstone or cross-workspace cleanup accepted'; end if;
 end loop;
 r=public.clear_private_history('11111111-1111-4111-8111-111111111111','B3333333-3333-4333-8333-333333333333');
 if r<>jsonb_build_array(jsonb_build_object('workspace_id','11111111-1111-4111-8111-111111111111',
  'session_id','b3333333-3333-4333-8333-333333333333','success',true,'durable_messages_deleted',1))
 then raise exception 'viewer-owned exact receipt failed'; end if;
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333')->0->>'durable_messages_deleted'<>'0'
 then raise exception 'zero-message repeat cleanup failed'; end if;
end $$;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333')<>'[]'
 then raise exception 'workspace owner overrode private owner authority'; end if;
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222')->0->>'durable_messages_deleted'<>'1'
 then raise exception 'conversation owner cleanup failed'; end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
do $$ begin
 if exists(select 1 from public.chat_sessions where id='b3333333-3333-4333-8333-333333333333'
  and (deleted_at is not null or revision<>3)) then raise exception 'live reusable session lost'; end if;
 if (select count(*) from public.chat_messages where session_id in(
  'b1111111-1111-4111-8111-111111111111','b4444444-4444-4444-8444-444444444444',
  'b5555555-5555-4555-8555-555555555555','b6666666-6666-4666-8666-666666666666'))<>4
 then raise exception 'unauthorized cleanup had side effects'; end if;
end $$;
insert into public.chat_messages(workspace_id,session_id,role,content) values
 ('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333','user','Reusable session fixture');
delete from public.workspace_members where workspace_id='11111111-1111-4111-8111-111111111111'
 and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333')<>'[]'
 then raise exception 'revoked owner retained cleanup authority'; end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
update public.workspaces set lifecycle_state='deleting' where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111')<>'[]'
 then raise exception 'inactive workspace cleanup accepted'; end if;
end $$;
set request.jwt.claim.sub='';
do $$ begin
 if public.clear_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111')<>'[]'
 then raise exception 'missing identity cleanup accepted'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin
  perform public.clear_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111');
  raise exception 'anonymous cleanup executed';
 exception when insufficient_privilege then null;
 end;
end $$;
reset role;
rollback;
select 'PRIVATE_HISTORY_CLEAR_AUTHORITY_PASS (local fixture, not hosted OAuth)';
