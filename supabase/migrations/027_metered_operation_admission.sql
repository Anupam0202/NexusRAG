-- Preview candidate only. Apply after review and explicit Supabase schema authorization.
-- Service-only, fail-closed, transactionally locked global + workspace quota accounting.
begin;

create or replace function public.v6_reserve_budget(
  p_workspace uuid, p_provider text, p_dimension text, p_amount bigint,
  p_idempotency_key text, p_priority text default 'interactive'
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  existing public.budget_reservations%rowtype;
  b public.resource_budgets%rowtype;
  scope text;
  projected bigint;
  reservation uuid;
  denial text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  if p_workspace is null or p_provider is null or p_dimension is null
    or p_amount is null or p_amount < 1 or p_amount > 1000000000
    or p_idempotency_key is null or length(p_idempotency_key) < 1 or length(p_idempotency_key) > 160
    or p_priority is null or p_priority not in ('essential','interactive','background','speculative') then
    return jsonb_build_object('state','REVIEW_REQUIRED');
  end if;
  -- Serialize same-key replays, even before an initial reservation is inserted.
  perform pg_advisory_xact_lock(hashtextextended(p_workspace::text || ':' || p_idempotency_key, 0));
  select * into existing from public.budget_reservations
   where workspace_id=p_workspace and idempotency_key=p_idempotency_key for update;
  if found then
    if existing.provider_id<>p_provider or existing.dimension<>p_dimension or existing.amount<>p_amount then
      return jsonb_build_object('state','REVIEW_REQUIRED');
    end if;
    -- A live reservation must never authorize a replayed provider call. A timed-out
    -- client cannot tell whether the original metered operation already started;
    -- fail closed and leave the existing hold for explicit reconciliation.
    return jsonb_build_object('state',case when existing.state='RESERVED' then 'RESERVATION_IN_PROGRESS' else 'REVIEW_REQUIRED' end,
                              'reservation_id',existing.id,'replayed',true);
  end if;
  -- A provider must be registered and explicitly enabled. Unknown rights fail closed.
  if not exists (select 1 from public.provider_registry where id=p_provider and status in ('APPROVED','APPROVED_WITH_DUTIES'))
     or not exists (select 1 from public.workspace_provider_policies
                    where workspace_id=p_workspace and provider_id=p_provider
                      and status in ('APPROVED','APPROVED_WITH_DUTIES')) then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  for scope in select unnest(array['global','workspace:' || p_workspace::text]) loop
    select * into b from public.resource_budgets
      where scope_key=scope and provider_id=p_provider and dimension=p_dimension for update;
    if not found then return jsonb_build_object('state','REVIEW_REQUIRED'); end if;
    if b.state not in ('READY','DEGRADED','QUOTA_NEAR_LIMIT') then
      return jsonb_build_object('state',b.state,'reset_at',b.reset_at);
    end if;
    -- Never reset a window with pending reservations; reconcile before reset.
    if b.reset_at is not null and b.reset_at <= now() then
      if b.reserved > 0 then return jsonb_build_object('state','REVIEW_REQUIRED'); end if;
      return jsonb_build_object('state','TRY_AFTER_RESET'); -- operator must atomically open next verified window
    end if;
    projected := b.used + b.reserved + p_amount;
    if projected > b.hard_limit then
      return jsonb_build_object('state',case when b.reset_at > now() then 'TRY_AFTER_RESET' else 'QUOTA_EXHAUSTED' end,'reset_at',b.reset_at);
    end if;
    if projected >= b.hard_limit * 0.95 and p_priority <> 'essential' then
      return jsonb_build_object('state','CAPACITY_REACHED','reset_at',b.reset_at);
    end if;
    if projected >= b.hard_limit * 0.85 and p_priority in ('background','speculative') then
      return jsonb_build_object('state','DEGRADED','reset_at',b.reset_at);
    end if;
  end loop;
  insert into public.budget_reservations(workspace_id,provider_id,dimension,amount,idempotency_key,state,reset_at)
    values(p_workspace,p_provider,p_dimension,p_amount,p_idempotency_key,'RESERVED',b.reset_at) returning id into reservation;
  update public.resource_budgets set reserved=reserved+p_amount, revision=revision+1, updated_at=now()
    where scope_key in ('global','workspace:' || p_workspace::text) and provider_id=p_provider and dimension=p_dimension;
  return jsonb_build_object('state','READY','reservation_id',reservation,'replayed',false);
end
$fn$;

create or replace function public.v6_settle_budget(
  p_reservation uuid, p_measured bigint, p_provider_called boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare r public.budget_reservations%rowtype; next_state text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  select * into r from public.budget_reservations where id=p_reservation for update;
  if not found then return jsonb_build_object('state','REVIEW_REQUIRED'); end if;
  if r.state <> 'RESERVED' then return jsonb_build_object('state',r.state,'replayed',true); end if;
  -- Unknown usage must retain its reservation until reconciled; never free uncertain usage.
  if p_measured is null or p_measured < 0 or p_measured > r.amount then
    update public.budget_reservations set state='RECONCILIATION_REQUIRED' where id=r.id;
    return jsonb_build_object('state','RECONCILIATION_REQUIRED');
  end if;
  if p_provider_called is null then
    update public.budget_reservations set state='RECONCILIATION_REQUIRED' where id=r.id;
    return jsonb_build_object('state','RECONCILIATION_REQUIRED');
  end if;
  next_state := case when p_provider_called then 'SETTLED' else 'RELEASED' end;
  -- Lock both scope rows in stable order to prevent concurrent settlement races.
  perform 1 from public.resource_budgets
    where scope_key in ('global','workspace:' || r.workspace_id::text)
      and provider_id=r.provider_id and dimension=r.dimension
    order by scope_key for update;
  update public.resource_budgets
    set reserved=reserved-r.amount, used=used+case when p_provider_called then p_measured else 0 end,
        revision=revision+1, updated_at=now()
    where scope_key in ('global','workspace:' || r.workspace_id::text)
      and provider_id=r.provider_id and dimension=r.dimension;
  if (select count(*) from public.resource_budgets where scope_key in ('global','workspace:' || r.workspace_id::text)
      and provider_id=r.provider_id and dimension=r.dimension) <> 2 then
    raise exception 'NR:MIGRATION_REQUIRED quota budget scope disappeared';
  end if;
  update public.budget_reservations set state=next_state, measured=case when p_provider_called then p_measured else 0 end,
    settled_at=now() where id=r.id;
  return jsonb_build_object('state',next_state);
end
$fn$;

revoke execute on function public.v6_reserve_budget(uuid,text,text,bigint,text,text) from public, anon, authenticated;
revoke execute on function public.v6_settle_budget(uuid,bigint,boolean) from public, anon, authenticated;
grant execute on function public.v6_reserve_budget(uuid,text,text,bigint,text,text) to service_role;
grant execute on function public.v6_settle_budget(uuid,bigint,boolean) to service_role;
-- One roundtrip reserves every dimension; partial denial releases all earlier dimensions.
create or replace function public.v6_reserve_many(
  p_workspace uuid, p_provider text, p_dimensions jsonb, p_idempotency_key text,
  p_priority text default 'interactive'
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare item record; admission jsonb; reservations jsonb := '[]'::jsonb; prior jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  if p_dimensions is null or jsonb_typeof(p_dimensions) <> 'object'
     or (select count(*) from jsonb_object_keys(p_dimensions)) not between 1 and 4
     or p_idempotency_key is null or length(p_idempotency_key) < 1 or length(p_idempotency_key) > 100 then
    return jsonb_build_object('state','REVIEW_REQUIRED');
  end if;
  -- Validate the entire request before making any durable reservation.
  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    if item.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(item.value) <> 'number'
       or item.value::text !~ '^[0-9]{1,10}$' then
      return jsonb_build_object('state','REVIEW_REQUIRED');
    end if;
  end loop;
  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    admission := public.v6_reserve_budget(p_workspace,p_provider,item.key,item.value::bigint,
                                           p_idempotency_key || ':' || item.key,p_priority);
    if admission->>'state' not in ('READY','QUOTA_NEAR_LIMIT') then
      for prior in select value from jsonb_array_elements(reservations) loop
        perform public.v6_settle_budget((prior->>'id')::uuid,0,false);
      end loop;
      return jsonb_build_object('state',coalesce(admission->>'state','REVIEW_REQUIRED'),
                                'reset_at',admission->'reset_at');
    end if;
    reservations := reservations || jsonb_build_array(jsonb_build_object('id',admission->>'reservation_id',
                                                                         'amount',item.value::bigint));
  end loop;
  return jsonb_build_object('state','READY','reservations',reservations);
end
$fn$;

create or replace function public.v6_settle_many(p_reservations jsonb, p_provider_called boolean)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare item record; outcome jsonb;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  if p_reservations is null or jsonb_typeof(p_reservations) <> 'array'
     or jsonb_array_length(p_reservations) < 1 or jsonb_array_length(p_reservations) > 4
     or p_provider_called is null then
    return jsonb_build_object('state','REVIEW_REQUIRED');
  end if;
  for item in select value from jsonb_array_elements(p_reservations) order by value->>'id' loop
    if jsonb_typeof(item.value->'amount') <> 'number' then
      raise exception 'NR:REVIEW_REQUIRED invalid quota settlement payload';
    end if;
    outcome := public.v6_settle_budget((item.value->>'id')::uuid,
      case when p_provider_called then (item.value->>'amount')::bigint else 0 end,p_provider_called);
    if outcome->>'state' not in ('SETTLED','RELEASED') then
      raise exception 'NR:REVIEW_REQUIRED quota settlement unresolved';
    end if;
  end loop;
  return jsonb_build_object('state',case when p_provider_called then 'SETTLED' else 'RELEASED' end);
end
$fn$;

revoke execute on function public.v6_reserve_many(uuid,text,jsonb,text,text) from public, anon, authenticated;
revoke execute on function public.v6_settle_many(jsonb,boolean) from public, anon, authenticated;
grant execute on function public.v6_reserve_many(uuid,text,jsonb,text,text) to service_role;
grant execute on function public.v6_settle_many(jsonb,boolean) to service_role;
commit;
