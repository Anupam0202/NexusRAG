import { afterEach, expect, it, vi } from "vitest";
const getApiHeaders = vi.hoisted(() => vi.fn(async () => ({ Authorization: "Bearer synthetic" })));
vi.mock("@/lib/api-context", () => ({ getApiHeaders }));
vi.mock("@/lib/backend-url", () => ({ buildBackendUrl: (path: string) => `https://gateway.invalid${path}` }));
import { createResearchPlan, listResearchPlans, readResearchPlan } from "./api";
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
