-- Per-authenticated-account free trial limits and encrypted Gemini BYOK vault.
-- All mutations are service-role-only and enforced in a single transaction.
begin;

create table if not exists public.nexus_account_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  free_chat_queries integer not null default 0 check (free_chat_queries between 0 and 5),
  lifetime_documents integer not null default 0 check (lifetime_documents between 0 and 10),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.nexus_user_provider_keys (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'gemini'),
  ciphertext text,
  nonce text,
  key_fingerprint text,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, provider),
  check (
    (is_active and ciphertext is not null and nonce is not null and key_fingerprint is not null)
    or (not is_active and ciphertext is null and nonce is null and key_fingerprint is null)
  )
);

create table if not exists public.nexus_account_operations (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null check (operation in ('chat', 'document')),
  idempotency_key uuid not null,
  outcome jsonb not null check (jsonb_typeof(outcome) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, operation, idempotency_key)
);
create index if not exists nexus_account_operations_created_at_idx
  on public.nexus_account_operations(created_at);

alter table public.nexus_account_usage enable row level security;
alter table public.nexus_user_provider_keys enable row level security;
alter table public.nexus_account_operations enable row level security;
revoke all on public.nexus_account_usage, public.nexus_user_provider_keys,
  public.nexus_account_operations from public, anon, authenticated;
grant select, insert, update, delete on public.nexus_account_usage,
  public.nexus_user_provider_keys, public.nexus_account_operations to service_role;

create or replace function public.nexus_admit_account_operation(
  p_user uuid, p_operation text, p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  usage_row public.nexus_account_usage%rowtype;
  prior public.nexus_account_operations%rowtype;
  has_key boolean;
  result jsonb;
  mode text := 'none';
  state text := 'READY';
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role'
     or p_user is null or p_operation is null or p_operation not in ('chat','document') or p_idempotency_key is null then
    raise exception 'NR:INVALID_SCOPE';
  end if;
  insert into public.nexus_account_usage(user_id) values (p_user)
    on conflict (user_id) do nothing;
  select * into strict usage_row from public.nexus_account_usage
    where user_id=p_user for update;
  delete from public.nexus_account_operations
    where user_id=p_user and created_at < clock_timestamp()-interval '24 hours';

  select * into prior from public.nexus_account_operations
    where user_id=p_user and operation=p_operation and idempotency_key=p_idempotency_key;
  if found then return prior.outcome || jsonb_build_object('replayed',true); end if;

  select exists(
    select 1 from public.nexus_user_provider_keys
    where user_id=p_user and provider='gemini' and is_active
      and ciphertext is not null and nonce is not null
  ) into has_key;

  if p_operation='chat' then
    if usage_row.free_chat_queries < 5 then
      update public.nexus_account_usage
        set free_chat_queries=free_chat_queries+1, updated_at=clock_timestamp()
        where user_id=p_user returning * into usage_row;
      mode := 'platform_trial';
    elsif has_key then
      mode := 'user_byok';
    else
      state := 'BYOK_REQUIRED';
    end if;
    result := jsonb_build_object('state',state,'operation',p_operation,
      'used',usage_row.free_chat_queries,'limit',5,'credential_mode',mode);
  else
    if usage_row.lifetime_documents >= 10 then
      state := 'CAPACITY_REACHED';
    elsif usage_row.lifetime_documents = 0 then
      update public.nexus_account_usage
        set lifetime_documents=lifetime_documents+1, updated_at=clock_timestamp()
        where user_id=p_user returning * into usage_row;
      mode := 'platform_trial';
    elsif has_key then
      update public.nexus_account_usage
        set lifetime_documents=lifetime_documents+1, updated_at=clock_timestamp()
        where user_id=p_user returning * into usage_row;
      mode := 'user_byok';
    else
      state := 'BYOK_REQUIRED';
    end if;
    result := jsonb_build_object('state',state,'operation',p_operation,
      'used',usage_row.lifetime_documents,'limit',10,'credential_mode',mode);
  end if;

  insert into public.nexus_account_operations(user_id,operation,idempotency_key,outcome)
    values (p_user,p_operation,p_idempotency_key,result);
  return result;
end
$fn$;

create or replace function public.nexus_account_entitlement_status(p_user uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $fn$
declare
  usage_row public.nexus_account_usage%rowtype;
  has_key boolean;
begin
  if coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role'
     or p_user is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select * into usage_row from public.nexus_account_usage where user_id=p_user;
  select exists(select 1 from public.nexus_user_provider_keys
    where user_id=p_user and provider='gemini' and is_active) into has_key;
  return jsonb_build_object('free_chat_queries_used',coalesce(usage_row.free_chat_queries,0),
    'free_chat_queries_limit',5,'lifetime_documents_used',coalesce(usage_row.lifetime_documents,0),
    'lifetime_documents_limit',10,'gemini_key_configured',has_key);
end
$fn$;

revoke execute on function public.nexus_admit_account_operation(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.nexus_account_entitlement_status(uuid) from public,anon,authenticated;
grant execute on function public.nexus_admit_account_operation(uuid,text,uuid) to service_role;
grant execute on function public.nexus_account_entitlement_status(uuid) to service_role;
commit;