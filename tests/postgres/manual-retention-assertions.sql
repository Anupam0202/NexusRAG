\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
update auth.users set email_confirmed_at=clock_timestamp()
  where id='22222222-2222-4222-8222-222222222222';
insert into public.workspace_settings(workspace_id,retention_enabled,retention_days,next_retention_at)
  values('11111111-1111-4111-8111-111111111111',true,30,clock_timestamp()+interval '1 day')
  on conflict(workspace_id) do update set retention_enabled=true,retention_days=30,
    next_retention_at=excluded.next_retention_at,retention_lease_owner=null,retention_lease_expires_at=null;
do $$
declare w uuid='11111111-1111-4111-8111-111111111111'; actor uuid='22222222-2222-4222-8222-222222222222';
  c jsonb; original jsonb;
begin
  if has_function_privilege('anon','public.claim_workspace_retention(uuid,uuid,text,integer)','execute')
    or has_function_privilege('authenticated','public.claim_workspace_retention(uuid,uuid,text,integer)','execute')
    or not has_function_privilege('service_role','public.claim_workspace_retention(uuid,uuid,text,integer)','execute')
    then raise exception 'Unsafe manual retention grant'; end if;
  begin perform public.claim_workspace_retention(w,'33333333-3333-4333-8333-333333333333','foreign',60);
    raise exception 'Foreign actor accepted';
  exception when others then if sqlerrm<>'NR:FORBIDDEN' then raise; end if; end;
  c=public.claim_workspace_retention(w,actor,'manual-one',60);
  if c is null or c->>'retention_lease_owner'<>'manual-one'
    or c->>'workspace_id'<>w::text or (select count(*) from jsonb_object_keys(c))<>5 then raise exception 'Wrong scoped claim'; end if;
  select to_jsonb(s) into original from public.workspace_settings s where workspace_id=w;
  if public.claim_workspace_retention(w,actor,'manual-two',60) is not null then raise exception 'Active lease stolen'; end if;
  if exists(select 1 from public.claim_retention_schedules('scheduler',100,60) where workspace_id=w) then raise exception 'Scheduler stole manual lease'; end if;
  if (select to_jsonb(s) from public.workspace_settings s where workspace_id=w) is distinct from original then raise exception 'Denied claim mutated state'; end if;
  if not public.finish_retention_claim(w,'manual-one',(c->>'retention_lease_expires_at')::timestamptz,30,true) then raise exception 'Manual finish denied'; end if;
  if public.finish_retention_claim(w,'manual-one',(c->>'retention_lease_expires_at')::timestamptz,30,false) then raise exception 'Response-loss replay overwrote success'; end if;
  update public.workspace_settings set retention_lease_owner='scheduler',retention_lease_expires_at=clock_timestamp()+interval '60 seconds' where workspace_id=w;
  if public.claim_workspace_retention(w,actor,'manual-one',60) is not null then raise exception 'Manual stole scheduler lease'; end if;
  update public.workspace_settings set retention_lease_expires_at=clock_timestamp()-interval '1 second' where workspace_id=w;
  if public.claim_workspace_retention(w,actor,'manual-three',60) is null then raise exception 'Expired lease unrecoverable'; end if;
  update public.workspace_settings set retention_enabled=false,retention_lease_owner=null,retention_lease_expires_at=null where workspace_id=w;
  if public.claim_workspace_retention(w,actor,'manual-four',60) is not null then raise exception 'Disabled policy accepted'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin perform public.claim_workspace_retention(w,actor,'browser',60); raise exception 'Browser role accepted';
  exception when others then if sqlerrm<>'NR:AUTH_REQUIRED' then raise; end if; end;
end $$;
rollback;
select 'POSTGRES_MANUAL_RETENTION_CLAIM_PASS (synthetic SQL; not hosted cleanup)' as result;
