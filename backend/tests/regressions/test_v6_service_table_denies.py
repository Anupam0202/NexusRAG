from pathlib import Path
import re
MIGRATION=Path(__file__).resolve().parents[3]/'supabase'/'migrations'/'024_explicit_service_table_denies.sql'
EXPECTED={
'budget_reservations','cache_entries','conversation_participants','deletion_operations','deletion_receipts','deletion_targets','document_uploads','document_versions','evidence_exports','evidence_items','evidence_source_versions','evidence_sources','finding_participants','finding_reviews','finding_versions','findings','graph_aliases','graph_entities','graph_relationships','materializations','monitor_runs','monitors','provider_registry','provider_terms_snapshots','query_events','query_run_sources','query_runs','resource_budgets','rights_decisions','usage_ledger','usage_reservations','workbench_mutations','workbench_outbox','workspace_policy_versions','workspace_provider_policies'}

def test_all_service_tables_are_explicitly_denied():
 sql=MIGRATION.read_text(encoding='utf-8')
 found=set(re.findall(r"'([a-z_]+)'",sql)) & EXPECTED
 assert found==EXPECTED
 assert len(EXPECTED)==35
 for fragment in ('as restrictive for all to anon,authenticated using(false) with check(false)','revoke all privileges on table public.%I from anon,authenticated','to_regclass','enable row level security'):
  assert fragment in sql
