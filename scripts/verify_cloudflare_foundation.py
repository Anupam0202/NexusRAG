#!/usr/bin/env python3
"""Offline integrity checks for the Cloudflare source and zero-cost budgets."""
from __future__ import annotations
import hashlib,json,sys
from datetime import date
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 "apps/gateway/src/index.ts",
 "apps/gateway/src/preview-worker.js",
 "apps/run-coordinator/src/reducer.ts",
 "packages/contracts/src/index.ts",
 "packages/data/migrations/0001_control_plane.sql",
 "packages/retrieval/src/point-identity.ts",
 "packages/cloudflare/wrangler.preview.jsonc",
 "tests/cloudflare/foundation.test.mjs",
 "tests/cloudflare/preview-worker.test.mjs",
 "config/zero-cost/cloudflare.free.json",
 "docs/architecture/CLOUDFLARE_DECISION_MATRIX.json",
]
missing=[path for path in REQUIRED if not (ROOT/path).is_file()]
errors=[]
if not missing:
 budgets=json.loads((ROOT/"config/zero-cost/cloudflare.free.json").read_text(encoding="utf-8"))
 matrix=json.loads((ROOT/"docs/architecture/CLOUDFLARE_DECISION_MATRIX.json").read_text(encoding="utf-8"))
 preview=(ROOT/"apps/gateway/src/preview-worker.js").read_text(encoding="utf-8")
 if budgets.get("profile")!="ZERO_COST_LOW_TRAFFIC":errors.append("budget profile mismatch")
 if budgets.get("paid_fallback") is not False:errors.append("paid fallback must be false")
 if budgets.get("unknown_quotas_fail_closed") is not True:errors.append("unknown quotas must fail closed")
 if budgets.get("thresholds_percent")!=[50,70,85,95,100]:errors.append("admission thresholds mismatch")
 for fragment in ("content-security-policy","strict-transport-security","cross-origin-resource-policy","AUTH_REQUIRED","SUPABASE_SECRET_KEY","workspace_members","ROLE_CAPABILITIES","production_verified: false","paid_fallback: false"):
  if fragment not in preview:errors.append(f"preview contract missing: {fragment}")
 required_budgets={
  "workers_requests":100000,"workers_cpu":10,"kv_reads":100000,"kv_writes":1000,
  "d1_rows_read":5000000,"d1_rows_written":100000,"d1_storage":5,
  "r2_standard_storage":10,"r2_class_a":1000000,"r2_class_b":10000000,
  "queues_operations":10000,"workflows_steps":3000,"browser_run":10,
  "vectorize_queried_dimensions":30000000,"vectorize_stored_dimensions":5000000,
  "hyperdrive_queries":100000,"ai_gateway_persistent_logs":100000,"turnstile_widgets":20,
 }
 for key,limit in required_budgets.items():
  if budgets.get("budgets",{}).get(key,{}).get("limit")!=limit:errors.append(f"budget mismatch: {key}")
 sources=budgets.get("sources",[])
 if not sources or any(not source.startswith("https://developers.cloudflare.com/") for source in sources):errors.append("budget sources must be official Cloudflare HTTPS documentation")
 try:
  if date.fromisoformat(budgets["review_after"])<=date.fromisoformat(budgets["verified_at"]):errors.append("review date must follow verification date")
 except (KeyError,ValueError):errors.append("invalid verification dates")
 if matrix.get("status")!="PARTIAL_NOT_COMPLETE":errors.append("decision matrix must not overclaim completion")
 decisions={item["service"]:item["decision"] for item in matrix.get("decisions",[]) if "service" in item and "decision" in item}
 for service in ("Workers","Pages","D1","R2","KV","Queues","Workflows","Vectorize","Browser Run","AI Gateway","Turnstile","Workers AI"):
  if service not in decisions:errors.append(f"missing decision: {service}")
 if decisions.get("Workers AI")!="DISABLED":errors.append("Workers AI must remain disabled in the selected architecture")
migration_sources=[]
for path in sorted((ROOT/"supabase/migrations").glob("*.sql")):
 migration_sources.append({"file":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
passed=not missing and not errors
print(json.dumps({
 "status":"PASS_SOURCE_FOUNDATION" if passed else "FAIL",
 "missing":missing,
 "errors":errors,
 "verified_source_files":len(REQUIRED),
 "reviewed_migration_sources":migration_sources,
 "limitations":[
  "This is an offline source-integrity check, not a live deployment verification.",
  "The reviewed migration chain is not yet the rehearsed clean migration-001 baseline.",
  "CI does not receive production credentials or perform DNS cutover.",
  "Cloudflare budgets must be revalidated on or before review_after.",
  "Queue, Workflow, Browser, and other resources require live availability checks before enablement."
 ]
},indent=2))
sys.exit(0 if passed else 1)
