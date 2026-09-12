-- Explicitly deny browser roles on service-mediated authority tables.
-- Service operations use the service_role and remain subject to application capabilities.
begin;

do $policy$
declare
 table_name text;
 service_tables constant text[] := array[
  'budget_reservations','cache_entries','conversation_participants',
  'deletion_operations','deletion_receipts','deletion_targets',
  'document_uploads','document_versions','evidence_exports','evidence_items',
  'evidence_source_versions','evidence_sources','finding_participants',
  'finding_reviews','finding_versions','findings','graph_aliases','graph_entities',
  'graph_relationships','materializations','monitor_runs','monitors',
  'provider_registry','provider_terms_snapshots','query_events','query_run_sources',
  'query_runs','resource_budgets','rights_decisions','usage_ledger',
  'usage_reservations','workbench_mutations','workbench_outbox',
  'workspace_policy_versions','workspace_provider_policies'
 ];
begin
 foreach table_name in array service_tables loop
  if to_regclass(format('public.%I',table_name)) is null then
   raise exception 'NR:MIGRATION_REQUIRED missing public.%',table_name using errcode='42P01';
  end if;
  execute format('alter table public.%I enable row level security',table_name);
  execute format('drop policy if exists %I on public.%I','nexusrag_explicit_client_deny',table_name);
  execute format(
   'create policy %I on public.%I as restrictive for all to anon,authenticated using(false) with check(false)',
   'nexusrag_explicit_client_deny',table_name
  );
  execute format('revoke all privileges on table public.%I from anon,authenticated',table_name);
 end loop;
end
$policy$;

commit;
