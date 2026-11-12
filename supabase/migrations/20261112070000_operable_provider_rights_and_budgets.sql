-- Makes provider approval and quota budgets work without manual SQL.
--
-- Before this migration a real database could never process a document or answer a question: nothing created
-- the provider records or the budget rows that every metered call requires, daily budget windows never
-- opened again once they ended, the operator's terms review and every owner's approval silently expired
-- after 30 days, and Qdrant and Storage needed a workspace approval that no code could record.
--
-- After it:
--   * The operator records a terms review with nexus_record_provider_review. It stays valid for 365 days.
--   * A workspace owner approves Gemini processing once. The approval stays valid until the operator records
--     different terms, the owner revokes it, or that person stops being an owner. Qdrant and Storage are the
--     service's own infrastructure and need only the operator's review.
--   * Budget rows are created from provider_budget_defaults when first needed, and a daily window that has
--     ended opens again automatically. Reservations left open in a finished window are closed with it.
-- Nothing is approved by this file: provider rows are added with status UNKNOWN.

alter table public.provider_registry
  add column if not exists requires_workspace_approval boolean not null default true;

insert into public.provider_registry (id, display_name, authority, documentation_url, terms_url, status, requires_workspace_approval)
values
  ('gemini', 'Google Gemini API', 'Google LLC', 'https://ai.google.dev/gemini-api/docs',
   'https://ai.google.dev/gemini-api/terms', 'UNKNOWN', true),
  ('qdrant', 'Qdrant Cloud', 'Qdrant Solutions GmbH', 'https://qdrant.tech/documentation/',
   'https://qdrant.tech/legal/terms_and_conditions/', 'UNKNOWN', false),
  ('supabase_storage', 'Supabase Storage', 'Supabase Inc.', 'https://supabase.com/docs/guides/storage',
   'https://supabase.com/terms', 'UNKNOWN', false)
on conflict (id) do update set requires_workspace_approval = excluded.requires_workspace_approval;

-- Daily limits in the units the gateway reserves (it reserves bytes for text, so these are upper bounds, not
-- provider token counts). Workspace limits apply to each workspace, global limits to the whole deployment.
-- Tune them with an UPDATE; existing budget rows keep their limit until changed the same way.
create table public.provider_budget_defaults (
  provider_id text not null references public.provider_registry(id),
  dimension text not null check (dimension ~ '^[a-z_]{1,40}$'),
  global_limit bigint not null check (global_limit >= 0),
  workspace_limit bigint not null check (workspace_limit >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider_id, dimension),
  check (workspace_limit <= global_limit)
);
alter table public.provider_budget_defaults enable row level security;
create policy provider_budget_defaults_client_deny
  on public.provider_budget_defaults as restrictive
  for all to anon, authenticated
  using (false) with check (false);
revoke all on public.provider_budget_defaults from public, anon, authenticated;

insert into public.provider_budget_defaults (provider_id, dimension, global_limit, workspace_limit) values
  ('gemini', 'requests', 2000, 600),
  ('gemini', 'input_tokens', 20000000, 4000000),
  ('gemini', 'output_tokens', 1500000, 300000),
  ('gemini', 'embedding_tokens', 10000000, 2000000),
  ('qdrant', 'requests', 50000, 5000),
  ('qdrant', 'vectors', 50000, 5000),
  ('supabase_storage', 'requests', 20000, 2000),
  ('supabase_storage', 'egress_bytes', 160000000, 100000000);

-- A reservation remembers the window of both budget rows it was counted in, so a settlement that arrives
-- after a window has ended cannot subtract from the new window.
alter table public.budget_reservations add column if not exists global_reset_at timestamptz;
alter table public.budget_reservations drop constraint budget_reservations_state_check;
alter table public.budget_reservations add constraint budget_reservations_state_check
  check (state = any (array['RESERVED', 'SETTLED', 'RELEASED', 'RECONCILIATION_REQUIRED', 'EXPIRED']));

-- One definition of "the operator's review of this provider is current".
create function public.nexus_provider_rights_current(p_provider text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $fn$
  select exists (
    select 1 from public.provider_registry pr
     where pr.id = p_provider
       and pr.status in ('APPROVED', 'APPROVED_WITH_DUTIES')
       and pr.review_owner is not null
       and pr.terms_hash ~ '^[0-9a-f]{64}$'
       and pr.terms_checked_at between now() - interval '365 days' and now()
       and exists (
         select 1 from public.provider_terms_snapshots pts
          where pts.provider_id = pr.id and pts.content_hash = pr.terms_hash
            and pts.checked_at = pr.terms_checked_at and pts.approved_by = pr.review_owner))
$fn$;
revoke all on function public.nexus_provider_rights_current(text) from public, anon, authenticated;
grant execute on function public.nexus_provider_rights_current(text) to service_role;

-- One definition of "this workspace's owner approval is current". With p_action, the action must be allowed.
create function public.nexus_workspace_approval_current(p_workspace uuid, p_provider text, p_action text default null)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $fn$
  select exists (
    select 1 from public.workspace_provider_policies wp
      join public.provider_registry pr on pr.id = wp.provider_id
      join public.workspace_members owner
        on owner.workspace_id = wp.workspace_id and owner.user_id = wp.reviewed_by and owner.role = 'owner'
      join public.workspaces w on w.id = wp.workspace_id and w.lifecycle_state = 'active'
     where wp.workspace_id = p_workspace and wp.provider_id = p_provider
       and wp.status = 'APPROVED'
       and wp.reviewed_at <= now()
       and wp.rights_hash ~ '^[0-9a-f]{64}$'
       and wp.rights_hash = pr.terms_hash
       and (p_action is null or (wp.allowed_actions @> array[p_action]
            and not (p_action = any (wp.prohibited_actions))
            and not (p_action = any (wp.review_actions)))))
$fn$;
revoke all on function public.nexus_workspace_approval_current(uuid, text, text) from public, anon, authenticated;
grant execute on function public.nexus_workspace_approval_current(uuid, text, text) to service_role;

-- Returns the budget row for one scope, creating it from the defaults when it is missing and opening the next
-- daily window when the current one has ended. Returns no row for a dimension that has no default.
create function public.nexus_open_budget_window(p_scope text, p_workspace uuid, p_provider text, p_dimension text)
returns public.resource_budgets language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  b public.resource_budgets%rowtype;
  d public.provider_budget_defaults%rowtype;
  boundary timestamptz := (date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc';
begin
  select * into b from public.resource_budgets
   where scope_key = p_scope and provider_id = p_provider and dimension = p_dimension for update;
  if not found then
    select * into d from public.provider_budget_defaults where provider_id = p_provider and dimension = p_dimension;
    if not found then return null; end if;
    insert into public.resource_budgets (scope_key, workspace_id, provider_id, dimension, hard_limit, window_kind, reset_at, state)
    values (p_scope, p_workspace, p_provider, p_dimension,
            case when p_workspace is null then d.global_limit else d.workspace_limit end, 'daily', boundary, 'READY')
    on conflict (scope_key, provider_id, dimension) do nothing;
    select * into b from public.resource_budgets
     where scope_key = p_scope and provider_id = p_provider and dimension = p_dimension for update;
  end if;
  if b.window_kind = 'daily' and b.reset_at is not null and b.reset_at <= now() then
    -- Close reservations left open in the finished window. Rows being settled right now are skipped; their
    -- settlement sees that the window changed and leaves the new window's counters alone.
    with finished as (
      select id from public.budget_reservations
       where state = 'RESERVED' and provider_id = p_provider and dimension = p_dimension
         and (p_workspace is null or workspace_id = p_workspace)
         and coalesce(case when p_workspace is null then global_reset_at else reset_at end, reset_at) <= now()
       for update skip locked)
    update public.budget_reservations r set state = 'EXPIRED', settled_at = now()
      from finished where r.id = finished.id;
    update public.resource_budgets
       set used = 0, reserved = 0, reset_at = boundary, revision = revision + 1, updated_at = now()
     where scope_key = p_scope and provider_id = p_provider and dimension = p_dimension
    returning * into b;
  end if;
  return b;
end
$fn$;
revoke all on function public.nexus_open_budget_window(text, uuid, text, text) from public, anon, authenticated, service_role;

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
  -- workspace owner must have approved. Unknown providers and missing approvals fail closed.
  if not public.nexus_provider_rights_current(p_provider) then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','PROVIDER_REVIEW_REQUIRED');
  end if;
  if (select requires_workspace_approval from public.provider_registry where id=p_provider)
     and not public.nexus_workspace_approval_current(p_workspace, p_provider) then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','WORKSPACE_APPROVAL_REQUIRED');
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

create or replace function public.v6_settle_budget(
  p_reservation uuid, p_measured bigint, p_provider_called boolean
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare r public.budget_reservations%rowtype; next_state text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  select * into r from public.budget_reservations where id=p_reservation for update;
  if not found then return jsonb_build_object('state','REVIEW_REQUIRED'); end if;
  if r.state not in ('RESERVED','EXPIRED') then return jsonb_build_object('state',r.state,'replayed',true); end if;
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
  if r.state = 'RESERVED' then
    -- Lock both scope rows in stable order to prevent concurrent settlement races.
    perform 1 from public.resource_budgets
      where scope_key in ('global','workspace:' || r.workspace_id::text)
        and provider_id=r.provider_id and dimension=r.dimension
      order by scope_key for update;
    if (select count(*) from public.resource_budgets where scope_key in ('global','workspace:' || r.workspace_id::text)
        and provider_id=r.provider_id and dimension=r.dimension) <> 2 then
      raise exception 'NR:MIGRATION_REQUIRED quota budget scope disappeared';
    end if;
    -- Count the usage only in windows that are still the ones this reservation was made in. A window that
    -- has ended since then was reset together with its reservations.
    update public.resource_budgets
      set reserved=reserved-r.amount, used=used+case when p_provider_called then p_measured else 0 end,
          revision=revision+1, updated_at=now()
      where provider_id=r.provider_id and dimension=r.dimension
        and ((scope_key='global' and reset_at is not distinct from coalesce(r.global_reset_at, r.reset_at))
          or (scope_key='workspace:' || r.workspace_id::text and reset_at is not distinct from r.reset_at));
  end if;
  update public.budget_reservations set state=next_state, measured=case when p_provider_called then p_measured else 0 end,
    settled_at=now() where id=r.id;
  return jsonb_build_object('state',next_state);
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
    admission := public.v6_reserve_budget(
      p_workspace,p_provider,item.key,item.value::bigint,
      p_idempotency_key || ':' || item.key,p_priority
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

create or replace function public.nexus_authorize_byok_processing(
  p_workspace uuid, p_actor uuid, p_data_classification text
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $fn$
begin
  if coalesce(auth.role(),'') <> 'service_role'
     or p_workspace is null or p_actor is null
     or p_data_classification is distinct from 'non_sensitive' then
    return jsonb_build_object('state','RIGHTS_BLOCKED');
  end if;
  -- Revalidate current workspace and researcher authority for every provider call,
  -- including queued work whose uploader may have lost access since submission.
  perform 1 from public.workspaces w join public.workspace_members m
    on m.workspace_id=w.id and m.user_id=p_actor
    where w.id=p_workspace and w.lifecycle_state='active'
      and m.role in ('owner','admin','editor') for share of w,m;
  if not found then return jsonb_build_object('state','RIGHTS_BLOCKED'); end if;
  perform 1 from public.nexus_user_provider_keys k
    where k.user_id=p_actor and k.provider='gemini' and k.is_active
      and k.ciphertext is not null and k.nonce is not null
      and k.cost_consent_at is not null and k.cost_consent_at<=now() for share;
  if not found then return jsonb_build_object('state','BYOK_REQUIRED'); end if;
  if not public.nexus_provider_rights_current('gemini') then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','PROVIDER_REVIEW_REQUIRED');
  end if;
  if not public.nexus_workspace_approval_current(p_workspace, 'gemini', 'gemini_non_sensitive') then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','WORKSPACE_APPROVAL_REQUIRED');
  end if;
  insert into public.audit_events(workspace_id,user_id,action,resource_type,metadata)
    values(p_workspace,p_actor,'provider.byok.admit','gemini',
      jsonb_build_object('data_classification','non_sensitive','credential_mode','user_byok',
        'provider_cost_status','UNKNOWN','platform_budget_charged',false));
  return jsonb_build_object('state','READY','credential_mode','user_byok','provider_cost_status','UNKNOWN');
end
$fn$;

-- Atomic owner decision. The gateway supplies the verified Auth actor, never
-- client-supplied identity. This function is inaccessible to browser roles.
create or replace function public.nexus_workspace_processing_policy(
  p_workspace uuid, p_actor uuid, p_operation text default 'read',
  p_terms_hash text default null, p_policy_version bigint default null
) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp as $fn$
declare
  actor_role text; pr public.provider_registry%rowtype;
  wp public.workspace_provider_policies%rowtype;
  rights_ready boolean := false; owner_current boolean := false;
  approved boolean := false; version_now bigint := 0;
begin
  if coalesce(auth.role(),'') <> 'service_role'
    or p_workspace is null or p_actor is null then raise exception 'NR:FORBIDDEN'; end if;
  if p_operation is null or p_operation not in ('read','approve','revoke') then
    raise exception 'NR:INVALID_SCOPE'; end if;
  -- Share the management lock: simultaneous owner removal and approvals cannot race.
  perform 1 from public.workspaces where id=p_workspace and lifecycle_state='active' for update;
  if not found then raise exception 'NR:WORKSPACE_UNAVAILABLE'; end if;
  select role into actor_role from public.workspace_members
    where workspace_id=p_workspace and user_id=p_actor for share;
  if actor_role is null then raise exception 'NR:FORBIDDEN'; end if;
  if p_operation<>'read' and actor_role<>'owner' then raise exception 'NR:FORBIDDEN'; end if;
  select * into pr from public.provider_registry where id='gemini' for share;
  rights_ready := public.nexus_provider_rights_current('gemini');
  select * into wp from public.workspace_provider_policies
    where workspace_id=p_workspace and provider_id='gemini' for update;
  version_now := coalesce(wp.policy_version,0);
  if p_operation<>'read' then
    if p_policy_version is null or p_policy_version<>version_now then
      raise exception 'NR:VERSION_CONFLICT'; end if;
    if p_operation='approve' and (not rights_ready or p_terms_hash is distinct from pr.terms_hash) then
      raise exception 'NR:RIGHTS_BLOCKED'; end if;
    -- Revoke works even if rights expired/changed. No quota/key consent is inferred.
    insert into public.workspace_provider_policies(workspace_id,provider_id,status,
      allowed_actions,prohibited_actions,review_actions,duties,rights_hash,policy_version,reviewed_by,reviewed_at)
    values(p_workspace,'gemini',case when p_operation='approve' then 'APPROVED' else 'DISABLED' end,
      case when p_operation='approve' then array['gemini_non_sensitive']::text[] else '{}'::text[] end,
      case when p_operation='revoke' then array['gemini_non_sensitive']::text[] else '{}'::text[] end,
      '{}'::text[],array['non_sensitive_only','separate_byok_cost_consent','renew_when_terms_change'],
      case when p_operation='approve' then pr.terms_hash else coalesce(wp.rights_hash,repeat('0',64)) end,
      version_now+1,p_actor,now())
    on conflict(workspace_id,provider_id) do update set status=excluded.status,
      allowed_actions=excluded.allowed_actions,prohibited_actions=excluded.prohibited_actions,
      review_actions=excluded.review_actions,duties=excluded.duties,rights_hash=excluded.rights_hash,
      policy_version=excluded.policy_version,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at
    returning * into wp;
    insert into public.audit_events(workspace_id,user_id,action,resource_type,metadata)
      values(p_workspace,p_actor,'provider.policy.'||p_operation,'gemini',jsonb_build_object(
        'terms_hash',wp.rights_hash,'policy_version',wp.policy_version,'data_classification','non_sensitive'));
  end if;
  owner_current := exists(select 1 from public.workspace_members
    where workspace_id=p_workspace and user_id=wp.reviewed_by and role='owner');
  approved := rights_ready and public.nexus_workspace_approval_current(p_workspace, 'gemini', 'gemini_non_sensitive');
  -- An owner approval has no timer of its own: it lasts until the reviewed terms change or the operator's
  -- review lapses, which is the date reported as approval_expires_at.
  return jsonb_build_object('schema_version','038','provider','gemini',
    'state',case when approved then 'APPROVED' else 'RIGHTS_BLOCKED' end,
    'owner_can_manage',actor_role='owner','operator_rights_current',rights_ready,
    'policy_version',coalesce(wp.policy_version,0),'policy_status',coalesce(wp.status,'UNKNOWN'),
    'terms_hash',pr.terms_hash,'terms_url',pr.terms_url,'terms_checked_at',pr.terms_checked_at,
    'reviewed_at',wp.reviewed_at,
    'approval_expires_at',case when approved then pr.terms_checked_at+interval '365 days' end,
    'approval_matches_terms',coalesce(wp.rights_hash=pr.terms_hash,false),
    'reviewing_owner_current',owner_current,'allowed_data_classification','non_sensitive',
    'byok_cost_consent_separate',true,'provider_processing_performed',false);
end
$fn$;

-- The operator records that a named, confirmed account has reviewed a provider's current terms. The content
-- hash identifies the reviewed document; owner approvals are bound to it.
create function public.nexus_record_provider_review(
  p_provider text, p_reviewer_email text, p_terms_url text, p_content_hash text, p_terms jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $fn$
declare
  reviewer uuid; next_revision bigint; checked timestamptz := now(); previous_hash text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'NR:FORBIDDEN'; end if;
  if p_provider is null or p_reviewer_email is null or p_terms_url is null or p_terms_url !~ '^https://[^\s]+$' or length(p_terms_url) > 500
     or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_terms is null or jsonb_typeof(p_terms) <> 'object' or length(p_terms::text) > 8000 then
    raise exception 'NR:INVALID_SCOPE';
  end if;
  perform 1 from public.provider_registry where id = p_provider for update;
  if not found then raise exception 'NR:INVALID_SCOPE'; end if;
  reviewer := public.nexus_resolve_confirmed_member(p_reviewer_email);
  if reviewer is null then raise exception 'NR:INVALID_SCOPE'; end if;
  select terms_hash into previous_hash from public.provider_registry where id = p_provider;
  select coalesce(max(revision), 0) + 1 into next_revision from public.provider_terms_snapshots where provider_id = p_provider;
  insert into public.provider_terms_snapshots (provider_id, revision, checked_at, content_hash, retrieval_method, terms, materiality, approved_by)
  values (p_provider, next_revision, checked, p_content_hash, 'STATIC_HTML', p_terms, 'RIGHTS_REVIEW', reviewer);
  update public.provider_registry
     set status = 'APPROVED', review_owner = reviewer, terms_url = p_terms_url, terms_hash = p_content_hash,
         terms_checked_at = checked, revision = revision + 1, updated_at = now()
   where id = p_provider;
  return jsonb_build_object('provider', p_provider, 'revision', next_revision, 'terms_hash', p_content_hash,
    'terms_changed', previous_hash is distinct from p_content_hash, 'checked_at', checked,
    'valid_until', checked + interval '365 days');
end
$fn$;
revoke all on function public.nexus_record_provider_review(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.nexus_record_provider_review(text, text, text, text, jsonb) to service_role;

-- What an operator needs to see: which providers can be used right now and when each review lapses.
create function public.nexus_provider_rights_status()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'NR:FORBIDDEN'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'provider', pr.id, 'current', public.nexus_provider_rights_current(pr.id), 'status', pr.status,
      'requires_workspace_approval', pr.requires_workspace_approval,
      'terms_checked_at', pr.terms_checked_at, 'valid_until', pr.terms_checked_at + interval '365 days',
      'renew_soon', pr.terms_checked_at is not null and pr.terms_checked_at + interval '335 days' <= now()) order by pr.id)
    from public.provider_registry pr
    where exists (select 1 from public.provider_budget_defaults d where d.provider_id = pr.id)), '[]'::jsonb);
end
$fn$;
revoke all on function public.nexus_provider_rights_status() from public, anon, authenticated;
grant execute on function public.nexus_provider_rights_status() to service_role;

-- Read before the gateway accepts an upload or a question, so a workspace that cannot be processed yet is
-- told why at once and does not use up its free-trial allowance.
create function public.nexus_processing_gate(p_workspace uuid)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $fn$
begin
  if coalesce(auth.role(),'') <> 'service_role' or p_workspace is null then raise exception 'NR:FORBIDDEN'; end if;
  if not public.nexus_provider_rights_current('gemini') or not public.nexus_provider_rights_current('qdrant') then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','PROVIDER_REVIEW_REQUIRED');
  end if;
  if not public.nexus_workspace_approval_current(p_workspace, 'gemini', 'gemini_non_sensitive') then
    return jsonb_build_object('state','RIGHTS_BLOCKED','reason','WORKSPACE_APPROVAL_REQUIRED');
  end if;
  return jsonb_build_object('state','READY');
end
$fn$;
revoke all on function public.nexus_processing_gate(uuid) from public, anon, authenticated;
grant execute on function public.nexus_processing_gate(uuid) to service_role;
