#!/usr/bin/env python3
"""Offline integrity, privacy, and determinism checks for clean migration-001."""
from __future__ import annotations
import hashlib,json,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]; BASE=ROOT/'supabase'/'baseline'
SQL=BASE/'001_v6_zero_cost_baseline.sql'; INVENTORY=BASE/'schema_inventory.json'; MANIFEST=BASE/'manifest.json'
EXPECTED={'profiles','workspaces','workspace_members','documents','document_chunks','ingestion_jobs','chat_sessions','chat_messages','llm_usage_events','audit_events','workspace_settings','api_keys','eval_runs','eval_results','provider_health_state','workspace_usage_daily','conversation_participants','workspace_policy_versions','document_versions','workbench_outbox','usage_reservations','usage_ledger','deletion_operations','deletion_targets','document_uploads','query_runs','query_run_sources','query_events','findings','finding_versions','finding_participants','finding_reviews','workbench_mutations','provider_registry','workspace_provider_policies','resource_budgets','budget_reservations','evidence_sources','evidence_source_versions','evidence_items','graph_entities','graph_aliases','graph_relationships','monitors','monitor_runs','cache_entries','materializations','evidence_exports','deletion_receipts','provider_terms_snapshots','rights_decisions'}
PATTERNS={'private_key':r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----','google_api_key':r'AIza[0-9A-Za-z_-]{30,}','supabase_secret':r'(?:sbp_|sb_secret_)[0-9A-Za-z_-]{20,}','jwt':r'eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}','credentialed_url':r'(?i)https?://[^\s/:]+:[^\s/@]+@','supabase_project_url':r'(?i)https://[a-z0-9]{16,}\.supabase\.co'}
def fail(s): raise SystemExit(s)
def main():
 for p in (SQL,INVENTORY,MANIFEST,ROOT/'scripts'/'build_clean_baseline.py'):
  if not p.is_file(): fail(f'missing clean-baseline artifact: {p.relative_to(ROOT)}')
 sql=SQL.read_text(); inv=json.loads(INVENTORY.read_text()); man=json.loads(MANIFEST.read_text()); digest=hashlib.sha256(sql.encode()).hexdigest()
 if digest!=man.get('sha256'): fail('baseline SHA-256 mismatch')
 if man.get('status')!='CANDIDATE_NOT_APPLIED' or man.get('production_applied') is not False or man.get('disposable_rehearsal_passed') is not False: fail('baseline status overclaim')
 counts=inv.get('counts',{}); required={'public_tables':51,'columns':600,'constraints':267,'indexes':172,'functions':76,'triggers':14,'public_policies':83,'storage_policies':3,'service_deny_policies':35}
 for k,v in required.items():
  if counts.get(k)!=v: fail(f'inventory count mismatch: {k}')
 if set(inv.get('public_tables',[]))!=EXPECTED: fail('51-table inventory mismatch')
 if inv.get('authority',{}).get('browser_public_table_grants')!=0 or inv.get('authority',{}).get('anonymous_routine_grants')!=0: fail('unsafe authority inventory')
 if len(re.findall(r'alter table public\."[a-z0-9_]+" enable row level security;',sql,re.I))!=51: fail('RLS enablement mismatch')
 if sql.count('create policy ')!=86 or sql.count('"nexusrag_explicit_client_deny"')<35: fail('policy contract mismatch')
 # PostgreSQL requires referenced primary/unique keys before foreign-key creation.
 constraints=re.findall(r'^alter table only public\."[^"]+" add constraint "[^"]+" .+;$',sql,re.M)
 if len(constraints)!=267: fail('constraint definition count mismatch')
 non_foreign=[line for line in constraints if ' FOREIGN KEY ' not in line]; foreign=[line for line in constraints if ' FOREIGN KEY ' in line]
 if len(non_foreign)!=178 or len(foreign)!=89 or constraints!=non_foreign+foreign: fail('primary and unique constraints must precede all foreign keys')
 unique_targets=set()
 for line in non_foreign:
  match=re.search(r'alter table only public\."([^"]+)" add constraint "[^"]+" (?:PRIMARY KEY|UNIQUE) \(([^)]+)\);$',line)
  if match: unique_targets.add((match.group(1),tuple(value.strip().strip('"') for value in match.group(2).split(','))))
 for line in foreign:
  match=re.search(r'^alter table only public\."([^"]+)" add constraint "([^"]+)" FOREIGN KEY \(([^)]+)\) REFERENCES ([a-zA-Z0-9_."]+)\(([^)]+)\)',line)
  if not match: fail(f'unparsed foreign key: {line}')
  target=match.group(4).replace('"',''); schema,table=target.split('.',1) if '.' in target else ('public',target)
  columns=tuple(value.strip().strip('"') for value in match.group(5).split(','))
  if schema=='public' and (table,columns) not in unique_targets: fail(f'foreign key target lacks prior primary/unique constraint: {match.group(2)}')
 for fragment in ('create schema if not exists nexusrag_private','create extension if not exists vector with schema extensions','workbench_turn_order','revoke execute on all functions in schema public from public, anon, authenticated','insert into storage.buckets','production application requires separate authorization'):
  if fragment.casefold() not in sql.casefold(): fail(f'missing baseline contract: {fragment}')
 for retired in ('014_identity_visibility_policy','015_versions_fenced_jobs','016_credentials_usage_lifecycle','017_workbench_upload_publication','018_durable_query_runs','019_workbench_interfaces','020_workbench_operations','021_v6_evidence_governance_foundations','022_v6_rights_quota_interfaces'):
  if retired in sql: fail(f'retired dependency: {retired}')
 for label,pattern in PATTERNS.items():
  for p in (SQL,INVENTORY,MANIFEST):
   if re.search(pattern,p.read_text()): fail(f'suspected {label} in {p.name}')
 run=subprocess.run([sys.executable,str(ROOT/'scripts'/'build_clean_baseline.py'),'--check'],cwd=ROOT,text=True,capture_output=True)
 if run.returncode: fail(run.stdout+run.stderr)
 print('clean_baseline_integrity=PASS'); print(f'sha256={digest}')
 for k,v in required.items(): print(f'{k}={v}')
 print('constraint_dependency_order=PASS')
 print('retired_dependencies=0\nproduction_applied=false\ndisposable_rehearsal_passed=false')
if __name__=='__main__': main()
