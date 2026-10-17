import test from "node:test";
import assert from "node:assert/strict";
import { RESEARCH_MODE_LIMITS, validateResearchPlan } from "../../apps/gateway/src/research-plans.js";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333", policy = "44444444-4444-4444-8444-444444444444";
const plan = { plan_id: planId, mode: "QUICK_LOOKUP", question: "What is the synthetic policy retention period?",
  private_source_ids: ["document-one"], completion_criteria: ["Inspect the exact source paragraph."] };

for (const mode of Object.keys(RESEARCH_MODE_LIMITS)) test(`research input preserves the accepted ${mode} limits and plan fields`, () => {
  const result = validateResearchPlan({ ...plan, mode });
  assert.equal(result.plan.mode, mode);
  assert.deepEqual(result.plan.private_source_ids, ["document-one"]);
  assert.deepEqual(result.limits, RESEARCH_MODE_LIMITS[mode]);
  result.plan.private_source_ids.push("separate-copy");
  assert.deepEqual(plan.private_source_ids, ["document-one"]);
});
test("research planning validates real calendar scope and completion criteria", () => {
  for (const input of [{ ...plan, date_from: "2026-02-30" }, { ...plan, date_from: "2026-10-15", date_to: "2026-10-14" },
    { ...plan, completion_criteria: [] }]) assert.throws(() => validateResearchPlan(input), error => error.code === "INVALID_RESEARCH_PLAN");
  assert.equal(validateResearchPlan({ ...plan, date_from: "2024-02-29" }).plan.date_from, "2024-02-29");
});
test("research planning retains combined source limits and public rights constraints", () => {
  assert.throws(() => validateResearchPlan({ ...plan, public_provider_ids: ["official-provider"] }), /rights constraints/);
  assert.throws(() => validateResearchPlan({ ...plan, private_source_ids: Array(5).fill("private"),
    public_provider_ids: Array(4).fill("public"), rights_constraints: ["Approved metadata only"] }), /Combined source limit/);
});

function fixture(t, options = {}) {
  const saved = new Map();
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input), json = value => new Response(JSON.stringify(value), { status: 200 });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "editor" }]);
    if (url.pathname === "/rest/v1/workspaces") return json([{ lifecycle_state: "active", capability_revision: 1 }]);
    if (url.pathname === "/rest/v1/workspace_settings") return json([{ active_policy_id: policy, policy_version: 1 }]);
    if (url.pathname === "/rest/v1/rpc/nexus_research_plan") {
      const data = JSON.parse(init.body);
      if (options.rpc) return options.rpc(data, json);
      if (data.p_operation === "create" && !saved.has(planId)) saved.set(planId, { plan: Object.fromEntries(Object.entries(data.p_plan).reverse()), id: planId,
        workspace_id: workspace, owner_id: user, state: "planned", persistence_state: "PERSISTED", execution_supported: false,
        schema_version: "research-plan/1", limits: RESEARCH_MODE_LIMITS[data.p_plan.mode] });
      return json(data.p_operation === "list" ? { items: [...saved.values()], next_after: null } : saved.get(planId));
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  });
  return { saved, env: { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" } };
}

test("ordinary research plan creation returns a durable receipt and can be listed after creation", async t => {
  const { env, saved } = fixture(t);
  const headers = { authorization: "Bearer synthetic", "x-workspace-id": workspace, "content-type": "application/json", "idempotency-key": "synthetic-plan-creation" };
  const created = await handle(new Request("https://gateway.invalid/api/v2/research/plans", { method: "POST", headers, body: JSON.stringify(plan) }), env);
  assert.equal(created.status, 201);
  const receipt = await created.json();
  assert.equal(receipt.persistence_state, "PERSISTED");
  assert.equal(saved.size, 1);
  const response = await handle(new Request("https://gateway.invalid/api/v2/research/plans", { headers }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).items[0].plan.question, plan.question);
  const retry = await handle(new Request("https://gateway.invalid/api/v2/research/plans", { method: "POST", headers, body: JSON.stringify(plan) }), env);
  assert.equal(retry.status, 201);
  assert.equal(saved.size, 1);
});

const headers = { authorization: "Bearer synthetic", "x-workspace-id": workspace, "content-type": "application/json", "idempotency-key": "synthetic-plan-creation" };
test("a stored plan survives ordinary JSONB key ordering and can be read by ID", async t => {
  const { env }=fixture(t);
  const create=await handle(new Request("https://gateway.invalid/api/v2/research/plans",{method:"POST",headers,body:JSON.stringify(plan)}),env);
  assert.equal(create.status,201);
  const read=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${planId}`,{headers}),env);
  assert.equal(read.status,200);
  assert.equal((await read.json()).plan.plan_id,planId);
});
for (const value of [null, {}, {schema_version:"research-plan/1",persistence_state:"PERSISTED"}]) test(`an incomplete storage receipt ${JSON.stringify(value)} cannot report success`, async t => {
  const {env}=fixture(t,{rpc:(_data,json)=>json(value)});
  const result=await handle(new Request("https://gateway.invalid/api/v2/research/plans",{method:"POST",headers,body:JSON.stringify(plan)}),env);
  assert.equal(result.status,503);
  assert.equal((await result.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
test("an absent reviewed migration returns an actionable functional error", async t => {
  const {env}=fixture(t,{rpc:()=>new Response(JSON.stringify({code:"PGRST202",message:"missing RPC"}),{status:404})});
  const result=await handle(new Request("https://gateway.invalid/api/v2/research/plans",{headers}),env);
  assert.equal(result.status,503);
  assert.equal((await result.json()).error.code,"MIGRATION_REQUIRED");
});
test("unknown stored plan is unavailable rather than falsely saved", async t => {
  const {env}=fixture(t,{rpc:()=>new Response(JSON.stringify({code:"P0001",message:"NR:NOT_FOUND"}),{status:400})});
  const result=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${planId}`,{headers}),env);
  assert.equal(result.status,404);
  assert.equal((await result.json()).error.code,"NOT_FOUND");
});
test("the ordinary draft storage bound has a clear retry-free capacity message", async t => {
  const {env}=fixture(t,{rpc:()=>new Response(JSON.stringify({code:"P0001",message:"NR:TENANT_QUOTA_EXCEEDED"}),{status:400})});
  const result=await handle(new Request("https://gateway.invalid/api/v2/research/plans",{method:"POST",headers,body:JSON.stringify(plan)}),env);
  assert.equal(result.status,429);
  assert.match((await result.json()).error.message,/draft-plan storage limit/);
});
