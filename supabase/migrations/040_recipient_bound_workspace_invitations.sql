-- Forward-only, service-mediated invitations. No email service or public token URL.
-- Raw one-time codes are never stored; only SHA-256 hashes are persisted.
begin;
create table public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  recipient_email text not null check (recipient_email=lower(trim(recipient_email)) and length(recipient_email) between 3 and 254),
  role text not null check (role in ('admin','editor','viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 128),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending','accepted','revoked','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '7 days'),
  accepted_by uuid references auth.users(id),
  completed_at timestamptz,
  unique(workspace_id,created_by,idempotency_key)
);
create unique index workspace_invitations_pending_recipient_idx on public.workspace_invitations(workspace_id,recipient_email) where state='pending';
create index workspace_invitations_workspace_state_idx on public.workspace_invitations(workspace_id,state,id);
alter table public.workspace_invitations enable row level security;
create policy workspace_invitations_browser_deny on public.workspace_invitations for all to anon,authenticated using(false) with check(false);
revoke all on public.workspace_invitations from public,anon,authenticated,service_role;

create function public.nexus_workspace_invitation(
  p_workspace uuid,p_actor uuid,p_operation text,p_invitation uuid default null,p_command jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare w public.workspaces%rowtype; actor_role text; i public.workspace_invitations%rowtype;
  target_email text; h text; amount bigint; items jsonb; limit_size integer; cursor_id uuid; observed_at timestamptz;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  select * into w from public.workspaces where id=p_workspace for update;
  if not found or w.lifecycle_state<>'active' then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  select role into actor_role from public.workspace_members where workspace_id=p_workspace and user_id=p_actor;
  if actor_role is null or actor_role not in('owner','admin') then raise exception 'NR:FORBIDDEN'; end if;
  if p_operation not in('create','revoke','list') or p_operation is null or p_command is null
    or jsonb_typeof(p_command)<>'object' then raise exception 'NR:INVALID_SCOPE'; end if;
  if p_operation='list' then
    if p_command - array['limit','after'] <> '{}'::jsonb then raise exception 'NR:INVALID_SCOPE'; end if;
    limit_size=coalesce((p_command->>'limit')::integer,50);
    cursor_id=(p_command->>'after')::uuid;
    if limit_size not between 1 and 100 then raise exception 'NR:INVALID_SCOPE'; end if;
    observed_at=clock_timestamp();
    select count(*) into amount from public.workspace_invitations where workspace_id=p_workspace and state='pending' and expires_at>observed_at;
    select coalesce(jsonb_agg(to_jsonb(page)-array['token_hash','payload_hash','idempotency_key']), '[]'::jsonb) into items
      from (select * from public.workspace_invitations where workspace_id=p_workspace and state='pending' and expires_at>observed_at
        and (cursor_id is null or id>cursor_id) order by id limit limit_size+1) page;
    return jsonb_build_object('workspace_id',p_workspace,'invitations',case when jsonb_array_length(items)>limit_size then items- limit_size else items end,
      'total',amount,'total_is_exact',true,'next_after',case when jsonb_array_length(items)>limit_size then items->(limit_size-1)->>'id' else null end,
      'delivery','MANUAL_ONE_TIME_CODE','schema_version','040');
  elsif p_operation='revoke' then
    if p_command<>'{}'::jsonb then raise exception 'NR:INVALID_SCOPE'; end if;
    select * into i from public.workspace_invitations where id=p_invitation and workspace_id=p_workspace for update;
    if not found then raise exception 'NR:INVALID_SCOPE'; end if;
    if actor_role='admin' and i.role='admin' then raise exception 'NR:FORBIDDEN'; end if;
    if i.state='accepted' then raise exception 'NR:VERSION_CONFLICT'; end if;
    if i.state='pending' then
      update public.workspace_invitations set state='revoked',completed_at=clock_timestamp() where id=i.id;
      insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
        values(p_workspace,p_actor,'invitation.revoke','workspace_invitation',i.id::text,'{}');
    end if;
    return jsonb_build_object('success',true,'id',i.id,'schema_version','040');
  end if;
  if p_command - array['recipient_email','role','token_hash','idempotency_key'] <> '{}'::jsonb then raise exception 'NR:INVALID_SCOPE'; end if;
  target_email=lower(trim(p_command->>'recipient_email'));
  if target_email is null or length(target_email) not between 3 and 254 or target_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_command->>'role' is null or p_command->>'role' not in('admin','editor','viewer')
    or p_command->>'token_hash' is null or p_command->>'token_hash' !~ '^[0-9a-f]{64}$'
    or p_command->>'idempotency_key' is null or length(p_command->>'idempotency_key') not between 1 and 128
    then raise exception 'NR:INVALID_SCOPE'; end if;
  if actor_role='admin' and p_command->>'role'='admin' then raise exception 'NR:FORBIDDEN'; end if;
  if exists(select 1 from auth.users where id=p_actor and lower(email)=target_email)
    then raise exception 'NR:FORBIDDEN'; end if;
  h=encode(sha256(convert_to(jsonb_build_object('email',target_email,'role',p_command->>'role','token_hash',p_command->>'token_hash')::text,'UTF8')),'hex');
  select * into i from public.workspace_invitations where workspace_id=p_workspace and created_by=p_actor and idempotency_key=p_command->>'idempotency_key';
  if found then
    if i.payload_hash<>h then raise exception 'NR:VERSION_CONFLICT'; end if;
    return (to_jsonb(i)-array['token_hash','payload_hash','idempotency_key'])||jsonb_build_object('schema_version','040','delivery','MANUAL_ONE_TIME_CODE');
  end if;
  with expired as (
    update public.workspace_invitations set state='expired',completed_at=clock_timestamp()
      where workspace_id=p_workspace and state='pending' and expires_at<=clock_timestamp() returning id
  ) insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
      select p_workspace,p_actor,'invitation.expire','workspace_invitation',id::text,'{}' from expired;
  if exists(select 1 from public.workspace_invitations where workspace_id=p_workspace and recipient_email=target_email and state='pending') then raise exception 'NR:VERSION_CONFLICT'; end if;
  if exists(select 1 from public.workspace_members m join auth.users u on u.id=m.user_id where m.workspace_id=p_workspace and lower(u.email)=target_email and u.email_confirmed_at is not null)
    then raise exception 'NR:VERSION_CONFLICT'; end if;
  if (select count(*) from public.workspace_invitations where workspace_id=p_workspace and state='pending')>=50
    then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  insert into public.workspace_invitations(workspace_id,created_by,recipient_email,role,token_hash,idempotency_key,payload_hash)
    values(p_workspace,p_actor,target_email,p_command->>'role',p_command->>'token_hash',p_command->>'idempotency_key',h) returning * into i;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(p_workspace,p_actor,'invitation.create','workspace_invitation',i.id::text,jsonb_build_object('role',i.role,'delivery','MANUAL_ONE_TIME_CODE'));
  return (to_jsonb(i)-array['token_hash','payload_hash','idempotency_key'])||jsonb_build_object('schema_version','040','delivery','MANUAL_ONE_TIME_CODE');
end $$;

create function public.nexus_accept_workspace_invitation(p_actor uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare i public.workspace_invitations%rowtype; w public.workspaces%rowtype; recipient auth.users%rowtype; issuer_role text; member_role text;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'NR:AUTH_REQUIRED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into i from public.workspace_invitations where token_hash=p_token_hash;
  if not found then raise exception 'NR:INVALID_SCOPE'; end if;
  -- Same workspace lock/order as membership writes serializes revoke/demotion/accept.
  select * into w from public.workspaces where id=i.workspace_id for update;
  if not found or w.lifecycle_state<>'active' then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  select * into i from public.workspace_invitations where id=i.id for update;
  select * into recipient from auth.users where id=p_actor;
  if not found or recipient.email_confirmed_at is null or lower(recipient.email) is distinct from i.recipient_email then raise exception 'NR:FORBIDDEN'; end if;
  select role into member_role from public.workspace_members where workspace_id=w.id and user_id=p_actor;
  if i.state='accepted' and i.accepted_by=p_actor and member_role is not null then
    return jsonb_build_object('workspace_id',w.id,'role',member_role,'schema_version','040','accepted',true);
  end if;
  if i.state<>'pending' or i.expires_at<=clock_timestamp() then raise exception 'NR:VERSION_CONFLICT'; end if;
  select role into issuer_role from public.workspace_members where workspace_id=w.id and user_id=i.created_by;
  if issuer_role is null or issuer_role not in('owner','admin') or (issuer_role='admin' and i.role='admin') then raise exception 'NR:FORBIDDEN'; end if;
  if p_actor=i.created_by or p_actor=w.owner_id or member_role is not null then raise exception 'NR:VERSION_CONFLICT'; end if;
  if (select count(*) from public.workspace_members where workspace_id=w.id)>=100 then raise exception 'NR:TENANT_QUOTA_EXCEEDED'; end if;
  insert into public.profiles(id,email) values(p_actor,recipient.email) on conflict(id) do nothing;
  insert into public.workspace_members(workspace_id,user_id,role) values(w.id,p_actor,i.role);
  update public.workspace_invitations set state='accepted',accepted_by=p_actor,completed_at=clock_timestamp() where id=i.id;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,resource_id,metadata)
    values(w.id,p_actor,'invitation.accept','workspace_invitation',i.id::text,jsonb_build_object('role',i.role,'created_by',i.created_by));
  return jsonb_build_object('workspace_id',w.id,'role',i.role,'schema_version','040','accepted',true);
end $$;

create function public.nexus_invitation_version() returns jsonb language sql set search_path=pg_catalog,public,pg_temp as $$
 select jsonb_build_object('version','040','recipient_bound',true,'manual_delivery',true)
$$;
revoke all on function public.nexus_workspace_invitation(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.nexus_accept_workspace_invitation(uuid,text) from public,anon,authenticated;
revoke all on function public.nexus_invitation_version() from public,anon,authenticated;
grant execute on function public.nexus_workspace_invitation(uuid,uuid,text,uuid,jsonb) to service_role;
grant execute on function public.nexus_accept_workspace_invitation(uuid,text) to service_role;
grant execute on function public.nexus_invitation_version() to service_role;
commit;
