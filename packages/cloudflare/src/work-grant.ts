const encoder=new TextEncoder();
const decoder=new TextDecoder();
export interface WorkGrant { v:1; environment:string; workspaceId:string; resourceId:string; operation:string; lifecycleEpoch:number; leaseGeneration:number; expiresAt:number; nonce:string }
function b64url(bytes:Uint8Array):string { return Buffer.from(bytes).toString("base64url"); }
function parse64(value:string):Uint8Array { return new Uint8Array(Buffer.from(value,"base64url")); }
async function key(secret:string){ if(secret.length<32) throw new Error("CONFIGURATION_ERROR"); return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]); }
export async function signGrant(grant:WorkGrant,secret:string):Promise<string>{
  const body=b64url(encoder.encode(JSON.stringify(grant)));
  const signature=new Uint8Array(await crypto.subtle.sign("HMAC",await key(secret),encoder.encode(body)));
  return `${body}.${b64url(signature)}`;
}
export async function verifyGrant(token:string,secret:string,expectedEnvironment:string,now=Date.now()):Promise<Readonly<WorkGrant>>{
  const [body,sig,...rest]=token.split("."); if(!body||!sig||rest.length) throw new Error("FORBIDDEN");
  const valid=await crypto.subtle.verify("HMAC",await key(secret),parse64(sig),encoder.encode(body)); if(!valid) throw new Error("FORBIDDEN");
  const grant=JSON.parse(decoder.decode(parse64(body))) as WorkGrant;
  if(grant.v!==1||grant.environment!==expectedEnvironment||grant.expiresAt<=now||grant.expiresAt>now+15*60_000||grant.lifecycleEpoch<0||grant.leaseGeneration<1) throw new Error("FORBIDDEN");
  return Object.freeze(grant);
}
