export interface PointIdentityInput {
  environment:string; workspaceId:string; documentId:string; versionId:string;
  chunkOrdinal:number; chunkId:string; originalContentHash:string; embeddingFingerprint:string; indexGeneration:string;
}
const encoder=new TextEncoder();
function hex(bytes:ArrayBuffer):string { return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join(""); }
export function canonicalPointMaterial(v:PointIdentityInput):string {
  if(!Number.isSafeInteger(v.chunkOrdinal)||v.chunkOrdinal<0) throw new Error("INVALID_CHUNK_ORDINAL");
  const parts=[v.environment,v.workspaceId,v.documentId,v.versionId,String(v.chunkOrdinal),v.chunkId,v.originalContentHash,v.embeddingFingerprint,v.indexGeneration];
  if(parts.some(x=>!x||x.includes("\u001f"))) throw new Error("INVALID_POINT_IDENTITY");
  return parts.join("\u001f");
}
export async function canonicalPointId(v:PointIdentityInput):Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256",encoder.encode(canonicalPointMaterial(v))));
}
