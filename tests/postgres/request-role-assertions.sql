\set ON_ERROR_STOP on
-- PostgREST on hosted Supabase sets the caller's verified claims only as JSON (request.jwt.claims); the per-claim
-- setting request.jwt.claim.role is not set. Every check here runs under exactly that, which the other replay
-- assertions do not: they set request.jwt.claim.role themselves, and so never saw the service role refused by the
-- membership trigger (issue #33). Nothing here is kept.
begin;
do $$
declare
  ws constant uuid := '11111111-1111-4111-8111-111111111111';
  member constant uuid := 'a3333333-3333-4333-8333-333333333333';
begin
  insert into auth.users(id, email, email_confirmed_at) values (member, 'request-role@example.invalid', clock_timestamp());
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- What nexus_accept_workspace_invitation and nexus_manage_member do to a membership, as the service role.
  insert into public.workspace_members(workspace_id, user_id, role) values (ws, member, 'viewer');
  update public.workspace_members set role = 'editor' where workspace_id = ws and user_id = member;
  if (select role from public.workspace_members where workspace_id = ws and user_id = member) <> 'editor' then
    raise exception 'the service role could not change a member''s role';
  end if;
  delete from public.workspace_members where workspace_id = ws and user_id = member;
  if exists (select 1 from public.workspace_members where workspace_id = ws and user_id = member) then
    raise exception 'the service role could not remove a member';
  end if;
  if nexusrag_private.request_role() <> 'service_role' then
    raise exception 'the service role is not read from request.jwt.claims';
  end if;
  if not nexusrag_private.can_read_document_object('no-such-object') or not nexusrag_private.can_write_document_object('no-such-object') then
    raise exception 'the storage helpers do not recognise the service role from request.jwt.claims';
  end if;

  -- An ordinary signed-in user is still refused.
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', member)::text, true);
  if nexusrag_private.request_role() <> 'authenticated' then
    raise exception 'an ordinary user''s role is not read from request.jwt.claims';
  end if;
  begin
    insert into public.workspace_members(workspace_id, user_id, role) values (ws, member, 'viewer');
    raise exception 'an ordinary user added themselves to a workspace';
  exception when insufficient_privilege then
    null;
  end;
  if nexusrag_private.can_read_document_object('no-such-object') then
    raise exception 'an ordinary user may read an object no ready document names';
  end if;

  -- No claims at all: no role. The per-claim setting is still honoured where it is set.
  perform set_config('request.jwt.claims', '', true);
  if nexusrag_private.request_role() <> '' then
    raise exception 'a role was read although no claim is set';
  end if;
  perform set_config('request.jwt.claim.role', 'service_role', true);
  if nexusrag_private.request_role() <> 'service_role' then
    raise exception 'the per-claim setting is no longer read';
  end if;
end $$;
rollback;
\echo REQUEST_ROLE_SQL_PASS
