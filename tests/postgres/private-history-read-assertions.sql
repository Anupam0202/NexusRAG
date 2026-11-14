\set ON_ERROR_STOP on
-- Synthetic, rollback-only fixtures in the disposable local rehearsal database.
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','viewer');
insert into public.chat_sessions(id,workspace_id,user_id,visibility,deleted_at) values
 ('a1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('a2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('a3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('a4444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','legacy_workspace',null),
 ('a5555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',now()),
 ('a6666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',null),
 ('a7777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','private',null);
insert into public.chat_messages(workspace_id,session_id,role,content)
 select workspace_id,id,'user','Synthetic private history fixture'
 from public.chat_sessions where id::text like 'a%';
insert into public.conversation_participants(workspace_id,session_id,user_id,permission) values
 ('11111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','read'),
 ('11111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','contribute');

do $$ begin
 if has_table_privilege('authenticated','public.chat_messages','SELECT') then
  raise exception 'history patch broadened table grants';
 end if;
 if has_function_privilege('anon','public.read_private_history(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('service_role','public.read_private_history(uuid,uuid,integer)','EXECUTE') then
  raise exception 'history RPC authority widened';
 end if;
end $$;

set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if jsonb_array_length(public.read_private_history('11111111-1111-4111-8111-111111111111','A1111111-1111-4111-8111-111111111111'))<>1
 then raise exception 'owner read scope or tombstone authority failed'; end if;
 if public.read_private_history('44444444-4444-4444-8444-444444444444','a7777777-7777-4777-8777-777777777777')<>'[]'
 then raise exception 'cross-workspace private history leaked'; end if;
 if public.read_private_history('11111111-1111-4111-8111-111111111111','a5555555-5555-4555-8555-555555555555')<>'[]'
 then raise exception 'owner read tombstoned session'; end if;
 begin
  perform public.read_private_history('11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111',101);
  raise exception 'invalid history limit accepted';
 exception when invalid_parameter_value then null;
 end;
end $$;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
 if jsonb_array_length(public.read_private_history('11111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222'))<>1
 or jsonb_array_length(public.read_private_history('11111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333'))<>1
 or jsonb_array_length(public.read_private_history('11111111-1111-4111-8111-111111111111','a4444444-4444-4444-8444-444444444444'))<>1
 or jsonb_array_length(public.read_private_history('11111111-1111-4111-8111-111111111111','a6666666-6666-4666-8666-666666666666'))<>1
 then raise exception 'participant, legacy or own read behavior failed'; end if;
 if public.read_private_history('11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111')<>'[]'
 or public.read_private_history('11111111-1111-4111-8111-111111111111','a5555555-5555-4555-8555-555555555555')<>'[]'
 then raise exception 'viewer read unrelated or tombstoned private conversation'; end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
delete from public.conversation_participants where session_id='a2222222-2222-4222-8222-222222222222';
update public.chat_sessions set deleted_at=now() where id='a3333333-3333-4333-8333-333333333333';
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 if public.read_private_history('11111111-1111-4111-8111-111111111111','a2222222-2222-4222-8222-222222222222')<>'[]'
 or public.read_private_history('11111111-1111-4111-8111-111111111111','a3333333-3333-4333-8333-333333333333')<>'[]'
 then raise exception 'revoked participant or tombstone still readable'; end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
delete from public.workspace_members where workspace_id='11111111-1111-4111-8111-111111111111'
 and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 if public.read_private_history('11111111-1111-4111-8111-111111111111','a6666666-6666-4666-8666-666666666666')<>'[]'
 or public.read_private_history('11111111-1111-4111-8111-111111111111','a4444444-4444-4444-8444-444444444444')<>'[]'
 then raise exception 'removed member still reads own or legacy history'; end if;
end $$;
set request.jwt.claim.sub='';
do $$ begin
 if public.read_private_history('11111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111')<>'[]'
 then raise exception 'missing identity accepted'; end if;
end $$;
reset role;
rollback;
select 'PRIVATE_HISTORY_RPC_TWO_IDENTITY_PASS (local fixture, not hosted OAuth)';
