\set ON_ERROR_STOP on
begin;
set request.jwt.claim.role='service_role';
insert into public.workspace_settings(workspace_id,retention_enabled,retention_days,next_retention_at)
  values('11111111-1111-4111-8111-111111111111',true,30,clock_timestamp()-interval '1 day')
  on conflict(workspace_id) do update set retention_enabled=true,retention_days=30,next_retention_at=excluded.next_retention_at,
    retention_lease_owner=null,retention_lease_expires_at=null;
do $$
declare w uuid='11111111-1111-4111-8111-111111111111'; c public.workspace_settings%rowtype; before_row jsonb; newer timestamptz;
begin
  if has_function_privilege('anon','public.finish_retention_claim(uuid,text,timestamptz,integer,boolean)','execute')
    or has_function_privilege('authenticated','public.finish_retention_claim(uuid,text,timestamptz,integer,boolean)','execute')
    or not has_function_privilege('service_role','public.finish_retention_claim(uuid,text,timestamptz,integer,boolean)','execute')
    then raise exception 'Unsafe retention completion grant'; end if;
  select * into c from public.claim_retention_schedules('synthetic-worker',100,60) where workspace_id=w;
  if c.retention_lease_owner<>'synthetic-worker' or c.retention_lease_expires_at is null then raise exception 'Claim missing'; end if;
  before_row=to_jsonb(c);
  if public.finish_retention_claim(w,'other-worker',c.retention_lease_expires_at,30,true)
    or public.finish_retention_claim('44444444-4444-4444-8444-444444444444','synthetic-worker',c.retention_lease_expires_at,30,true)
    or public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,31,true)
    then raise exception 'Foreign claim or changed policy accepted'; end if;
  if (select to_jsonb(s) from public.workspace_settings s where workspace_id=w) is distinct from before_row then raise exception 'Rejected write mutated schedule'; end if;
  -- Same worker ID is not enough: an older claim must not release its successor.
  newer=c.retention_lease_expires_at+interval '1 second';
  update public.workspace_settings set retention_lease_expires_at=newer where workspace_id=w;
  if public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,true) then raise exception 'ABA stale expiry accepted'; end if;
  if not public.finish_retention_claim(w,'synthetic-worker',newer,30,true) then raise exception 'Current success denied'; end if;
  select * into c from public.workspace_settings where workspace_id=w;
  if c.retention_lease_owner is not null or c.retention_lease_expires_at is not null or c.last_retention_at is null
    or c.next_retention_at-c.last_retention_at<>interval '1 day' then raise exception 'Wrong success schedule'; end if;
  if public.finish_retention_claim(w,'synthetic-worker',newer,30,false) then raise exception 'Committed success overwritten by replayed retry'; end if;
  update public.workspace_settings set retention_lease_owner='synthetic-worker',retention_lease_expires_at=clock_timestamp()+interval '1 minute' where workspace_id=w;
  select * into c from public.workspace_settings where workspace_id=w;
  if not public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,false) then raise exception 'Current retry denied'; end if;
  if (select last_retention_at from public.workspace_settings where workspace_id=w) is distinct from c.last_retention_at then raise exception 'Retry changed prior completion'; end if;
  update public.workspace_settings set retention_lease_owner='synthetic-worker',retention_lease_expires_at=clock_timestamp()-interval '1 second' where workspace_id=w;
  select * into c from public.workspace_settings where workspace_id=w;
  if public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,true) then raise exception 'Expired claim accepted'; end if;
  update public.workspace_settings set retention_enabled=false,retention_lease_expires_at=clock_timestamp()+interval '1 minute' where workspace_id=w;
  select * into c from public.workspace_settings where workspace_id=w;
  if public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,false) then raise exception 'Disabled schedule accepted'; end if;
  begin perform public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,null);
    raise exception 'Null outcome accepted';
  exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  begin perform public.finish_retention_claim(w,'',c.retention_lease_expires_at,30,true);
    raise exception 'Empty worker accepted';
  exception when others then if sqlerrm<>'NR:INVALID_SCOPE' then raise; end if; end;
  if public.finish_retention_claim('99999999-9999-4999-8999-999999999999','synthetic-worker',c.retention_lease_expires_at,30,true) then raise exception 'Missing schedule accepted'; end if;
  perform set_config('request.jwt.claim.role','authenticated',true);
  begin perform public.finish_retention_claim(w,'synthetic-worker',c.retention_lease_expires_at,30,true);
    raise exception 'Missing runtime service guard';
  exception when others then if sqlerrm<>'NR:AUTH_REQUIRED' then raise; end if; end;
end $$;
rollback;
select 'POSTGRES_RETENTION_SCHEDULE_FENCE_PASS (synthetic SQL; not hosted cleanup)' as result;
