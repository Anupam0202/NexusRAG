const encoder=new TextEncoder();
function stable(value:unknown):string {
  if(value===null||typeof value!=="object") return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record=value as Record<string,unknown>;
  return `{${Object.keys(record).sort().map(k=>`${JSON.stringify(k)}:${stable(record[k])}`).join(",")}}`;
}
export async function payloadHash(value:unknown):Promise<string>{
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(stable(value)));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}
export function idempotencyScope(workspaceId:string,actorId:string,operation:string,key:string):string {
  if(!key||key.length>200||!operation) throw new Error("INVALID_IDEMPOTENCY_KEY");
  return [workspaceId,actorId,operation,key].join(":");
}
