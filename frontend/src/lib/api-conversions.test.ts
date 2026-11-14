import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {createResearchConversion,listResearchConversions} from "./api";
const input={quantity:{value:"1.005",unit:"kg",evidence_ids:["a"]},factor:"1000",target_unit:"g",conversion_evidence_id:"factor-a",factor_effective_on:null,precision:2};
const row={id:"result-a",plan_id:"plan-a",input:{precision:2,factor_effective_on:null,conversion_evidence_id:"factor-a",target_unit:"g",factor:"1000",quantity:input.quantity},
  result:{operation:"CONVERT_UNIT",value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:["a","factor-a"],precision:2,rounding:"ROUND_HALF_EVEN"},
  schema_version:"research-conversion/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
const context={workspaceId:"workspace-a",expectedUserId:"user-a"};
afterEach(()=>vi.unstubAllGlobals());
function respond(value:unknown){const fetch=vi.fn(async()=>new Response(JSON.stringify(value)));vi.stubGlobal("fetch",fetch);return fetch;}
it("sends exact decimal strings and stable retry key despite JSONB key order",async()=>{
  const fetch=respond(row);await expect(createResearchConversion("plan-a",input,"same-key",context)).resolves.toEqual(row);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/conversions"),expect.objectContaining({body:JSON.stringify(input),headers:expect.objectContaining({"Idempotency-Key":"same-key"})}));
});
it("rejects unconfirmed persistence or a changed stored factor date",async()=>{
  respond({...row,persistence_state:"NOT_PERSISTED"});await expect(createResearchConversion("plan-a",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
  respond({...row,input:{...row.input,factor_effective_on:"2026-10-15"}});await expect(createResearchConversion("plan-a",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
it("pages confirmed stored conversions and rejects invalid listed rows",async()=>{
  const fetch=respond({items:[row],next_after:null});await expect(listResearchConversions("plan-a",context,"cursor-a")).resolves.toEqual({items:[row],next_after:null});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("after=cursor-a"),expect.anything());respond({items:[{...row,plan_id:"other"}],next_after:null});
  await expect(listResearchConversions("plan-a",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
