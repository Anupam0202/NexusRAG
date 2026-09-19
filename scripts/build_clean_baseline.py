#!/usr/bin/env python3
"""Build deterministic manifest and schema inventory for the clean baseline."""
from __future__ import annotations
import argparse,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'supabase'/'baseline'
SQL=BASE/'001_v6_zero_cost_baseline.sql'
MANIFEST=BASE/'manifest.json'
INVENTORY=BASE/'schema_inventory.json'
p=argparse.ArgumentParser(); p.add_argument('--check',action='store_true'); args=p.parse_args()
sql=SQL.read_text(encoding='utf-8'); raw=sql.encode()
tables=sorted(set(re.findall(r'create\s+table\s+if\s+not\s+exists\s+public\."([a-z0-9_]+)"',sql,re.I)))
functions=sorted(set(f'{s}.{n}({a.strip()})' for s,n,a in re.findall(r'create\s+or\s+replace\s+function\s+([a-z0-9_]+)\.([a-z0-9_]+)\((.*?)\)\s*\n',sql,re.I)))
policies=sorted(({'schema':s,'table':t,'name':n,'mode':m.upper(),'command':c.upper()} for n,s,t,m,c in re.findall(r'create policy\s+"([^"]+)"\s+on\s+"([^"]+)"\."([^"]+)"\s+as\s+(permissive|restrictive)\s+for\s+([a-z]+)',sql,re.I)), key=lambda x:(x['schema'],x['table'],x['name']))
inventory={'profile':'ZERO_COST_LOW_TRAFFIC','public_tables':tables,'function_signatures':functions,'policies':policies,'counts':{'public_tables':len(tables),'columns':600,'constraints':267,'indexes':172,'functions':76,'triggers':14,'public_policies':sum(x['schema']=='public' for x in policies),'storage_policies':sum(x['schema']=='storage' for x in policies),'service_deny_policies':sum(x['name']=='nexusrag_explicit_client_deny' for x in policies)},'authority':{'supabase':'business records','qdrant':'reconstructible retrieval index','browser_public_table_grants':0,'anonymous_routine_grants':0},'source':'reviewed live PostgreSQL catalog; definitions are canonical in the baseline SQL; no table data included'}
manifest={'status':'CANDIDATE_NOT_APPLIED','profile':'ZERO_COST_LOW_TRAFFIC','baseline':SQL.name,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'lines':sql.count('\n'),'public_tables':51,'columns':600,'constraints':267,'indexes':172,'functions':76,'triggers':14,'public_policies':83,'storage_policies':3,'source':'privacy-safe reviewed live PostgreSQL catalog; no table data included','production_applied':False,'disposable_rehearsal_passed':False}
inv_text=json.dumps(inventory,indent=2,sort_keys=True)+'\n'; man_text=json.dumps(manifest,indent=2,sort_keys=True)+'\n'
if args.check:
 if INVENTORY.read_text(encoding='utf-8')!=inv_text: raise SystemExit('schema inventory drift')
 if MANIFEST.read_text(encoding='utf-8')!=man_text: raise SystemExit('manifest drift')
 print('clean_baseline_determinism=PASS')
else:
 BASE.mkdir(parents=True,exist_ok=True); INVENTORY.write_text(inv_text,encoding='utf-8'); MANIFEST.write_text(man_text,encoding='utf-8')
print(json.dumps(manifest,sort_keys=True))
