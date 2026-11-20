-- Erasure never waits on the operator's provider review (NX-50).
--
-- Every metered provider call reserves budget first, and the reservation refused any provider whose terms review
-- was not current. Removing a document's search index entries is metered too, so on a deployment without a current
-- Qdrant review (before its first review, or from the day a review lapses) no document deletion could finish, and
-- the documents people had deleted stayed stored: on production, a document marked for deletion on 23 September was
-- still stored on 20 November, its deletion retried every five minutes and refused with PROVIDER_REVIEW_REQUIRED.
-- The same held for retention runs and for the documents account deletion removes. The review decides what may be
-- sent to a provider; it must never keep data there.
--
-- After it, v6_reserve_many admits the action 'erasure' for the providers that hold the service's data (Qdrant and
-- Supabase Storage) without a current review, within the same budgets. Gemini is never erasure, every other action
-- still needs a current review (and Gemini the owner's approval), and only v6_reserve_many can ask for erasure:
-- nexus_reserve_budget, which holds the reservation itself, is closed to every client role and to the gateway.

create or replace function public.nexus_reserve_budget(
  p_workspace uuid, p_provider text, p_dimension text, p_amount bigint,
  p_idempotency_key text, p_priority text, p_erasure boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  existing public.budget_reservations%rowtype;
  b public.resource_budgets%rowtype;
  scope text;
  projected bigint;
  reservation uuid;
  global_window timestamptz;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
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
  -- The operator must have a current review of the provider, and where the provider needs it, the
  -- workspace owner must have approved. Unknown providers and missing approvals fail closed. Erasure at a
  -- provider that holds the service's data needs neither: it sends nothing new and removes what is there.
  if p_erasure is not true or p_provider not in ('qdrant','supabase_storage') then
    if not public.nexus_provider_rights_current(p_provider) then
      return jsonb_build_object('state','RIGHTS_BLOCKED','reason','PROVIDER_REVIEW_REQUIRED');
    end if;
    if (select requires_workspace_approval from public.provider_registry where id=p_provider)
       and not public.nexus_workspace_approval_current(p_workspace, p_provider) then
      return jsonb_build_object('state','RIGHTS_BLOCKED','reason','WORKSPACE_APPROVAL_REQUIRED');
    end if;
  end if;
  for scope in select unnest(array['global','workspace:' || p_workspace::text]) loop
    b := public.nexus_open_budget_window(scope, case when scope='global' then null else p_workspace end, p_provider, p_dimension);
    if b.scope_key is null then return jsonb_build_object('state','REVIEW_REQUIRED','reason','BUDGET_NOT_CONFIGURED'); end if;
    if scope='global' then global_window := b.reset_at; end if;
    if b.state not in ('READY','DEGRADED','QUOTA_NEAR_LIMIT') then
      return jsonb_build_object('state',b.state,'reset_at',b.reset_at);
    end if;
    -- Only windows that are not daily can still be past their reset here; they need an operator.
    if b.reset_at is not null and b.reset_at <= now() then
      return jsonb_build_object('state',case when b.reserved > 0 then 'REVIEW_REQUIRED' else 'TRY_AFTER_RESET' end);
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
  insert into public.budget_reservations(workspace_id,provider_id,dimension,amount,idempotency_key,state,reset_at,global_reset_at)
    values(p_workspace,p_provider,p_dimension,p_amount,p_idempotency_key,'RESERVED',b.reset_at,global_window) returning id into reservation;
  update public.resource_budgets set reserved=reserved+p_amount, revision=revision+1, updated_at=now()
    where scope_key in ('global','workspace:' || p_workspace::text) and provider_id=p_provider and dimension=p_dimension;
  return jsonb_build_object('state','READY','reservation_id',reservation,'replayed',false);
end
$fn$;
revoke all on function public.nexus_reserve_budget(uuid, text, text, bigint, text, text, boolean)
  from public, anon, authenticated, service_role;

-- Unchanged for its callers: every reservation it makes needs a current review.
create or replace function public.v6_reserve_budget(
  p_workspace uuid, p_provider text, p_dimension text, p_amount bigint,
  p_idempotency_key text, p_priority text default 'interactive'
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  return public.nexus_reserve_budget(p_workspace, p_provider, p_dimension, p_amount, p_idempotency_key, p_priority, false);
end
$fn$;

create or replace function public.v6_reserve_many(
  p_workspace uuid,
  p_provider text,
  p_dimensions jsonb,
  p_idempotency_key text,
  p_priority text,
  p_action text,
  p_data_classification text
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  item record;
  admission jsonb;
  reservations jsonb := '[]'::jsonb;
  prior jsonb;
  erasure constant boolean := p_action is not distinct from 'erasure';
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  if p_dimensions is null or jsonb_typeof(p_dimensions) <> 'object'
     or (select count(*) from jsonb_object_keys(p_dimensions)) not between 1 and 4
     or p_idempotency_key is null or length(p_idempotency_key) < 1 or length(p_idempotency_key) > 100
     or p_priority is null or p_priority not in ('essential','interactive','background','speculative') then
    return jsonb_build_object('state','REVIEW_REQUIRED');
  end if;
  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    if item.key !~ '^[a-z_]{1,40}$' or jsonb_typeof(item.value) <> 'number'
       or item.value::text !~ '^[0-9]{1,10}$' then
      return jsonb_build_object('state','REVIEW_REQUIRED');
    end if;
  end loop;

  -- Erasure exists only at the providers that hold the service's data.
  if erasure and p_provider not in ('qdrant','supabase_storage') then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','ACTION_NOT_ALLOWED');
  end if;
  if p_provider = 'gemini' then
    if p_action is distinct from 'gemini_non_sensitive'
       or p_data_classification is distinct from 'non_sensitive' then
      return jsonb_build_object('state','RIGHTS_BLOCKED','reason','ACTION_NOT_ALLOWED');
    end if;
    -- Do not infer approval from public plan limits or a user's upload checkbox: the operator's review
    -- and the owner's approval of exactly this action must both be current.
    if not public.nexus_provider_rights_current('gemini') then
      return jsonb_build_object('state','RIGHTS_BLOCKED','reason','PROVIDER_REVIEW_REQUIRED');
    end if;
    if not public.nexus_workspace_approval_current(p_workspace, 'gemini', 'gemini_non_sensitive') then
      return jsonb_build_object('state','RIGHTS_BLOCKED','reason','WORKSPACE_APPROVAL_REQUIRED');
    end if;
  end if;

  for item in select key, value from jsonb_each(p_dimensions) order by key loop
    admission := public.nexus_reserve_budget(
      p_workspace,p_provider,item.key,item.value::bigint,
      p_idempotency_key || ':' || item.key,p_priority,erasure
    );
    if admission->>'state' not in ('READY','QUOTA_NEAR_LIMIT') then
      for prior in select value from jsonb_array_elements(reservations) loop
        perform public.v6_settle_budget((prior->>'id')::uuid,0,false);
      end loop;
      return jsonb_strip_nulls(jsonb_build_object('state',coalesce(admission->>'state','REVIEW_REQUIRED'),
                                'reset_at',admission->'reset_at','reason',admission->'reason','dimension',item.key));
    end if;
    reservations := reservations || jsonb_build_array(jsonb_build_object(
      'id',admission->>'reservation_id','amount',item.value::bigint
    ));
  end loop;
  return jsonb_build_object('state','READY','reservations',reservations);
end
$fn$;
