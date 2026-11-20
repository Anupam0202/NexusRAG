-- Forward-only schedule-write fencing. External cleanup is not atomic with SQL.
begin;
create function public.finish_retention_claim(
  p_workspace uuid, p_worker_id text, p_lease_expires_at timestamptz,
  p_retention_days integer, p_succeeded boolean
) returns boolean language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare claim public.workspace_settings%rowtype; observed_at timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'NR:AUTH_REQUIRED';
  end if;
  if p_workspace is null or p_worker_id is null or length(trim(p_worker_id))=0
    or p_lease_expires_at is null or p_retention_days is null or p_retention_days<1
    or p_succeeded is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into claim from public.workspace_settings where workspace_id=p_workspace for update;
  -- Evaluate expiry after obtaining the lock, not at transaction start.
  observed_at=clock_timestamp();
  if not found or claim.retention_lease_owner is distinct from p_worker_id
    or claim.retention_lease_expires_at is distinct from p_lease_expires_at
    or claim.retention_lease_expires_at<=observed_at
    or not claim.retention_enabled or claim.retention_days is distinct from p_retention_days
    then return false; end if;
  update public.workspace_settings set
    last_retention_at=case when p_succeeded then observed_at else last_retention_at end,
    next_retention_at=observed_at+case when p_succeeded then interval '1 day' else interval '1 hour' end,
    retention_lease_owner=null,retention_lease_expires_at=null
    where workspace_id=p_workspace;
  return true;
end;
$$;
revoke execute on function public.finish_retention_claim(uuid,text,timestamptz,integer,boolean) from public,anon,authenticated;
grant execute on function public.finish_retention_claim(uuid,text,timestamptz,integer,boolean) to service_role;
commit;
