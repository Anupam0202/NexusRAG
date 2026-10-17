\set ON_ERROR_STOP on
-- Real PostgreSQL transactions with rollback-only synthetic Auth sessions.
begin;
set request.jwt.claim.role='service_role';
insert into auth.sessions(id,user_id) values
 ('b0000000-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222'),
 ('b0000000-0000-4000-8000-000000000002','33333333-3333-4333-8333-333333333333');
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','viewer');
insert into public.chat_sessions(id,workspace_id,user_id,visibility,deleted_at) values
 ('b1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',null),
 ('b2222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','private',null),
 ('b3333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',null,'private',null),
 ('b4444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111',null,'legacy_workspace',null),
 ('b5555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','private',now()),
 ('b6666666-6666-4666-8666-666666666666','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','private',null);
insert into public.conversation_participants(workspace_id,session_id,user_id,permission) values
 ('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','contribute');
do $$ begin
 if has_table_privilege('authenticated','public.chat_messages','INSERT')
 or has_table_privilege('authenticated','auth.sessions','SELECT')
 or has_function_privilege('authenticated','public.stage_backend_private_turn(uuid,uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb)','EXECUTE')
 or has_function_privilege('anon','public.read_backend_private_turn_context(uuid,uuid)','EXECUTE')
 or has_function_privilege('service_role','public.commit_backend_private_turn(uuid,uuid,uuid,bigint,bigint,text,text,jsonb,jsonb)','EXECUTE')
 then raise exception 'backend turn privileges widened'; end if;
end $$;
-- Stage exact server payloads before caller commits. Missing/altered/replayed
-- payloads must never mint assistant evidence via an authenticated RPC.
select public.stage_backend_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'b1111111-1111-4111-8111-111111111111','b0000000-0000-4000-8000-000000000010',1,0,'Question','Answer','[]','{}');
select public.stage_backend_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'b7777777-7777-4777-8777-777777777777','b0000000-0000-4000-8000-000000000011',0,0,'New question','New answer','[]','{}');
select public.stage_backend_private_turn('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111',
 'b8888888-8888-4888-8888-888888888888','b0000000-0000-4000-8000-000000000012',0,0,'Rollback','Rollback answer','[]','{}');
select set_config('request.jwt.claims',jsonb_build_object('session_id','b0000000-0000-4000-8000-000000000001',
 'exp',extract(epoch from clock_timestamp())+3600)::text,true);
set local role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ declare r jsonb; sid uuid; begin
 foreach sid in array array['b2222222-2222-4222-8222-222222222222'::uuid,
 'b3333333-3333-4333-8333-333333333333','b4444444-4444-4444-8444-444444444444',
 'b5555555-5555-4555-8555-555555555555','b6666666-6666-4666-8666-666666666666'] loop
  if public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111',sid) is distinct from '[]'::jsonb
  or public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111',sid,
   'b0000000-0000-4000-8000-000000000010',1,0,'Question','Answer','[]','{}') is distinct from '[]'::jsonb
  then raise exception 'foreign/participant/ownerless/legacy/tombstone scope accepted'; end if;
 end loop;
 if public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b7777777-7777-4777-8777-777777777777',
  'b0000000-0000-4000-8000-000000000099',0,0,'Forged','Forged answer','[]','{}') is distinct from '[]'::jsonb
 then raise exception 'unstaged evidence forged'; end if;
 if public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b7777777-7777-4777-8777-777777777777',
  'b0000000-0000-4000-8000-000000000011',0,0,'New question','Altered answer','[]','{}') is distinct from '[]'::jsonb
 then raise exception 'attested answer altered'; end if;
 r=public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111');
 if r->0->>'revision' is distinct from '1' or r->0->>'history_epoch' is distinct from '0'
 then raise exception 'owner context missing'; end if;
 r=public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','B1111111-1111-4111-8111-111111111111',
  'b0000000-0000-4000-8000-000000000010',1,0,'Question','Answer','[]','{}');
 if r->0->>'state' is distinct from 'COMMITTED' or r->0->>'revision' is distinct from '2'
 or r->0->>'history_epoch' is distinct from '1' or r->0->>'messages_written' is distinct from '2'
 then raise exception 'pair/revision/epoch receipt mismatch'; end if;
 if public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
  'b0000000-0000-4000-8000-000000000010',1,0,'Question','Answer','[]','{}')->0->>'state' is distinct from 'CONFLICT'
 then raise exception 'committed key replayed'; end if;
 r=public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b7777777-7777-4777-8777-777777777777',
  'b0000000-0000-4000-8000-000000000011',0,0,'New question','New answer','[]','{}');
 if r->0->>'state' is distinct from 'COMMITTED' or r->0->>'revision' is distinct from '1'
 then raise exception 'new session failed'; end if;
end $$;
reset role;
set request.jwt.claim.role='service_role';
do $$ declare roles jsonb; begin
 select jsonb_agg(role order by created_at,id) into roles from public.chat_messages
 where session_id='b7777777-7777-4777-8777-777777777777';
 if roles is distinct from '["user","assistant"]'::jsonb then raise exception 'partial or misordered pair'; end if;
end $$;
-- Test all Python roles on their own session without importing Gateway's
-- narrower research-role contract. Each role gets a fresh attestation.
do $$ declare role_name text; i int=20; r jsonb; rev bigint; ep bigint; k uuid; begin
 foreach role_name in array array['viewer','editor','admin','owner'] loop
  perform set_config('request.jwt.claim.role','service_role',true);
  perform set_config('request.jwt.claim.sub','',true);
  update public.workspace_members set role=role_name
   where workspace_id='11111111-1111-4111-8111-111111111111' and user_id='33333333-3333-4333-8333-333333333333';
  select revision,history_epoch into rev,ep from public.chat_sessions where id='b2222222-2222-4222-8222-222222222222';
  k=('b0000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid; i=i+1;
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.stage_backend_private_turn('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
   'b2222222-2222-4222-8222-222222222222',k,rev,ep,'Role question','Role answer','[]','{}');
  perform set_config('request.jwt.claim.role','authenticated',true);
  perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
  perform set_config('request.jwt.claims',jsonb_build_object('session_id','b0000000-0000-4000-8000-000000000002',
   'exp',extract(epoch from clock_timestamp())+3600)::text,true);
  r=public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b2222222-2222-4222-8222-222222222222',k,rev,ep,
   'Role question','Role answer','[]','{}');
  if r->0->>'state' is distinct from 'COMMITTED' then raise exception 'own role % rejected',role_name; end if;
 end loop;
end $$;
-- Force a second-row failure. The creation, pair, epoch/revision and staging
-- consumption must roll back together, not just the assistant row.
create function public.synthetic_reject_backend_answer() returns trigger language plpgsql as $$ begin
 if new.session_id='b8888888-8888-4888-8888-888888888888' and new.role='assistant' then raise exception 'Synthetic answer rejection'; end if;
 return new;
end $$;
create trigger synthetic_reject_backend_answer before insert on public.chat_messages
 for each row execute function public.synthetic_reject_backend_answer();
set local role authenticated;
set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claims',jsonb_build_object('session_id','b0000000-0000-4000-8000-000000000001',
 'exp',extract(epoch from clock_timestamp())+3600)::text,true);
do $$ begin
 begin
  perform public.commit_backend_private_turn('11111111-1111-4111-8111-111111111111','b8888888-8888-4888-8888-888888888888',
   'b0000000-0000-4000-8000-000000000012',0,0,'Rollback','Rollback answer','[]','{}');
  raise exception 'answer rejection did not occur' using errcode='XX000';
 exception when raise_exception then null;
 end;
end $$;
reset role;set request.jwt.claim.role='service_role';
do $$ begin
 if exists(select 1 from public.chat_sessions where id='b8888888-8888-4888-8888-888888888888')
 or exists(select 1 from public.chat_messages where session_id='b8888888-8888-4888-8888-888888888888')
 or exists(select 1 from public.nexus_account_operations where idempotency_key='b0000000-0000-4000-8000-000000000012' and outcome->>'committed'='true')
 then raise exception 'partial transaction survived failure'; end if;
end $$;
-- Every legacy message mutation changes the separate epoch, even when the
-- legacy writer leaves revision unchanged. Empty deletes do not fake change.
do $$ declare ep bigint; rev bigint; begin
 select history_epoch,revision into ep,rev from public.chat_sessions where id='b1111111-1111-4111-8111-111111111111';
 insert into public.chat_messages(workspace_id,session_id,role,content) values
 ('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111','user','Legacy write');
 if not exists(select 1 from public.chat_sessions where id='b1111111-1111-4111-8111-111111111111' and history_epoch=ep+1 and revision=rev)
 then raise exception 'legacy append not fenced'; end if;
 update public.chat_messages set content='Legacy update' where session_id='b1111111-1111-4111-8111-111111111111' and content='Legacy write';
 delete from public.chat_messages where session_id='b1111111-1111-4111-8111-111111111111' and content='Legacy update';
 delete from public.chat_messages where session_id='b1111111-1111-4111-8111-111111111111' and content='not present';
 if not exists(select 1 from public.chat_sessions where id='b1111111-1111-4111-8111-111111111111' and history_epoch=ep+3 and revision=rev)
 then raise exception 'update/delete epoch fence incorrect'; end if;
end $$;
-- Current JWT expiry and Auth row are independent required authorities.
set request.jwt.claim.role='service_role';set request.jwt.claim.sub='';
insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename) values
 ('b9000000-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','synthetic.txt','synthetic.txt');
insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,
 original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state) values
 ('b9000000-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','b9000000-0000-4000-8000-000000000001',
 'documents','synthetic-only',repeat('a',64),1,now(),'synthetic','synthetic',1,'ready');
insert into public.ingestion_jobs(id,workspace_id,kind) values
 ('b9000000-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','queries');
insert into public.usage_reservations(id,workspace_id,actor_id,operation_id,reserved_queries,reserved_tokens,state,expires_at) values
 ('b9000000-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'b9000000-0000-4000-8000-000000000003',1,10,'reserved',now()+interval '1 hour');
insert into public.query_runs(id,workspace_id,user_id,session_id,job_id,reservation_id,idempotency_key,payload_hash,request,context,state,deadline) values
 ('b9000000-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',
 'b1111111-1111-4111-8111-111111111111','b9000000-0000-4000-8000-000000000003','b9000000-0000-4000-8000-000000000004',
 'synthetic-source-history',repeat('a',64),'{}','{}','completed',now()+interval '1 hour');
insert into public.query_run_sources(workspace_id,run_id,document_id,version_id,lifecycle_epoch) values
 ('11111111-1111-4111-8111-111111111111','b9000000-0000-4000-8000-000000000005',
 'b9000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000002',1);
insert into public.chat_messages(workspace_id,session_id,run_id,role,content) values
 ('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111',
 'b9000000-0000-4000-8000-000000000005','assistant','Synthetic source-bound marker');
set local role authenticated;set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
select set_config('request.jwt.claims','{"session_id":"b0000000-0000-4000-8000-000000000001","exp":9999999999}',true);
do $$ begin
 if public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111')::text not like '%Synthetic source-bound marker%'
 then raise exception 'available source history was not retained'; end if;
end $$;
reset role;set request.jwt.claim.role='service_role';
update public.documents set lifecycle_state='deleted' where id='b9000000-0000-4000-8000-000000000001';
set local role authenticated;set request.jwt.claim.role='authenticated';
do $$ declare r jsonb; begin
 r=public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111');
 if r::text like '%Synthetic source-bound marker%' or r::text not like '%content withheld%'
 then raise exception 'source-dependent history bypassed lifecycle withholding'; end if;
end $$;
reset role;
set local role authenticated;set request.jwt.claim.role='authenticated';
do $$ declare claims jsonb; begin
 foreach claims in array array['{}'::jsonb,'{"session_id":"bad","exp":9999999999}',
 '{"session_id":"b0000000-0000-4000-8000-000000000001","exp":0}',
 '{"session_id":"b0000000-0000-4000-8000-000000000002","exp":9999999999}',
 '{"session_id":"b0000000-0000-4000-8000-000000000099","exp":9999999999}',
 '{"session_id":"b0000000-0000-4000-8000-000000000001","exp":"9999999999"}'] loop
  perform set_config('request.jwt.claims',claims::text,true);
  if public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111') is distinct from '[]'::jsonb
  then raise exception 'missing/expired/foreign/invalid auth session accepted'; end if;
 end loop;
end $$;
reset role;
update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='b0000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"session_id":"b0000000-0000-4000-8000-000000000001","exp":9999999999}',true);
do $$ begin
 if public.read_backend_private_turn_context('11111111-1111-4111-8111-111111111111','b1111111-1111-4111-8111-111111111111') is distinct from '[]'::jsonb
 then raise exception 'expired not_after accepted'; end if;
end $$;
reset role;rollback;
select 'BACKEND_PRIVATE_TURN_AUTHORITY_PASS (synthetic PostgreSQL, not hosted OAuth)';
