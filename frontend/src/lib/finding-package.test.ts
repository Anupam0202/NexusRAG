import {webcrypto,createHash} from "node:crypto";
import {afterEach,describe,expect,it,vi} from "vitest";
import {confirmedFindingPackage,findingPackageDownload,type FindingPackage} from "./finding-package";
const fid="33333333-3333-4333-8333-333333333333",ws="11111111-1111-4111-8111-111111111111";
function fixture():FindingPackage {
  const manifest_text=JSON.stringify({"@context":{"@version":1.1,"@vocab":"https://nexusrag.app/ns/"},"@id":`urn:nexusrag:finding:${fid}:3`,"@type":"prov:Entity",
    claim_state:"HUMAN_REVIEWED_NOT_CERTIFICATION",evidence:[{original_text:"Synthetic fixture"}],reviews:[{decision:"approved"}],"@included":[{"@id":`urn:nexusrag:version:${ws}`}],
    format:"nexusrag-finding-package/1",finding_id:fid,workspace_id:ws,revision:3,analysis:{answer:"1.005 kg; qualified, not certified"}});
  return {schema_version:"finding-package/1",id:"44444444-4444-4444-8444-444444444444",workspace_id:ws,finding_id:fid,finding_revision:3,
    serialization:"POSTGRES_JSONB_TEXT_UTF8/1",manifest_hash:createHash("sha256").update(manifest_text).digest("hex"),
    manifest_bytes:new TextEncoder().encode(manifest_text).length,manifest_text,created_at:"2026-10-25T00:00:00Z",requested_by:fid,state:"ready",reason:null};
}
afterEach(()=>vi.unstubAllGlobals());
describe("exact saved evidence packages",()=>{
  it("retains exact hashed bytes plus a nested JSON-LD manifest and durable receipt",async()=>{
    vi.stubGlobal("crypto",webcrypto);const value=fixture();expect(await confirmedFindingPackage(value,fid,ws)).toBe(true);
    const downloaded=JSON.parse(findingPackageDownload(value));expect(downloaded.manifest_text).toBe(value.manifest_text);
    expect(downloaded.manifest.analysis.answer).toBe("1.005 kg; qualified, not certified");expect(downloaded.receipt.id).toBe(value.id);
    expect(downloaded.receipt.manifest_text).toBeUndefined();expect(downloaded["prov:wasDerivedFrom"]["@id"]).toBe(`urn:nexusrag:finding:${fid}:3`);
  });
  it("does not accept truncated bytes, a different finding or an unconfirmed hash",async()=>{
    vi.stubGlobal("crypto",webcrypto);const value=fixture();
    expect(await confirmedFindingPackage({...value,manifest_text:value.manifest_text+" "},fid,ws)).toBe(false);
    expect(await confirmedFindingPackage({...value,manifest_hash:"a".repeat(64)},fid,ws)).toBe(false);
    expect(await confirmedFindingPackage(value,ws,ws)).toBe(false);
  });
  it("requires expired content to be withheld and never offers its download",async()=>{
    const value=fixture();expect(await confirmedFindingPackage({...value,state:"expired",reason:"RIGHTS_BLOCKED",manifest_text:null},fid,ws)).toBe(true);
    expect(await confirmedFindingPackage({...value,state:"expired"},fid,ws)).toBe(false);
    expect(()=>findingPackageDownload({...value,state:"expired",manifest_text:null})).toThrow(/no longer available/);
  });
});
