\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
create function pg_temp.expect_invitation_denial(command text,expected text)
returns void language plpgsql as $$
begin
  begin execute command;
  exception when others then
    if position(expected in sqlerrm)=0 then raise exception 'Wrong denial: %',sqlerrm; end if;
    return;
  end;
  raise exception 'Expected denial did not occur: %',expected;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
 ('60000000-0000-4000-8000-000000000001','recipient@example.invalid',clock_timestamp()),
 ('70000000-0000-4000-8000-000000000001','admin@example.invalid',clock_timestamp()),
 ('80000000-0000-4000-8000-000000000001','editor@example.invalid',clock_timestamp()),
 ('90000000-0000-4000-8000-000000000001','new@example.invalid',clock_timestamp());
insert into public.workspace_members(workspace_id,user_id,role) values
 ('11111111-1111-4111-8111-111111111111','70000000-0000-4000-8000-000000000001','admin'),
 ('11111111-1111-4111-8111-111111111111','80000000-0000-4000-8000-000000000001','editor');
update auth.users set email_confirmed_at=clock_timestamp() where id in('22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333');
do $$
declare ws uuid='11111111-1111-4111-8111-111111111111'; owner_id uuid='22222222-2222-4222-8222-222222222222';
  target uuid='60000000-0000-4000-8000-000000000001'; admin_id uuid='70000000-0000-4000-8000-000000000001';
  cmd jsonb=jsonb_build_object('recipient_email',' Recipient@Example.invalid ','role','viewer','token_hash',repeat('a',64),'idempotency_key','invitation-fixture-a');
  first_result jsonb; replay jsonb; inventory jsonb; before_revision bigint; accepted jsonb;
begin
  if has_table_privilege('anon','public.workspace_invitations','select')
    or has_table_privilege('authenticated','public.workspace_invitations','insert')
    or has_table_privilege('service_role','public.workspace_invitations','insert')
    or has_function_privilege('authenticated','public.nexus_accept_workspace_invitation(uuid,text)','execute') then
    raise exception 'Invitation authority has unsafe direct grants';
  end if;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''create'',null,%L)',ws,'80000000-0000-4000-8000-000000000001',cmd),'NR:FORBIDDEN');
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''create'',null,%L)',ws,'33333333-3333-4333-8333-333333333333',cmd),'NR:FORBIDDEN');
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''create'',null,%L)',ws,admin_id,cmd||'{"role":"admin"}'),'NR:FORBIDDEN');
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''create'',null,%L)',ws,owner_id,cmd||'{"role":"owner"}'),'NR:INVALID_SCOPE');
  first_result=public.nexus_workspace_invitation(ws,owner_id,'create',null,cmd);
  if first_result->>'recipient_email'<>'recipient@example.invalid' or first_result ?| array['token_hash','payload_hash','idempotency_key'] then raise exception 'Unsafe invitation projection'; end if;
  replay=public.nexus_workspace_invitation(ws,owner_id,'create',null,cmd);
  if replay->>'id' is distinct from first_result->>'id' or (select count(*) from public.workspace_invitations where workspace_id=ws)<>1 then raise exception 'Invitation replay was not idempotent'; end if;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''create'',null,%L)',ws,owner_id,cmd||'{"role":"editor"}'),'NR:VERSION_CONFLICT');
  inventory=public.nexus_workspace_invitation(ws,admin_id,'list');
  if inventory->>'total'<>'1' or jsonb_array_length(inventory->'invitations')<>1 or inventory::text like '%'||repeat('a',64)||'%' then raise exception 'Unsafe invitation inventory'; end if;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)','33333333-3333-4333-8333-333333333333',repeat('a',64)),'NR:FORBIDDEN');
  -- Mutable profile email cannot impersonate the intended confirmed Auth user.
  update public.profiles set email='recipient@example.invalid' where id='33333333-3333-4333-8333-333333333333';
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)','33333333-3333-4333-8333-333333333333',repeat('a',64)),'NR:FORBIDDEN');
  update auth.users set email_confirmed_at=null where id=target;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('a',64)),'NR:FORBIDDEN');
  update auth.users set email_confirmed_at=clock_timestamp() where id=target;
  select capability_revision into before_revision from public.workspaces where id=ws;
  accepted=public.nexus_accept_workspace_invitation(target,repeat('a',64));
  if accepted->>'role'<>'viewer' or accepted->>'workspace_id'<>ws::text or not exists(select 1 from public.workspace_members where workspace_id=ws and user_id=target and role='viewer')
    or (select capability_revision from public.workspaces where id=ws)<=before_revision then raise exception 'Acceptance did not install/fence membership'; end if;
  if public.nexus_accept_workspace_invitation(target,repeat('a',64)) is distinct from accepted then raise exception 'Accepted replay was not idempotent'; end if;
  delete from public.workspace_members where workspace_id=ws and user_id=target;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('a',64)),'NR:VERSION_CONFLICT');
  if (select count(*) from public.audit_events where workspace_id=ws and action='invitation.create')<>1
    or (select count(*) from public.audit_events where workspace_id=ws and action='invitation.accept')<>1 then raise exception 'Invitation audit duplicated or absent'; end if;
end $$;
do $$
declare ws uuid='11111111-1111-4111-8111-111111111111'; owner_id uuid='22222222-2222-4222-8222-222222222222';
  target uuid='90000000-0000-4000-8000-000000000001'; admin_id uuid='70000000-0000-4000-8000-000000000001';
  i jsonb; cmd jsonb=jsonb_build_object('recipient_email','new@example.invalid','role','admin','token_hash',repeat('b',64),'idempotency_key','invitation-fixture-b');
begin
  i=public.nexus_workspace_invitation(ws,owner_id,'create',null,cmd);
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''revoke'',%L)',ws,admin_id,i->>'id'),'NR:FORBIDDEN');
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''revoke'',%L)','44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333',i->>'id'),'NR:INVALID_SCOPE');
  update public.workspace_invitations set expires_at=clock_timestamp()-interval '1 second' where id=(i->>'id')::uuid;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('b',64)),'NR:VERSION_CONFLICT');
  if public.nexus_workspace_invitation(ws,owner_id,'list')->>'total'<>'0' then raise exception 'Expired invitation remains usable'; end if;
  -- Expired pending records do not block a replacement, but cannot be accepted.
  i=public.nexus_workspace_invitation(ws,owner_id,'create',null,cmd||jsonb_build_object('token_hash',repeat('c',64),'idempotency_key','invitation-fixture-c'));
  if (select count(*) from public.audit_events where workspace_id=ws and action='invitation.expire')<>1 then raise exception 'Replacement did not record expiration'; end if;
  update public.workspace_members set role='viewer' where workspace_id=ws and user_id=owner_id;
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('c',64)),'NR:FORBIDDEN');
  update public.workspace_members set role='owner' where workspace_id=ws and user_id=owner_id;
  perform public.nexus_workspace_invitation(ws,owner_id,'revoke',(i->>'id')::uuid);
  perform public.nexus_workspace_invitation(ws,owner_id,'revoke',(i->>'id')::uuid);
  perform pg_temp.expect_invitation_denial(format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('c',64)),'NR:VERSION_CONFLICT');
  if (select count(*) from public.audit_events where workspace_id=ws and action='invitation.revoke')<>1 then raise exception 'Revocation audit duplicated'; end if;
  perform set_config('request.jwt.claim.role','',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.nexus_workspace_invitation(ws,owner_id,'list');
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform pg_temp.expect_invitation_denial(format('select public.nexus_workspace_invitation(%L,%L,''list'')',ws,owner_id),'NR:AUTH_REQUIRED');
  perform set_config('request.jwt.claim.role','service_role',true);
end $$;
do $$
declare ws uuid='e1111111-1111-4111-8111-111111111111';
  owner_id uuid='22222222-2222-4222-8222-222222222222';
  target uuid='90000000-0000-4000-8000-000000000001'; result jsonb; state text;
begin
  insert into public.workspaces(id,name,slug,owner_id)
    values(ws,'Synthetic invitation lifecycle','synthetic-invitation-lifecycle',owner_id);
  insert into public.workspace_members(workspace_id,user_id,role) values(ws,owner_id,'owner');
  result=public.nexus_workspace_invitation(ws,owner_id,'create',null,
    jsonb_build_object('recipient_email','new@example.invalid','role','viewer',
      'token_hash',repeat('f',64),'idempotency_key','synthetic-lifecycle'));
  foreach state in array array['deleting','deleted'] loop
    update public.workspaces set lifecycle_state=state where id=ws;
    perform pg_temp.expect_invitation_denial(
      format('select public.nexus_accept_workspace_invitation(%L,%L)',target,repeat('f',64)),
      'NR:WORKSPACE_UNAVAILABLE');
    perform pg_temp.expect_invitation_denial(
      format('select public.nexus_workspace_invitation(%L,%L,''list'')',ws,owner_id),
      'NR:WORKSPACE_UNAVAILABLE');
  end loop;
  delete from public.workspaces where id=ws;
  if exists(select 1 from public.workspace_invitations where id=(result->>'id')::uuid)
    then raise exception 'Physical workspace deletion retained invitation authority'; end if;
end $$;
rollback;
select 'POSTGRES_RECIPIENT_INVITATION_AUTHORITY_PASS (synthetic Auth/Storage stand-ins; not hosted OAuth)' as result;
