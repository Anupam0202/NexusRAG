\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
do $$
declare a uuid='22222222-2222-4222-8222-222222222222';
  b uuid='33333333-3333-4333-8333-333333333333'; w uuid='11111111-1111-4111-8111-111111111111';
  created jsonb; repeated jsonb; ctx jsonb; f jsonb; listed jsonb; manifest text; denied boolean; hash text; before_revision bigint;
begin
  if has_function_privilege('authenticated','public.nexus_manage_member(uuid,uuid,text,text,text)','execute')
    or has_function_privilege('anon','public.nexus_create_workspace(uuid,text,text,text)','execute')
    or has_function_privilege('authenticated','public.nexus_record_finding_export(jsonb,uuid,bigint,text,text)','execute')
    then raise exception 'unsafe new RPC privileges'; end if;
  created=public.nexus_create_workspace(a,'Atomic fixture','atomic-fixture','create-fixture-1');
  repeated=public.nexus_create_workspace(a,'Atomic fixture','atomic-fixture','create-fixture-1');
  if created<>repeated then raise exception 'workspace create not idempotent'; end if;
  denied=false; begin
    perform public.nexus_create_workspace(a,'Different payload','atomic-fixture','create-fixture-1');
  exception when others then if sqlerrm like '%NR:VERSION_CONFLICT%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'idempotency payload mismatch allowed'; end if;
  -- Profile email is user-editable and must never select a member account.
  update public.profiles set email='spoofed@example.test' where id=b;
  denied=false; begin
    perform public.nexus_manage_member(w,a,'add','spoofed@example.test','editor');
  exception when others then if sqlerrm like '%NR:INVALID_SCOPE%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'editable profile email granted membership'; end if;
  if public.nexus_resolve_confirmed_member(b::text) is not null then
    raise exception 'unconfirmed identity accepted'; end if;
  update auth.users set email_confirmed_at=now() where id=b;
  if public.nexus_resolve_confirmed_member('b@example.invalid') is distinct from b then
    raise exception 'confirmed auth identity not resolved'; end if;
  if has_function_privilege('authenticated','public.nexus_resolve_confirmed_member(text)','execute')
    or has_function_privilege('anon','public.nexus_resolve_confirmed_member(text)','execute') then
    raise exception 'member identity directory exposed'; end if;
  select capability_revision into before_revision from public.workspaces where id=w;
  perform public.nexus_manage_member(w,a,'add',b::text,'editor');
  if (select capability_revision from public.workspaces where id=w)<>before_revision+1 then raise exception 'role revision not fenced'; end if;
  denied=false; begin perform public.nexus_manage_member(w,b,'update',a::text,'viewer');
    exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'editor escalated member authority'; end if;
  denied=false; begin perform public.nexus_manage_member(w,a,'remove',a::text,null);
    exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'last owner removed'; end if;
  -- Both users are now workspace members; findings remain private.
  insert into public.workspace_settings(workspace_id) values(w) on conflict do nothing;
  select jsonb_build_object('workspace_id',w,'user_id',a,'membership_revision',capability_revision,
    'policy_id',active_policy_id,'policy_version',policy_version,'deadline',now()+interval '5 minutes')
    into ctx from public.workspaces join public.workspace_settings on workspaces.id=workspace_settings.workspace_id where workspaces.id=w;
  f=public.nexus_finding(ctx,'create',null,'{"title":"Private fixture","authored_markdown":"Synthetic note"}',null,'finding-fixture',repeat('a',64));
  listed=public.workbench_read(ctx||jsonb_build_object('user_id',b),'findings');
  if jsonb_array_length(listed->'items')<>0 then raise exception 'private finding leaked in list'; end if;
  denied=false; begin
    perform public.nexus_finding(ctx||jsonb_build_object('user_id',b),'read',(f->>'id')::uuid,'{}',null,null,null);
  exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'private finding leaked in read'; end if;
  perform public.nexus_finding(ctx,'share',(f->>'id')::uuid,jsonb_build_object('user_id',b,'permission','contribute'),null,null,null);
  denied=false; begin
    perform public.nexus_finding(ctx,'review',(f->>'id')::uuid,'{"decision":"approved","comment":"Self"}',1,null,null);
  exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'self review allowed'; end if;
  perform public.nexus_finding(ctx||jsonb_build_object('user_id',b),'review',(f->>'id')::uuid,
    '{"decision":"approved","comment":"Independent synthetic review"}',1,null,null);
  f=public.nexus_finding(ctx,'read',(f->>'id')::uuid,'{}',null,null,null);
  manifest=jsonb_build_object('finding_id',f->>'id','workspace_id',w,'revision',1,'title',f->>'title',
    'authored_markdown',f->>'authored_markdown','reviews',f->'reviews','evidence',f->'evidence')::text;
  hash=encode(sha256(convert_to(manifest,'UTF8')),'hex');
  perform public.nexus_record_finding_export(ctx,(f->>'id')::uuid,1,manifest,hash);
  denied=false; begin
    perform public.nexus_record_finding_export(ctx,(f->>'id')::uuid,1,manifest,repeat('f',64));
  exception when others then if sqlerrm like '%NR:INVALID_SCOPE%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'tampered export hash accepted'; end if;
  perform public.nexus_finding(ctx,'unshare',(f->>'id')::uuid,jsonb_build_object('user_id',b),null,null,null);
  denied=false; begin
    perform public.nexus_finding(ctx||jsonb_build_object('user_id',b),'read',(f->>'id')::uuid,'{}',null,null,null);
  exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'revoked finding remains accessible'; end if;
  perform public.nexus_finding(ctx,'share',(f->>'id')::uuid,jsonb_build_object('user_id',b,'permission','contribute'),null,null,null);
  perform public.nexus_manage_member(w,a,'update',b::text,'viewer');
  denied=false; begin
    perform public.nexus_finding(ctx||jsonb_build_object('user_id',b,'membership_revision',
      (select capability_revision from public.workspaces where id=w)),'create',null,
      '{"title":"Viewer escalation","authored_markdown":"Must fail"}',null,'viewer-create',repeat('b',64));
  exception when others then if sqlerrm like '%NR:FORBIDDEN%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'viewer created finding after gateway role race'; end if;
  perform public.nexus_manage_member(w,a,'remove',b::text,null);
  if exists(select 1 from public.finding_participants where workspace_id=w and user_id=b)
    then raise exception 'removed member retains finding participation'; end if;
  denied=false; begin
    perform public.workbench_read(ctx,'findings');
  exception when others then if sqlerrm like '%NR:VERSION_CONFLICT%' then denied=true; else raise; end if; end;
  if not denied then raise exception 'stale workspace capability context accepted'; end if;
end $$;
rollback;
select 'workbench_management_private_findings_pass';