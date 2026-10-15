import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {createResearchQuantity,listResearchQuantities} from "./api";
import {input,record} from "@/test/fixtures/research-quantity";
const context={workspaceId:"workspace-a",expectedUserId:"user-a"};
afterEach(()=>vi.unstubAllGlobals());
function response(value:unknown){const fetch=vi.fn(async()=>new Response(JSON.stringify(value)));vi.stubGlobal("fetch",fetch);return fetch;}
it("sends canonical source locator input and recovers JSONB-ordered receipts",async()=>{
  const fetch=response({...record,input:{unit_span:input.unit_span,value_span:input.value_span,original_content_hash:input.original_content_hash,chunk_index:0,version_id:input.version_id,document_id:input.document_id}});
  await expect(createResearchQuantity("plan-a",input,"same-key",context)).resolves.toMatchObject({id:record.id});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/quantities"),expect.objectContaining({body:JSON.stringify(input),headers:expect.objectContaining({"Idempotency-Key":"same-key"})}));
});
it("requires persisted and matching capture identity before reporting a save",async()=>{
  response({...record,persistence_state:"NOT_PERSISTED"});await expect(createResearchQuantity("plan-a",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
  response({...record,input:{...input,chunk_index:1}});await expect(createResearchQuantity("plan-a",input,"same-key",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
it("pages stored captures without treating unavailable source as usable input",async()=>{
  const unavailable={...record,source_state:"SOURCE_UNAVAILABLE",freshness:"unavailable",quantity:null,source:null};const fetch=response({items:[unavailable],next_after:null});
  await expect(listResearchQuantities("plan-a",context,"cursor-a")).resolves.toMatchObject({items:[{quantity:null}]});
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("after=cursor-a"),expect.anything());
});
