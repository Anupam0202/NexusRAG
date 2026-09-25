-- Record affirmative BYOK billing consent and never report unknown provider spend as zero.
begin;

alter table public.nexus_user_provider_keys
  add column if not exists cost_consent_at timestamptz;

alter table public.llm_usage_events
  alter column cost_microusd drop not null,
  alter column cost_microusd drop default;

alter table public.workspace_usage_daily
  alter column estimated_cost_microusd drop not null,
  alter column estimated_cost_microusd drop default;

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
      and cost_consent_at is not null
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
    where user_id=p_user and provider='gemini' and is_active
      and cost_consent_at is not null) into has_key;
  return jsonb_build_object('free_chat_queries_used',coalesce(usage_row.free_chat_queries,0),
    'free_chat_queries_limit',5,'lifetime_documents_used',coalesce(usage_row.lifetime_documents,0),
    'lifetime_documents_limit',10,'gemini_key_configured',has_key);
end
$fn$;

create or replace function public.reconcile_workspace_usage(
  p_workspace_id uuid, p_usage_date date default null
) returns setof public.workspace_usage_daily
language plpgsql
set search_path=public,pg_temp
as $function$
declare
  target_date date := coalesce(p_usage_date, current_date);
begin
  insert into public.workspace_usage_daily (
    workspace_id, usage_date, query_count, input_tokens, output_tokens,
    total_tokens, successful_calls, failed_calls, estimated_cost_microusd, reconciled_at
  )
  select
    p_workspace_id,
    target_date,
    count(*),
    coalesce(sum(input_tokens), 0),
    coalesce(sum(output_tokens), 0),
    coalesce(sum(input_tokens), 0) + coalesce(sum(output_tokens), 0),
    count(*) filter (where success),
    count(*) filter (where not success),
    case
      when count(*) = 0 then 0
      when count(cost_microusd) = count(*) then sum(cost_microusd)
      else null
    end,
    now()
  from public.llm_usage_events
  where workspace_id = p_workspace_id
    and created_at >= target_date::timestamptz
    and created_at < (target_date + 1)::timestamptz
  on conflict (workspace_id, usage_date) do update set
    query_count = excluded.query_count,
    input_tokens = excluded.input_tokens,
    output_tokens = excluded.output_tokens,
    total_tokens = excluded.total_tokens,
    successful_calls = excluded.successful_calls,
    failed_calls = excluded.failed_calls,
    estimated_cost_microusd = excluded.estimated_cost_microusd,
    reconciled_at = excluded.reconciled_at;

  return query
  select *
  from public.workspace_usage_daily
  where workspace_id = p_workspace_id
    and usage_date = target_date;
end;
$function$;

commit;