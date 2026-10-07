-- Forward migration only. Never rewrite/replay an applied baseline.
-- Service-only functions derive actors from the gateway's validated Auth identity.
begin;

create or replace function public.nexus_create_workspace(
  p_actor uuid, p_name text, p_slug text, p_key text
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare w public.workspaces%rowtype; m public.workbench_mutations%rowtype; h text; result jsonb;
begin
  if p_actor is null or not exists(select 1 from auth.users where id=p_actor)
    or length(trim(p_name)) not between 2 and 100 or p_name is null
    or p_slug is null or p_slug !~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'
    or p_key is null or length(p_key) not between 1 and 128 then
    raise exception 'NR:INVALID_SCOPE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nexus:create:'||p_actor::text, 0));
  h=encode(sha256(convert_to(jsonb_build_object('name',trim(p_name),'slug',p_slug)::text,'UTF8')),'hex');
  select * into m from public.workbench_mutations where actor_id=p_actor
    and operation='workspace.create' and idempotency_key=p_key;
  if found then
    if m.payload_hash<>h then raise exception 'NR:VERSION_CONFLICT'; end if;
    if not exists(select 1 from public.workspaces where id=m.workspace_id and lifecycle_state='active')
      then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
    return m.response;
  end if;
  if (select count(*) from public.workspaces where owner_id=p_actor and lifecycle_state<>'deleted')>=10
    then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  if exists(select 1 from public.workspaces where slug=p_slug) then raise exception 'NR:VERSION_CONFLICT'; end if;
  insert into public.workspaces(name,slug,owner_id,plan) values(trim(p_name),p_slug,p_actor,'free') returning * into w;
  insert into public.workspace_members(workspace_id,user_id,role) values(w.id,p_actor,'owner');
  insert into public.workspace_settings(workspace_id) values(w.id);
  result=to_jsonb(w)||jsonb_build_object('workspace_id',w.id,'role','owner');
  insert into public.workbench_mutations(workspace_id,actor_id,operation,idempotency_key,payload_hash,response)
    values(w.id,p_actor,'workspace.create',p_key,h,result);
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(w.id,p_actor,'workspace.create','workspace',w.id::text,'{}');
  return result;
end $$;

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
  if p_target ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    target_id=p_target::uuid;
  elsif p_operation='add' then
    select id into target_id from public.profiles where lower(email)=lower(trim(p_target));
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

create or replace function public.nexus_finding(
  p_context jsonb, p_operation text, p_id uuid, p_command jsonb,
  p_revision bigint, p_key text, p_hash text
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare role_name text; result jsonb; ws uuid=(p_context->>'workspace_id')::uuid; actor uuid=(p_context->>'user_id')::uuid;
begin
  -- Membership mutations take the same lock. A cached gateway role can never
  -- authorize a write after concurrent demotion/removal.
  perform 1 from public.workspaces where id=ws for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=ws and user_id=actor;
  if p_operation not in('read','versions') and (role_name is null or role_name not in('editor','admin','owner'))
    then raise exception 'NR:FORBIDDEN'; end if;
  result=public.workbench_finding(p_context,p_operation,p_id,p_command,p_revision,p_key,p_hash);
  if p_operation not in('read','versions') then
    insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      values(ws,actor,'finding.'||p_operation,'finding',coalesce(p_id::text,result->>'id'),
        jsonb_build_object('revision',result->'revision'));
  end if;
  return result;
end $$;

create or replace function public.nexus_record_finding_export(
  p_context jsonb, p_finding uuid, p_revision bigint, p_manifest_text text, p_hash text
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare f jsonb; manifest jsonb; receipt public.evidence_exports%rowtype; role_name text;
begin
  perform 1 from public.workspaces where id=(p_context->>'workspace_id')::uuid for update;
  perform public.workbench_authorize(p_context,'read');
  select role into role_name from public.workspace_members where workspace_id=(p_context->>'workspace_id')::uuid
    and user_id=(p_context->>'user_id')::uuid;
  if role_name not in('editor','admin','owner') or role_name is null then raise exception 'NR:FORBIDDEN'; end if;
  -- Serialize with edits/deletes, then authorize the exact current record.
  perform 1 from public.findings where workspace_id=(p_context->>'workspace_id')::uuid and id=p_finding for update;
  f=public.workbench_finding(p_context,'read',p_finding,'{}',null,null,null);
  if (f->>'revision')::bigint is distinct from p_revision then raise exception 'NR:VERSION_CONFLICT'; end if;
  if f->>'source_run_id' is not null then raise exception 'NR:RIGHTS_BLOCKED'; end if;
  if p_manifest_text is null or octet_length(p_manifest_text)>100000
    or encode(sha256(convert_to(p_manifest_text,'UTF8')),'hex') is distinct from p_hash then raise exception 'NR:INVALID_SCOPE'; end if;
  manifest=p_manifest_text::jsonb;
  if manifest->>'finding_id' is distinct from p_finding::text
    or manifest->>'workspace_id' is distinct from p_context->>'workspace_id'
    or (manifest->>'revision')::bigint is distinct from p_revision
    or manifest->>'title' is distinct from f->>'title'
    or manifest->>'authored_markdown' is distinct from f->>'authored_markdown'
    or manifest->'reviews' is distinct from f->'reviews'
    or manifest->'evidence' is distinct from f->'evidence'
    then raise exception 'NR:VERSION_CONFLICT'; end if;
  insert into public.evidence_exports(workspace_id,requested_by,format,state,manifest_hash)
    values((p_context->>'workspace_id')::uuid,(p_context->>'user_id')::uuid,'JSON_LD','ready',p_hash) returning * into receipt;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(receipt.workspace_id,receipt.requested_by,'finding.export','finding',p_finding::text,
      jsonb_build_object('revision',p_revision,'manifest_hash',p_hash,'export_id',receipt.id));
  return to_jsonb(receipt);
end $$;

revoke all on function public.nexus_create_workspace(uuid,text,text,text) from public,anon,authenticated;
create or replace function public.nexus_management_version()
returns jsonb language sql set search_path = public, pg_temp as $$
  select jsonb_build_object('version','035','atomic_members',true,'private_findings',true,'manual_finding_exports',true)
$$;
revoke all on function public.nexus_management_version() from public,anon,authenticated;
grant execute on function public.nexus_management_version() to service_role;
revoke all on function public.nexus_manage_member(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) from public,anon,authenticated;
revoke all on function public.nexus_record_finding_export(jsonb,uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.nexus_create_workspace(uuid,text,text,text) to service_role;
grant execute on function public.nexus_manage_member(uuid,uuid,text,text,text) to service_role;
grant execute on function public.nexus_finding(jsonb,text,uuid,jsonb,bigint,text,text) to service_role;
grant execute on function public.nexus_record_finding_export(jsonb,uuid,bigint,text,text) to service_role;
commit;