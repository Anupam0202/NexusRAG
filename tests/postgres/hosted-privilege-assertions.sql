\set ON_ERROR_STOP on
-- Hosted Supabase gives the service role no access to the auth schema's tables. Assertions that run as the
-- database owner cannot see that, so these checks run as the service role, the way the gateway does.
begin;
do $$ declare offenders text; begin
  select string_agg(p.proname, ', ' order by p.proname) into offenders
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
     and pg_get_functiondef(p.oid) ~* '\mauth\.(users|sessions|identities|refresh_tokens)\M';
  if offenders is not null then
    raise exception 'functions read auth tables with the caller''s rights, which the service role lacks on hosted Supabase: %', offenders;
  end if;
  if has_table_privilege('service_role', 'auth.users', 'select') then
    raise exception 'the local stand-in must not grant the service role access to auth.users';
  end if;
end $$;
set local role service_role;
set local request.jwt.claim.role = 'service_role';
do $$
declare actor uuid = '22222222-2222-4222-8222-222222222222'; created jsonb; denied boolean = false;
begin
  created = public.nexus_create_workspace(actor, 'Service role fixture', 'service-role-fixture', 'hosted-privilege-1');
  if created->>'role' <> 'owner' or (created->>'workspace_id') is null then
    raise exception 'the service role could not create a workspace';
  end if;
  begin
    perform public.nexus_create_workspace('99999999-9999-4999-8999-999999999999', 'Unknown actor', 'unknown-actor-fixture', 'hosted-privilege-2');
  exception when others then
    if sqlerrm like '%NR:INVALID_SCOPE%' then denied = true; else raise; end if;
  end;
  if not denied then raise exception 'a workspace was created for an account that does not exist'; end if;
end $$;
rollback;
select 'HOSTED_PRIVILEGE_SQL_PASS';
