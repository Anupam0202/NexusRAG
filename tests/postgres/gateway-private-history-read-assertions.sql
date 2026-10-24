\set ON_ERROR_STOP on
-- Synthetic fixtures only in the disposable rehearsal database; always rollback.
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','viewer');
insert into public.chat_sessions(id,workspace_id,user_id,visibility,deleted_at) values
 ('b1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b4444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',null,'legacy_workspace',null),
 ('b5555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',now()),
 ('b6666666-6666-4666-8666-666666666666','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',null),
 ('b7777777-7777-4777-8777-777777777777','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','private',null);
insert into public.chat_messages(workspace_id,session_id,role,content)
 select workspace_id,id,'user','Synthetic gateway history'
 from public.chat_sessions where id::text like 'b%';
delete from public.chat_messages where session_id='b1111111-1111-4111-8111-111111111111';
insert into public.chat_messages(id,workspace_id,session_id,role,content,created_at)
 select ('d0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 '11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
 'user','Synthetic gateway window '||i,'2026-10-11T00:00:00Z'
 from generate_series(1,501) i;
insert into public.conversation_participants(workspace_id,session_id,user_id,permission) values
 ('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','read'),
 ('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333','33333333-3333-4333-8333-333333333333','contribute');

do $$ begin
 if has_table_privilege('authenticated','public.chat_messages','SELECT')
 or has_table_privilege('authenticated','public.chat_messages','DELETE') then
  raise exception 'gateway history broadened table privileges';
 end if;
 if has_function_privilege('anon','public.read_gateway_private_history(uuid,uuid)','EXECUTE')
 or has_function_privilege('service_role','public.read_gateway_private_history(uuid,uuid)','EXECUTE')
 or has_function_privilege('anon','nexusrag_private.read_gateway_private_history(uuid,uuid)','EXECUTE')
 or has_function_privilege('service_role','nexusrag_private.read_gateway_private_history(uuid,uuid)','EXECUTE') then
  raise exception 'gateway history broadened RPC authority';
 end if;
 if (select prosecdef from pg_proc where oid='public.read_gateway_private_history(uuid,uuid)'::regprocedure)
 or not (select prosecdef from pg_proc where oid='nexusrag_private.read_gateway_private_history(uuid,uuid)'::regprocedure)
 or exists(select 1 from pg_proc where oid in('public.read_gateway_private_history(uuid,uuid)'::regprocedure,
 'nexusrag_private.read_gateway_private_history(uuid,uuid)'::regprocedure)
 and not (proconfig @> array['search_path=""'])) then
  raise exception 'gateway history function security changed';
 end if;
end $$;
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare rows jsonb; begin
 rows=public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','B1111111-1111-4111-8111-111111111111');
 if jsonb_array_length(rows)<>500
 or rows->0->>'content'<>'Synthetic gateway window 1'
 or rows->499->>'content'<>'Synthetic gateway window 500'
 or exists(select 1 from jsonb_array_elements(rows) m where m->>'workspace_id'<>'11111111-1111-4111-8111-111111111111'
 or m->>'session_id'<>'b1111111-1111-4111-8111-111111111111') then
  raise exception 'gateway 500-window, deterministic ordering or scope changed';
 end if;
 if public.read_gateway_private_history('44444444-4444-4444-8444-444444444444','b7777777-7777-4777-8777-777777777777')<>'[]'
 or public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b5555555-5555-4555-8555-555555555555')<>'[]'
 or public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b6666666-6666-4666-8666-666666666666')<>'[]'
 or public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000')<>'[]' then
  raise exception 'cross-workspace, tombstone, owner override or unknown session leaked';
 end if;
 begin
  perform public.read_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',101);
  raise exception 'existing bounded RPC contract changed';
 exception when invalid_parameter_value then null;
 end;
end $$;
set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
 if jsonb_array_length(public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222'))<>1
 or jsonb_array_length(public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333'))<>1
 or jsonb_array_length(public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b4444444-4444-4444-8444-444444444444'))<>1
 or jsonb_array_length(public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b6666666-6666-4666-8666-666666666666'))<>1 then
  raise exception 'participant, ownerless legacy or own gateway read failed';
 end if;
 if public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111')<>'[]' then
  raise exception 'unrelated viewer read private gateway history';
 end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
delete from public.conversation_participants where session_id='b2222222-2222-4222-8222-222222222222';
update public.chat_sessions set deleted_at=now() where id='b3333333-3333-4333-8333-333333333333';
update public.workspaces set lifecycle_state='deleting' where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 if public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b4444444-4444-4444-8444-444444444444')<>'[]'
 or public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b6666666-6666-4666-8666-666666666666')<>'[]'
 or public.read_private_history('11111111-1111-4111-8111-111111111111','b4444444-4444-4444-8444-444444444444')<>'[]'
 or public.read_private_history('11111111-1111-4111-8111-111111111111','b6666666-6666-4666-8666-666666666666')<>'[]' then
  raise exception 'inactive workspace still exposes history through an alternate RPC';
 end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
update public.workspaces set lifecycle_state='active' where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 if public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222')<>'[]'
 or public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b3333333-3333-4333-8333-333333333333')<>'[]' then
  raise exception 'revoked participant or tombstone still exposes gateway history';
 end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
delete from public.workspace_members where workspace_id='11111111-1111-4111-8111-111111111111'
 and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 if public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b6666666-6666-4666-8666-666666666666')<>'[]' then
  raise exception 'removed member still exposes owned gateway history';
 end if;
end $$;
set request.jwt.claim.sub='';
do $$ begin
 if public.read_gateway_private_history('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111')<>'[]' then
  raise exception 'gateway history accepts missing identity';
 end if;
end $$;
reset role;
rollback;
select 'GATEWAY_PRIVATE_HISTORY_AUTHORITY_PASS (synthetic disposable database, not hosted JWT)';
