import { afterEach,expect,it,vi } from "vitest";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {createResearchCalculation,listResearchCalculations} from "./api";
const input={operation:"ADD" as const,left:{value:"0.1",unit:"USD",evidence_ids:["a"]},right:{value:"0.2",unit:"USD",evidence_ids:["b"]},precision:2};
const record={id:"record",plan_id:"plan",workspace_id:"workspace",owner_id:"user",input:{precision:2,right:input.right,left:input.left,operation:"ADD"},
  result:{operation:"ADD",value:"0.30",unit:"USD",formula:"0.1+0.2",evidence_ids:["a","b"],precision:2,rounding:"ROUND_HALF_EVEN"},
  state:"calculated",schema_version:"research-calculation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
const context={workspaceId:"workspace",expectedUserId:"user"};
afterEach(()=>vi.unstubAllGlobals());
function respond(value:unknown){const fetch=vi.fn(async()=>new Response(JSON.stringify(value)));vi.stubGlobal("fetch",fetch);return fetch;}
it("accepts real JSONB key ordering and sends exact decimal text with retry identity",async()=>{
  const fetch=respond(record);await expect(createResearchCalculation("plan",input,"same-key",context)).resolves.toEqual(record);
  expect(fetch).toHaveBeenCalledWith("https://gateway.invalid/api/v2/research/plans/plan/calculations",expect.objectContaining({body:JSON.stringify(input),headers:expect.objectContaining({"Idempotency-Key":"same-key"})}));
});
it.each([null,{}, {...record,persistence_state:"NOT_PERSISTED"}, {...record,result:{...record.result,value:0.3}}, {...record,input:{...record.input,left:{...input.left,value:"1"}}}])(
  "does not fabricate confirmation for %j",async value=>{respond(value);await expect(createResearchCalculation("plan",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});});
it("validates stored result lists",async()=>{respond({items:[record]});await expect(listResearchCalculations("plan",context)).resolves.toEqual({items:[record]});
  respond({items:[{...record,plan_id:"other"}]});await expect(listResearchCalculations("plan",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});});
