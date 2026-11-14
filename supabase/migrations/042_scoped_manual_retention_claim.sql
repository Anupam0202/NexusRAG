-- Manual retention shares scheduler leases. No external deletion atomicity claim.
begin;
create function public.claim_workspace_retention(
  p_workspace uuid, p_actor uuid, p_worker_id text, p_lease_seconds integer default 900
) returns jsonb language plpgsql security invoker
set search_path=pg_catalog,public,pg_temp as $$
declare claim public.workspace_settings%rowtype; observed_at timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_workspace is null or p_actor is null or p_worker_id is null
    or length(trim(p_worker_id)) not between 1 and 128
    or p_lease_seconds is null or p_lease_seconds not between 60 and 3600
    then raise exception 'NR:INVALID_SCOPE'; end if;
  -- Member-management operations lock this same parent before changing authority.
  perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for update;
  if not found then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  if public.nexus_resolve_confirmed_member(p_actor::text) is distinct from p_actor
    or not exists(select 1 from public.workspace_members where workspace_id=p_workspace
      and user_id=p_actor and role in('owner','admin')) then raise exception 'NR:FORBIDDEN'; end if;
  select * into claim from public.workspace_settings where workspace_id=p_workspace for update;
  observed_at=clock_timestamp();
  if not found or not claim.retention_enabled or claim.retention_days not between 1 and 3650
    or (claim.retention_lease_expires_at is not null and claim.retention_lease_expires_at>observed_at)
    then return null; end if;
  update public.workspace_settings set retention_lease_owner=p_worker_id,
    retention_lease_expires_at=observed_at+make_interval(secs=>p_lease_seconds)
    where workspace_id=p_workspace returning * into claim;
  return jsonb_build_object('workspace_id',p_workspace,'retention_enabled',true,
    'retention_days',claim.retention_days,'retention_lease_owner',claim.retention_lease_owner,
    'retention_lease_expires_at',claim.retention_lease_expires_at);
end $$;
revoke all on function public.claim_workspace_retention(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.claim_workspace_retention(uuid,uuid,text,integer) to service_role;
commit;
