import {afterEach,expect,it,vi} from "vitest";
import {createHash,webcrypto} from "node:crypto";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {createFindingPackage} from "./api";
const id="33333333-3333-4333-8333-333333333333",workspace="11111111-1111-4111-8111-111111111111",pid="44444444-4444-4444-8444-444444444444";
const context={workspaceId:workspace,expectedUserId:"synthetic-actor"};
const manifest_text=JSON.stringify({"@id":`urn:nexusrag:finding:${id}:3`,format:"nexusrag-finding-package/1",finding_id:id,workspace_id:workspace,revision:3,
  "@context":{"@version":1.1},"@type":"prov:Entity",claim_state:"HUMAN_REVIEWED_NOT_CERTIFICATION",evidence:[{original_text:"Synthetic"}],reviews:[{decision:"approved"}],"@included":[{"@id":`urn:nexusrag:version:${pid}`}],analysis:{answer:"Synthetic"}});
const receipt={schema_version:"finding-package-receipt/1",id:pid,workspace_id:workspace,finding_id:id,finding_revision:3,state:"ready",manifest_hash:createHash("sha256").update(manifest_text).digest("hex"),
  manifest_bytes:Buffer.byteLength(manifest_text),serialization:"POSTGRES_JSONB_TEXT_UTF8/1",created_at:"2026-10-25T00:00:00Z",requested_by:id,reason:null};
const complete={...receipt,schema_version:"finding-package/1",manifest_text};
afterEach(()=>vi.unstubAllGlobals());
function peer(metadata:unknown,artifact:unknown){vi.stubGlobal("crypto",webcrypto);const mock=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(metadata)))
  .mockResolvedValueOnce(new Response(JSON.stringify(artifact)));vi.stubGlobal("fetch",mock);return mock;}
it("confirms the small durable receipt then the exact streamed artifact before successful creation",async()=>{
  const fetch=peer(receipt,complete);await expect(createFindingPackage(id,3,"stable-intent",context)).resolves.toEqual(complete);
  expect(fetch.mock.calls[0][1]).toMatchObject({method:"POST",headers:{"Idempotency-Key":"stable-intent"}});
  expect(fetch.mock.calls[1][0]).toBe(`https://gateway.invalid/api/v2/findings/${id}/packages/${pid}`);
});
it.each(["manifest_hash","manifest_bytes","finding_revision"])("does not confirm an export whose %s differs from its saved receipt",async field=>{
  const altered={...complete,[field]:field==="manifest_hash"?"a".repeat(64):999};peer(receipt,altered);
  await expect(createFindingPackage(id,3,"stable-intent",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
it("rejects an incomplete receipt without reading any artifact",async()=>{
  const fetch=peer({...receipt,manifest_hash:"missing"},complete);
  await expect(createFindingPackage(id,3,"stable-intent",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not equate a valid artifact hash with a different create-receipt hash",async()=>{
  peer({...receipt,manifest_hash:"a".repeat(64)},complete);
  await expect(createFindingPackage(id,3,"stable-intent",context)).rejects.toMatchObject({code:"PERSISTENCE_UNCONFIRMED"});
});
