import { afterEach, expect, it, vi } from "vitest";
const getApiHeaders = vi.hoisted(() => vi.fn(async () => ({ Authorization: "Bearer synthetic" })));
vi.mock("@/lib/api-context", () => ({ getApiHeaders }));
vi.mock("@/lib/backend-url", () => ({ buildBackendUrl: (path: string) => `https://gateway.invalid${path}` }));
import { createResearchPlan, listResearchPlans, readResearchPlan, listResearchRuns, researchRunCommand,createResearchFinding } from "./api";
import { emptyResearchPlan, modeLimits } from "./research-plan";
const plan = { ...emptyResearchPlan(), question: "Synthetic plan", completion_criteria: ["Inspect source"] };
const record = { id: "33333333-3333-4333-8333-333333333333", workspace_id: "workspace-a", owner_id: "user-a",
  plan, limits: modeLimits.QUICK_LOOKUP, schema_version: "research-plan/1", state: "planned", persistence_state: "PERSISTED", execution_supported: false };
const context = {workspaceId: "workspace-a", expectedUserId: "user-a"};
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function respond(value: unknown) { const fetch=vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { void input; void init; return new Response(JSON.stringify(value)); }); vi.stubGlobal("fetch",fetch); return fetch; }
it("sends a stable create key and preserves all draft fields", async () => {
  const fetch=respond(record);
  await expect(createResearchPlan(plan,"same-key",context)).resolves.toEqual(record);
  expect(getApiHeaders).toHaveBeenCalledWith(context);
  expect(fetch.mock.calls[0][1]).toMatchObject({method: "POST", headers: {"Idempotency-Key": "same-key"}, body: JSON.stringify(plan)});
});
it.each([null, {}, {...record, execution_supported: true}, {...record, plan: {...plan, subquestions: null}}, {...record, limits: {...record.limits, max_sources: 100}}])(
  "does not report unconfirmed plan persistence for %j", async value => {
    respond(value);
    await expect(createResearchPlan(plan,"same-key",context)).rejects.toMatchObject({code: "PERSISTENCE_UNCONFIRMED"});
  });
it("encodes the read path and rejects incomplete pagination", async () => {
  const fetch=respond(record);
  await readResearchPlan("id/with space",context);
  expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v2/research/plans/id%2Fwith%20space");
  respond({items: [record]});
  await expect(listResearchPlans(context)).rejects.toMatchObject({code: "PERSISTENCE_UNCONFIRMED"});
});
it("creates and reloads run receipts without a chat-session identifier",async()=>{
  const id=record.id,run={id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",state:"queued",generation:1,
    position:0,questions:["Synthetic question?"],results:[],source_state:"CURRENT",error_code:null,created_at:"2026-10-15T00:00:00Z"};
  const fetch=respond(run);
  await expect(researchRunCommand(id,context,"create",undefined,"stable-run-key")).resolves.toEqual(run);
  expect(fetch.mock.calls[0][1]).toMatchObject({method:"POST",headers:{"Idempotency-Key":"stable-run-key"},body:JSON.stringify({non_sensitive_attested:true})});
  respond({items:[run],next_after:null});
  await expect(listResearchRuns(id,context)).resolves.toMatchObject({items:[run]});
  respond({...run,state:"completed"});
  await expect(researchRunCommand(id,context,"read",id)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
it("saves only a typed reference to the stored research answer, never a copied caller answer",async()=>{
  const finding={id:record.id,workspace_id:context.workspaceId,source_research_run_id:record.id,source_research_position:0};
  const fetch=respond(finding);await expect(createResearchFinding("Saved answer",record.id,0,"stable-intent",context)).resolves.toEqual(finding);
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({title:"Saved answer",research_run_id:record.id,result_index:0,authored_markdown:""});
  expect(fetch.mock.calls[0][1]).toMatchObject({headers:{"Idempotency-Key":"stable-intent"}});
  respond({...finding,source_research_run_id:null});
  await expect(createResearchFinding("Saved answer",record.id,0,"stable-intent",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
  respond({...finding,source_research_position:1});
  await expect(createResearchFinding("Saved answer",record.id,0,"stable-intent",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
