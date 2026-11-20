import limits from "./finding-package-limits.json" with {type:"json"};
export interface FindingExportPolicy {
  decision:"ALLOW"|"DENY"|"REVIEW_REQUIRED"|"REVOKED";
  basis:"OWNED_CONTENT"|"LICENSE"|"PERMISSION"|"PUBLIC_DOMAIN"|"UNKNOWN";
  rationale:string;evidence_reference:string;attribution:string;duties:string[];review_by:string|null;
}
export interface FindingExportRights {
  schema_version:"finding-export-rights/1";finding_id:string;revision:number;can_review:boolean;eligible:boolean;reason:string;
  items:Array<{version_id:string;document_id:string;filename:string;original_hash:string;review_id:string|null;
    actor_id:string|null;created_at:string|null;policy:FindingExportPolicy|null;allowed:boolean}>;
}
export interface FindingPackage {
  schema_version:"finding-package/1";id:string;workspace_id:string;finding_id:string;finding_revision:number;
  serialization:"POSTGRES_JSONB_TEXT_UTF8/1";manifest_hash:string;manifest_bytes:number;created_at:string;requested_by:string;
  state:"ready"|"expired";reason:string|null;manifest_text:string|null;
}
export type FindingPackageReceipt=Omit<FindingPackage,"schema_version"|"manifest_text">&{schema_version:"finding-package-receipt/1"};
const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function confirmedPackageSummary(value:Omit<FindingPackage,"manifest_text"|"schema_version">,id:string,workspace:string|null|undefined):boolean {
  return !!value&&uuid.test(value.id)&&value.finding_id===id&&value.workspace_id===workspace&&Number.isSafeInteger(value.finding_revision)&&value.finding_revision>0
    &&["ready","expired"].includes(value.state)&&value.serialization==="POSTGRES_JSONB_TEXT_UTF8/1"
    &&/^[a-f0-9]{64}$/.test(value.manifest_hash)&&Number.isSafeInteger(value.manifest_bytes)&&value.manifest_bytes>0
    &&value.manifest_bytes<=limits.max_manifest_bytes&&uuid.test(value.requested_by)&&typeof value.created_at==="string"&&Number.isFinite(Date.parse(value.created_at))
    &&(value.state==="ready"?value.reason===null:typeof value.reason==="string"&&value.reason.length>0);
}
export function confirmedPackageReceipt(value:FindingPackageReceipt,id:string,workspace:string|null|undefined,revision:number):boolean {
  return !!value&&value.schema_version==="finding-package-receipt/1"&&confirmedPackageSummary(value,id,workspace)
    &&value.finding_revision===revision&&!Object.hasOwn(value,"manifest_text");
}
export function confirmedExportRights(value:FindingExportRights,id:string):boolean {
  return !!value&&value.schema_version==="finding-export-rights/1"&&value.finding_id===id&&Number.isSafeInteger(value.revision)&&value.revision>0
    &&typeof value.can_review==="boolean"&&typeof value.eligible==="boolean"&&Array.isArray(value.items)&&value.items.length>0&&value.items.length<=60
    &&value.eligible===value.items.every(row=>row.allowed)
    &&value.items.every(row=>uuid.test(row.version_id)&&uuid.test(row.document_id)&&typeof row.filename==="string"
      &&/^[a-f0-9]{64}$/.test(row.original_hash)&&typeof row.allowed==="boolean"&&(row.review_id===null||uuid.test(row.review_id))
      &&(row.review_id===null?row.policy===null&&!row.allowed:!!row.policy&&["ALLOW","DENY","REVIEW_REQUIRED","REVOKED"].includes(row.policy.decision)
        &&["OWNED_CONTENT","LICENSE","PERMISSION","PUBLIC_DOMAIN","UNKNOWN"].includes(row.policy.basis)
        &&typeof row.policy.rationale==="string"&&typeof row.policy.evidence_reference==="string"&&typeof row.policy.attribution==="string"
        &&Array.isArray(row.policy.duties)&&row.policy.duties.every(duty=>typeof duty==="string")
        &&(row.policy.review_by===null||typeof row.policy.review_by==="string"&&Number.isFinite(Date.parse(row.policy.review_by))))
      &&(!row.allowed||row.policy?.decision==="ALLOW"));
}
export async function confirmedFindingPackage(value:FindingPackage,findingId:string,workspaceId:string|null|undefined):Promise<boolean> {
  if(!value||value.schema_version!=="finding-package/1"||!confirmedPackageSummary(value,findingId,workspaceId))return false;
  if(value.state==="expired")return value.manifest_text===null;
  if(value.state!=="ready"||typeof value.manifest_text!=="string")return false;
  const bytes=new TextEncoder().encode(value.manifest_text);
  if(bytes.length!==value.manifest_bytes||bytes.length>limits.max_manifest_bytes)return false;
  try {
    const manifest=JSON.parse(value.manifest_text);
    if(manifest.format!=="nexusrag-finding-package/1"||manifest.finding_id!==findingId||manifest.workspace_id!==workspaceId
      ||manifest.revision!==value.finding_revision||manifest["@id"]!==`urn:nexusrag:finding:${findingId}:${value.finding_revision}`
      ||manifest["@context"]?.["@version"]!==1.1||manifest["@type"]!=="prov:Entity"||manifest.claim_state!=="HUMAN_REVIEWED_NOT_CERTIFICATION"
      ||!Array.isArray(manifest.evidence)||manifest.evidence.length<1||!Array.isArray(manifest.reviews)||manifest.reviews.length<1
      ||!Array.isArray(manifest["@included"])||manifest["@included"].length<1||!Object.hasOwn(manifest,"analysis"))return false;
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
    return hash===value.manifest_hash;
  }catch{return false;}
}
export function findingPackageDownload(value:FindingPackage):string {
  if(value.state!=="ready"||value.manifest_text===null)throw new Error("This evidence package is no longer available for download.");
  return JSON.stringify({"@context":{"@version":1.1,"@vocab":"https://nexusrag.app/ns/","prov":"http://www.w3.org/ns/prov#",
    receipt:{"@id":"https://nexusrag.app/ns/receipt","@type":"@json"}},"@id":`urn:nexusrag:export:${value.id}`,"@type":"prov:Entity",
    "prov:wasDerivedFrom":{"@id":`urn:nexusrag:finding:${value.finding_id}:${value.finding_revision}`},
    manifest:JSON.parse(value.manifest_text),manifest_text:value.manifest_text,manifest_hash:value.manifest_hash,
    serialization:value.serialization,receipt:{...value,manifest_text:undefined}},null,2);
}
