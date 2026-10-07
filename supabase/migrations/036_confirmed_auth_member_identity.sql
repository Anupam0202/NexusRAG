-- Forward hardening: editable profile emails must never grant workspace authority.
begin;
create or replace function public.nexus_resolve_confirmed_member(p_identifier text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare target uuid;
begin
  if p_identifier is null or length(p_identifier)>254 then return null; end if;
  if p_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into target from auth.users where id=p_identifier::uuid and email_confirmed_at is not null;
  else
    select case when count(*)=1 then min(id::text)::uuid else null end into target
      from auth.users where lower(email)=lower(trim(p_identifier)) and email_confirmed_at is not null;
  end if;
  return target;
end $$;
revoke all on function public.nexus_resolve_confirmed_member(text) from public,anon,authenticated;
grant execute on function public.nexus_resolve_confirmed_member(text) to service_role;
create or replace function public.nexus_manage_member(
  p_workspace uuid, p_actor uuid, p_operation text, p_target text, p_role text default null
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare w public.workspaces%rowtype; actor_role text; target_id uuid; target_role text; result jsonb;
begin
  select * into strict w from public.workspaces where id=p_workspace for update;
  if w.lifecycle_state<>'active' then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  select role into actor_role from public.workspace_members where workspace_id=p_workspace and user_id=p_actor;
  if actor_role is null or actor_role not in('owner','admin') then raise exception 'NR:FORBIDDEN'; end if;
  if p_target is null or length(p_target)>254 then raise exception 'NR:INVALID_SCOPE'; end if;
  if p_operation='add' then
    target_id=public.nexus_resolve_confirmed_member(trim(p_target));
  elsif p_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    target_id=p_target::uuid;
  end if;
  -- A bounded known-account add, not an invitation or public account directory.
  if target_id is null or not exists(select 1 from public.profiles where id=target_id)
    then raise exception 'NR:INVALID_SCOPE'; end if;
  select role into target_role from public.workspace_members where workspace_id=p_workspace and user_id=target_id;
  if target_id=p_actor or target_id=w.owner_id or target_role='owner'
    or (actor_role='admin' and (target_role='admin' or p_role='admin'))
    then raise exception 'NR:FORBIDDEN'; end if;
  if p_operation not in('add','update','remove') or p_operation is null
    or (p_operation<>'remove' and (p_role is null or p_role not in('admin','editor','viewer')))
    then raise exception 'NR:INVALID_SCOPE'; end if;
  if p_operation='add' then
    if target_role is not null then raise exception 'NR:VERSION_CONFLICT'; end if;
    if (select count(*) from public.workspace_members where workspace_id=p_workspace)>=100
      then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
    insert into public.workspace_members(workspace_id,user_id,role) values(p_workspace,target_id,p_role);
  elsif target_role is null then raise exception 'NR:INVALID_SCOPE';
  elsif p_operation='update' then
    update public.workspace_members set role=p_role where workspace_id=p_workspace and user_id=target_id;
  else
    delete from public.workspace_members where workspace_id=p_workspace and user_id=target_id;
    delete from public.finding_participants where workspace_id=p_workspace and user_id=target_id;
    delete from public.conversation_participants where workspace_id=p_workspace and user_id=target_id;
  end if;
  -- Existing membership_revision_changed trigger fences in-flight authority.
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(p_workspace,p_actor,'member.'||p_operation,'workspace_member',target_id::text,
      jsonb_build_object('previous_role',target_role,'role',case when p_operation='remove' then null else p_role end));
  if p_operation='remove' then
    return jsonb_build_object('success',true,'removed',1,'user_id',target_id);
  end if;
  select to_jsonb(m)||jsonb_build_object('display_name',p.display_name,'email',p.email)
    into result from public.workspace_members m join public.profiles p on p.id=m.user_id
    where m.workspace_id=p_workspace and m.user_id=target_id;
  return result;
end $$;

create or replace function public.nexus_management_version()
returns jsonb language sql set search_path = public, pg_temp as $$
  select jsonb_build_object('version','036','atomic_members',true,'private_findings',true,
    'manual_finding_exports',true,'authoritative_member_identity',true)
$$;
revoke all on function public.nexus_management_version() from public,anon,authenticated;
grant execute on function public.nexus_management_version() to service_role;
revoke all on function public.nexus_manage_member(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.nexus_manage_member(uuid,uuid,text,text,text) to service_role;
commit;
