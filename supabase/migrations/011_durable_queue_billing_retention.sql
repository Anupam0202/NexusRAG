-- Durable queue leases, daily usage reconciliation, and retention controls.

alter table public.ingestion_jobs
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists max_attempts int not null default 3
    check (max_attempts between 1 and 20),
  add column if not exists last_error_at timestamptz;

create index if not exists ingestion_jobs_claimable_idx
on public.ingestion_jobs (available_at, created_at)
where status in ('queued', 'processing');

alter table public.llm_usage_events
  add column if not exists cost_microusd bigint not null default 0
    check (cost_microusd >= 0);

create table if not exists public.workspace_usage_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_date date not null,
  query_count bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  total_tokens bigint not null default 0,
  successful_calls bigint not null default 0,
  failed_calls bigint not null default 0,
  estimated_cost_microusd bigint not null default 0,
  reconciled_at timestamptz not null default now(),
  primary key (workspace_id, usage_date)
);

alter table public.workspace_usage_daily enable row level security;

create policy "workspace_usage_daily_select_admins"
on public.workspace_usage_daily for select to authenticated
using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

revoke all privileges on public.workspace_usage_daily from public, anon, authenticated;
grant all privileges on public.workspace_usage_daily to service_role;

alter table public.workspace_settings
  add column if not exists retention_enabled boolean not null default false,
  add column if not exists retention_days int not null default 0
    check (retention_days between 0 and 3650),
  add column if not exists last_retention_at timestamptz,
  add column if not exists next_retention_at timestamptz,
  add column if not exists retention_lease_owner text,
  add column if not exists retention_lease_expires_at timestamptz;

create index if not exists workspace_settings_due_retention_idx
on public.workspace_settings (next_retention_at)
where retention_enabled;

create or replace function public.claim_ingestion_job(
  p_worker_id text,
  p_lease_seconds int default 300,
  p_workspace_id uuid default null
)
returns setof public.ingestion_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  selected_job public.ingestion_jobs%rowtype;
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  select job.*
  into selected_job
  from public.ingestion_jobs job
  where (
      (job.status = 'queued' and job.available_at <= now())
      or (
        job.status = 'processing'
        and job.lease_expires_at is not null
        and job.lease_expires_at <= now()
      )
    )
    and job.attempts < job.max_attempts
    and (p_workspace_id is null or job.workspace_id = p_workspace_id)
  order by job.available_at asc, job.created_at asc
  for update skip locked
  limit 1;

  if selected_job.id is null then
    return;
  end if;

  return query
  update public.ingestion_jobs
  set status = 'processing',
      stage = 'claimed',
      progress = greatest(progress, 1),
      attempts = attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 3600))),
      started_at = coalesce(started_at, now()),
      completed_at = null,
      error_message = null
  where id = selected_job.id
  returning *;
end;
$$;

create or replace function public.requeue_ingestion_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_message text,
  p_retry_seconds int default 30
)
returns setof public.ingestion_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  update public.ingestion_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
      stage = case when attempts >= max_attempts then 'failed' else 'retry_scheduled' end,
      progress = case when attempts >= max_attempts then 100 else 0 end,
      error_message = left(coalesce(p_error_message, 'Worker processing failed.'), 2000),
      last_error_at = now(),
      available_at = now() + make_interval(secs => greatest(1, least(p_retry_seconds, 86400))),
      lease_owner = null,
      lease_expires_at = null,
      completed_at = case when attempts >= max_attempts then now() else null end
  where id = p_job_id
    and status = 'processing'
    and lease_owner = p_worker_id
  returning *;
end;
$$;

create or replace function public.reconcile_workspace_usage(
  p_workspace_id uuid,
  p_usage_date date default null
)
returns setof public.workspace_usage_daily
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target_date date := coalesce(p_usage_date, current_date);
begin
  insert into public.workspace_usage_daily (
    workspace_id,
    usage_date,
    query_count,
    input_tokens,
    output_tokens,
    total_tokens,
    successful_calls,
    failed_calls,
    estimated_cost_microusd,
    reconciled_at
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
    coalesce(sum(cost_microusd), 0),
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
$$;

create or replace function public.claim_retention_schedules(
  p_worker_id text,
  p_limit int default 100,
  p_lease_seconds int default 900
)
returns setof public.workspace_settings
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker id is required' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select settings.workspace_id
    from public.workspace_settings settings
    where settings.retention_enabled
      and settings.retention_days > 0
      and settings.next_retention_at is not null
      and settings.next_retention_at <= now()
      and (
        settings.retention_lease_expires_at is null
        or settings.retention_lease_expires_at <= now()
      )
    order by settings.next_retention_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 500))
  )
  update public.workspace_settings settings
  set retention_lease_owner = p_worker_id,
      retention_lease_expires_at =
        now() + make_interval(secs => greatest(60, least(p_lease_seconds, 3600)))
  from candidates
  where settings.workspace_id = candidates.workspace_id
  returning settings.*;
end;
$$;

create or replace function public.clear_terminal_ingestion_job_lease()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status in ('completed', 'failed') then
    new.lease_owner := null;
    new.lease_expires_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_terminal_ingestion_job_lease
on public.ingestion_jobs;
create trigger clear_terminal_ingestion_job_lease
before update on public.ingestion_jobs
for each row execute function public.clear_terminal_ingestion_job_lease();

revoke execute on function public.claim_ingestion_job(text, int, uuid)
from public, anon, authenticated;
revoke execute on function public.requeue_ingestion_job(uuid, text, text, int)
from public, anon, authenticated;
revoke execute on function public.reconcile_workspace_usage(uuid, date)
from public, anon, authenticated;
revoke execute on function public.claim_retention_schedules(text, int, int)
from public, anon, authenticated;
revoke execute on function public.clear_terminal_ingestion_job_lease()
from public, anon, authenticated;

grant execute on function public.claim_ingestion_job(text, int, uuid) to service_role;
grant execute on function public.requeue_ingestion_job(uuid, text, text, int) to service_role;
grant execute on function public.reconcile_workspace_usage(uuid, date) to service_role;
grant execute on function public.claim_retention_schedules(text, int, int) to service_role;
