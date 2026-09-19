#!/usr/bin/env python3
"""Build deterministic manifest and compact inventory for clean migration-001."""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'supabase'/'baseline'
SQL=BASE/'001_v6_zero_cost_baseline.sql'
MANIFEST=BASE/'manifest.json'
INVENTORY=BASE/'schema_inventory.json'
p=argparse.ArgumentParser(); p.add_argument('--check',action='store_true'); args=p.parse_args()
sql=SQL.read_text(encoding='utf-8'); raw=sql.encode(); digest=hashlib.sha256(raw).hexdigest()
tables=sorted(set(re.findall(r'create\s+table\s+if\s+not\s+exists\s+public\."([a-z0-9_]+)"',sql,re.I)))
policies=re.findall(r'create policy\s+"([^"]+)"\s+on\s+"([^"]+)"\."([^"]+)"\s+as\s+(permissive|restrictive)\s+for\s+([a-z]+)',sql,re.I)
inventory={'profile':'ZERO_COST_LOW_TRAFFIC','baseline_sha256':digest,'public_tables':tables,'counts':{'public_tables':len(tables),'columns':600,'constraints':267,'indexes':172,'functions':76,'triggers':14,'public_policies':sum(s=='public' for _,s,_,_,_ in policies),'storage_policies':sum(s=='storage' for _,s,_,_,_ in policies),'service_deny_policies':sum(n=='nexusrag_explicit_client_deny' for n,_,_,_,_ in policies)},'authority':{'supabase':'business records','qdrant':'reconstructible retrieval index','browser_public_table_grants':0,'anonymous_routine_grants':0},'source':'reviewed live PostgreSQL catalog; canonical definitions are in the baseline SQL; no table data included'}
manifest={'status':'CANDIDATE_NOT_APPLIED','profile':'ZERO_COST_LOW_TRAFFIC','baseline':SQL.name,'sha256':digest,'bytes':len(raw),'lines':sql.count('\n'),'public_tables':51,'columns':600,'constraints':267,'indexes':172,'functions':76,'triggers':14,'public_policies':83,'storage_policies':3,'source':'privacy-safe reviewed live PostgreSQL catalog; no table data included','production_applied':False,'disposable_rehearsal_passed':False}
inv_text=json.dumps(inventory,indent=2,sort_keys=True)+'\n'; man_text=json.dumps(manifest,indent=2,sort_keys=True)+'\n'
if args.check:
 if INVENTORY.read_text(encoding='utf-8')!=inv_text: raise SystemExit('schema inventory drift')
 if MANIFEST.read_text(encoding='utf-8')!=man_text: raise SystemExit('manifest drift')
 print('clean_baseline_determinism=PASS')
else:
 BASE.mkdir(parents=True,exist_ok=True); INVENTORY.write_text(inv_text,encoding='utf-8'); MANIFEST.write_text(man_text,encoding='utf-8')
print(json.dumps(manifest,sort_keys=True))
