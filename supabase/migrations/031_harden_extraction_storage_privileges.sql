-- Candidate only. Keep extraction staging service-role-only and prevent direct
-- trigger-RPC invocation. This migration closes Supabase security-advisor
-- findings observed on the zero-cost disposable rehearsal project. Production
-- application still requires separate release authorization.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '60s';

revoke all on function public.cleanup_terminal_ingestion_extraction()
  from public, anon, authenticated;
grant execute on function public.cleanup_terminal_ingestion_extraction()
  to service_role;

drop policy if exists "nexusrag_explicit_client_deny"
  on public.ingestion_extraction_manifests;
create policy "nexusrag_explicit_client_deny"
  on public.ingestion_extraction_manifests
  as restrictive for all to anon, authenticated
  using (false) with check (false);

drop policy if exists "nexusrag_explicit_client_deny"
  on public.ingestion_extraction_chunks;
create policy "nexusrag_explicit_client_deny"
  on public.ingestion_extraction_chunks
  as restrictive for all to anon, authenticated
  using (false) with check (false);

do $$
begin
  if has_function_privilege('anon',
       'public.cleanup_terminal_ingestion_extraction()', 'execute')
     or has_function_privilege('authenticated',
       'public.cleanup_terminal_ingestion_extraction()', 'execute')
     or not has_function_privilege('service_role',
       'public.cleanup_terminal_ingestion_extraction()', 'execute') then
    raise exception 'extraction trigger function grants are too broad or missing';
  end if;

  if not exists (
       select 1 from pg_policies
       where schemaname='public'
         and tablename='ingestion_extraction_manifests'
         and policyname='nexusrag_explicit_client_deny'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname='public'
         and tablename='ingestion_extraction_chunks'
         and policyname='nexusrag_explicit_client_deny'
     ) then
    raise exception 'extraction staging explicit-deny policies are missing';
  end if;
end $$;
commit;