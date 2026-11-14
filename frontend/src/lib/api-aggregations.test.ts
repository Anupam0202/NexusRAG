import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {createResearchAggregation,listResearchAggregations} from "./api";
const input={operation:"SUM" as const,values:[{value:"0.1",unit:"USD",evidence_ids:["a"]}],weights:[],precision:2,missing_value_treatment:"REJECT" as const,grouped:false};
const record={id:"saved-a",plan_id:"plan-a",input:{grouped:false,precision:2,operation:"SUM",values:input.values,weights:[],missing_value_treatment:"REJECT"},
  result:{operation:"SUM",groups:[{group:null,value:"0.10",rows:[],unit:"USD",expression:"sum(0.1)",evidence_ids:["a"],total_count:1,included_count:1,excluded_count:0,excluded_input_indices:[],value_display:"ROUND_HALF_EVEN"}],precision:2,rounding:"ROUND_HALF_EVEN",missing_value_treatment:"REJECT"},
  schema_version:"research-aggregation/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED"};
const context={workspaceId:"workspace-a",expectedUserId:"user-a"};
afterEach(()=>vi.unstubAllGlobals());
function respond(value:unknown){const fetch=vi.fn(async()=>new Response(JSON.stringify(value)));vi.stubGlobal("fetch",fetch);return fetch;}
it("preserves decimal strings and retry key despite JSONB field order",async()=>{
  const fetch=respond(record);await expect(createResearchAggregation("plan-a",input,"same-key",context)).resolves.toEqual(record);
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/aggregations"),expect.objectContaining({headers:expect.objectContaining({"Idempotency-Key":"same-key"}),body:JSON.stringify(input)}));
});
it.each([null,{}, {...record,persistence_state:"NOT_PERSISTED"}, {...record,input:{...record.input,precision:4}}])("does not report unconfirmed execution as saved %j",async value=>{
  respond(value);await expect(createResearchAggregation("plan-a",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
it("reloads and pages confirmed results and rejects malformed rows",async()=>{
  const fetch=respond({items:[record],next_after:null});await expect(listResearchAggregations("plan-a",context,"cursor-a")).resolves.toEqual({items:[record],next_after:null});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("after=cursor-a"),expect.anything());respond({items:[{...record,plan_id:"other"}],next_after:null});
  await expect(listResearchAggregations("plan-a",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
