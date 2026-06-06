-- Persist provider/model circuit-breaker health while llm_usage_events remains
-- the durable, append-only usage ledger.

create table if not exists public.provider_health_state (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  model text not null,
  mode text not null check (mode in ('server_default_key', 'workspace_byok_key', 'extractive_only')),
  consecutive_failures int not null default 0 check (consecutive_failures >= 0),
  quota_exhausted boolean not null default false,
  last_error_code text,
  circuit_open_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider, model, mode)
);

alter table public.provider_health_state enable row level security;

drop policy if exists "provider_health_select_members" on public.provider_health_state;
create policy "provider_health_select_members"
on public.provider_health_state for select to authenticated
using (public.is_workspace_member(workspace_id));

revoke all on public.provider_health_state from anon;
grant select on public.provider_health_state to authenticated;
grant all on public.provider_health_state to service_role;

create index if not exists provider_health_state_workspace_updated_idx
on public.provider_health_state(workspace_id, updated_at desc);
