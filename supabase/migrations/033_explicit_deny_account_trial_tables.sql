-- Make the existing service-only row-security boundary explicit to client
-- roles and the Supabase security advisor.
begin;

create policy nexus_account_usage_client_deny
  on public.nexus_account_usage as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy nexus_user_provider_keys_client_deny
  on public.nexus_user_provider_keys as restrictive
  for all to anon, authenticated
  using (false) with check (false);

create policy nexus_account_operations_client_deny
  on public.nexus_account_operations as restrictive
  for all to anon, authenticated
  using (false) with check (false);

drop index if exists public.nexus_account_operations_created_at_idx;
create index if not exists nexus_account_operations_user_created_idx
  on public.nexus_account_operations(user_id, created_at);

commit;