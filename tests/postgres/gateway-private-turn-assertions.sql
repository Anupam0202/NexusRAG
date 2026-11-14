\set ON_ERROR_STOP on
-- Rollback-only synthetic authority fixtures. No hosted users or provider calls.
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','editor');
insert into public.chat_sessions(id,workspace_id,user_id,visibility,deleted_at) values
 ('d1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('d2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',null),
 ('d3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',null,'legacy_workspace',null),
 ('d4444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',now()),
 ('d5555555-5555-4555-8555-555555555555','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','private',null);
insert into public.conversation_participants(workspace_id,session_id,user_id,permission) values
 ('11111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','contribute');
-- Synthetic server-only admissions, including denied/expired/foreign controls.
insert into public.nexus_account_operations(user_id,operation,idempotency_key,outcome)
 select actor,'chat',('d0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'{"state":"READY"}'::jsonb
 from (values('22222222-2222-4222-8222-222222222222'::uuid),('33333333-3333-4333-8333-333333333333'::uuid)) a(actor)
 cross join generate_series(1,10) i;
update public.nexus_account_operations set outcome='{"state":"BYOK_REQUIRED"}' where idempotency_key='d0000000-0000-4000-8000-000000000008';
update public.nexus_account_operations set created_at=now()-interval '25 hours' where idempotency_key='d0000000-0000-4000-8000-000000000009';
select public.stage_gateway_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'd1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000001',1,'Question','Answer','[]','{}');
select public.stage_gateway_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'd1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002',1,'Stale','Stale','[]','{}');
select public.stage_gateway_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'd1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003',2,'Old','Old','[]','{}');
select public.stage_gateway_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'd6666666-6666-4666-8666-666666666666','d0000000-0000-4000-8000-000000000004',0,'New question','New answer','[]','{}');
select public.stage_gateway_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'd7777777-7777-4777-8777-777777777777','d0000000-0000-4000-8000-000000000005',0,'Question','Answer','[]','{}');
select public.stage_gateway_private_turn('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
 'd2222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000006',1,'Question','Answer','[]','{}');
select public.stage_gateway_private_turn('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
 'd2222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000007',2,'Question','Answer','[]','{}');
do $$ begin
 if has_table_privilege('authenticated','public.chat_messages','INSERT')
 or has_table_privilege('authenticated','public.chat_sessions','UPDATE')
 or has_table_privilege('authenticated','public.nexus_account_operations','UPDATE')
 or has_function_privilege('authenticated','public.stage_gateway_private_turn(uuid,uuid,uuid,uuid,bigint,text,text,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('service_role','public.commit_gateway_private_turn(uuid,uuid,uuid,bigint,text,text,jsonb,jsonb)','EXECUTE')
 then raise exception 'turn authority widened'; end if;
end $$;

set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare r jsonb; sid uuid; k uuid='d0000000-0000-4000-8000-000000000001'; begin
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d8888888-8888-4888-8888-888888888888',
  'd0000000-0000-4000-8000-000000000010',0,'Forged question','Forged answer','[]','{"authority":"SUPABASE_HASH_VERIFIED"}') is distinct from '[]'::jsonb
 then raise exception 'unstaged browser-forged assistant evidence accepted'; end if;
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d6666666-6666-4666-8666-666666666666',
  'd0000000-0000-4000-8000-000000000004',0,'New question','Forged answer','[]','{}') is distinct from '[]'::jsonb
 then raise exception 'changed attested answer accepted'; end if;
 foreach sid in array array['d2222222-2222-4222-8222-222222222222'::uuid,
  'd3333333-3333-4333-8333-333333333333','d4444444-4444-4444-8444-444444444444',
  'd5555555-5555-4555-8555-555555555555'] loop
  if public.read_gateway_private_turn_context('11111111-1111-4111-8111-111111111111',sid) is distinct from '[]'
  or public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111',sid,k,1,'Question','Answer','[]','{}') is distinct from '[]'
  then raise exception 'foreign/participant/legacy/tombstone accepted'; end if;
 end loop;
 r=public.read_gateway_private_turn_context('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111');
 if r->0->>'revision' is distinct from '1' then raise exception 'owner context missing'; end if;
 r=public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','D1111111-1111-4111-8111-111111111111',k,1,'Question','Answer','[]','{}');
 if r->0->>'state' is distinct from 'COMMITTED' or r->0->>'revision' is distinct from '2' or r->0->>'messages_written' is distinct from '2'
 then raise exception 'exact committed receipt failed'; end if;
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111',k,2,'Replay','Replay','[]','{}')->0->>'state' is distinct from 'CONFLICT'
 then raise exception 'one admission reused for multiple turns'; end if;
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d6666666-6666-4666-8666-666666666666',k,0,'Replay','Replay','[]','{}')->0->>'state' is distinct from 'CONFLICT'
 then raise exception 'one admission reused across sessions'; end if;
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000002',1,'Stale','Stale','[]','{}')->0->>'state' is distinct from 'CONFLICT'
 then raise exception 'stale revision accepted'; end if;
 foreach k in array array['d0000000-0000-4000-8000-000000000008'::uuid,
  'd0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000099'] loop
  if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d6666666-6666-4666-8666-666666666666',k,0,'Question','Answer','[]','{}') is distinct from '[]'
  then raise exception 'denied/expired/missing admission accepted'; end if;
 end loop;
 perform public.clear_private_history('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111');
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000003',2,'Old','Old','[]','{}')->0->>'state' is distinct from 'CONFLICT'
 then raise exception 'clear resurrected history'; end if;
 r=public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d6666666-6666-4666-8666-666666666666','d0000000-0000-4000-8000-000000000004',0,'New question','New answer','[]','{}');
 if r->0->>'revision' is distinct from '1' then raise exception 'new private session failed'; end if;
 begin
  perform public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d6666666-6666-4666-8666-666666666666','d0000000-0000-4000-8000-000000000003',1,'Question','Answer','{}','{}');
  raise exception 'invalid sources accepted';
 exception when invalid_parameter_value then null;
 end;
end $$;
reset role;
set request.jwt.claim.role='service_role';
do $$ declare rows jsonb; begin
 select jsonb_agg(role order by created_at,id) into rows from public.chat_messages where session_id='d6666666-6666-4666-8666-666666666666';
 if rows is distinct from '["user","assistant"]' or exists(select 1 from public.chat_messages where session_id='d1111111-1111-4111-8111-111111111111')
 then raise exception 'atomic order or clear fence failed'; end if;
 if not exists(select 1 from public.chat_messages where session_id='d6666666-6666-4666-8666-666666666666'
  and role='assistant' and metadata->>'session_revision'='1') then raise exception 'stored revision missing'; end if;
 if exists(select 1 from public.chat_sessions where id='d7777777-7777-4777-8777-777777777777') then raise exception 'unexpected session'; end if;
end $$;
-- Force failure on the second insert; the session, first insert and admission
-- consumption must all roll back through the same PostgreSQL subtransaction.
create function public.synthetic_reject_turn_answer() returns trigger language plpgsql as $$ begin
 if new.session_id='d7777777-7777-4777-8777-777777777777' and new.role='assistant' then raise exception 'Synthetic second insert failure'; end if;
 return new;
end $$;
create trigger synthetic_reject_turn_answer before insert on public.chat_messages for each row execute function public.synthetic_reject_turn_answer();
set local role authenticated;
set request.jwt.claim.role='authenticated';
do $$ begin
 begin
  perform public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d7777777-7777-4777-8777-777777777777','d0000000-0000-4000-8000-000000000005',0,'Question','Answer','[]','{}');
  raise exception 'forced insert failure did not occur' using errcode='XX000';
 exception when raise_exception then null;
 end;
end $$;
reset role;
set request.jwt.claim.role='service_role';
do $$ begin
 if exists(select 1 from public.chat_sessions where id='d7777777-7777-4777-8777-777777777777')
 or exists(select 1 from public.chat_messages where session_id='d7777777-7777-4777-8777-777777777777')
 or exists(select 1 from public.nexus_account_operations where user_id='22222222-2222-4222-8222-222222222222'
  and idempotency_key='d0000000-0000-4000-8000-000000000005' and outcome->>'gateway_turn_committed'='true')
 then raise exception 'partial turn survived transaction failure'; end if;
end $$;
-- A downgraded owner, a removed owner and an inactive workspace lose both RPCs.
update public.workspace_members set role='viewer' where workspace_id='11111111-1111-4111-8111-111111111111' and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$ begin
 if public.read_gateway_private_turn_context('11111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222') is distinct from '[]'
 or public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000006',1,'Question','Answer','[]','{}') is distinct from '[]'
 then raise exception 'viewer retained research write authority'; end if;
end $$;
reset role;set request.jwt.claim.role='service_role';
update public.workspace_members set role='admin' where workspace_id='11111111-1111-4111-8111-111111111111' and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;set request.jwt.claim.role='authenticated';
do $$ begin
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000006',1,'Question','Answer','[]','{}')->0->>'state' is distinct from 'COMMITTED'
 then raise exception 'admin own private turn failed'; end if;
end $$;
reset role;set request.jwt.claim.role='service_role';
delete from public.workspace_members where workspace_id='11111111-1111-4111-8111-111111111111' and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;set request.jwt.claim.role='authenticated';
do $$ begin
 if public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d2222222-2222-4222-8222-222222222222','d0000000-0000-4000-8000-000000000007',2,'Question','Answer','[]','{}') is distinct from '[]'
 then raise exception 'removed owner retained turn authority'; end if;
end $$;
reset role;set request.jwt.claim.role='service_role';
update public.workspaces set lifecycle_state='deleting' where id='11111111-1111-4111-8111-111111111111';
set local role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 if public.read_gateway_private_turn_context('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111') is distinct from '[]'
 or public.commit_gateway_private_turn('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','d0000000-0000-4000-8000-000000000005',3,'Question','Answer','[]','{}') is distinct from '[]'
 then raise exception 'inactive workspace accepted'; end if;
end $$;
set request.jwt.claim.sub='';
do $$ begin
 if public.read_gateway_private_turn_context('11111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111') is distinct from '[]' then raise exception 'missing actor accepted'; end if;
end $$;
reset role;rollback;
select 'GATEWAY_PRIVATE_TURN_AUTHORITY_PASS (synthetic PostgreSQL, not hosted OAuth)';
