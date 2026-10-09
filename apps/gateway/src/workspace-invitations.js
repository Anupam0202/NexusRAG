// Service-mediated, recipient-bound codes. Never place codes in URLs or logs.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const invalid = () => Object.assign(new Error("Choose a valid invitation operation."), {status:422,code:"INVALID_SCOPE"});
async function body(request, allowed) {
  if (Number(request.headers.get("content-length")) > 4096) throw invalid();
  const reader=request.body?.getReader();
  if (!reader) throw invalid();
  let size=0,timer;
  const chunks=[];
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("Invitation request timed out. Retry with the same code."),{status:408,code:"REQUEST_TIMEOUT"})),5000);});
  try {
    for (;;) {
      const {value,done}=await Promise.race([reader.read(),timeout]);
      if (done) break;
      size+=value.byteLength;
      if (size>4096) throw Object.assign(new Error("Invitation request is too large."),{status:413,code:"PAYLOAD_TOO_LARGE"});
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    // Transport cancellation is best effort. A stalled cancel hook must not
    // extend the request's size/deadline bound or prevent a safe denial.
    void reader.cancel().catch(()=>{});
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const text=new TextDecoder().decode(bytes);
  let value;
  try { value = JSON.parse(text); } catch { throw invalid(); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw invalid();
  return value;
}
async function hash(code) {
  if (typeof code !== 'string' || !CODE.test(code)) throw invalid();
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function handleInvitations(args) {
  const {request,env,user,serviceRequest,membership,workspaceId,json,fail} = args;
  const url=new URL(request.url),accept=url.pathname==='/api/v1/workspaces/invitations/accept',capabilities=url.pathname==='/api/v1/workspaces/invitations/capabilities';
  const match=url.pathname.match(/^\/api\/v1\/workspaces\/current\/invitations(?:\/([0-9a-f-]{36}))?$/i);
  if (!accept && !capabilities && !match) return null;
  if ((capabilities && request.method!=='GET') || (accept && request.method!=='POST') || (!accept && !capabilities && !(match[1] ? request.method==='DELETE' : ['GET','POST'].includes(request.method))))
    return fail(request,env,'INVALID_SCOPE','This invitation method is not available.',405);
  const workspace=accept||capabilities?null:workspaceId(request);
  if (!accept && !capabilities) {
    const member=await membership(env,user.id,workspace);
    if (!['owner','admin'].includes(member.role)) return fail(request,env,'FORBIDDEN','Invitation management requires an owner or administrator.',403);
  }
  try {
    const version=await serviceRequest(env,'rpc/nexus_invitation_version',{method:'POST',body:'{}'});
    if (version?.version!=='040' || version.recipient_bound!==true || version.manual_delivery!==true)
      return capabilities ? json(request,env,{invitation_supported:false,state:'MIGRATION_REQUIRED'}) : fail(request,env,'MIGRATION_REQUIRED','Recipient-bound invitations require verified migration 040.',503);
    if (capabilities) return json(request,env,{invitation_supported:true,schema_version:'040',delivery:'MANUAL_ONE_TIME_CODE'});
    let name='nexus_workspace_invitation',values;
    if (accept) {
      const value=await body(request,['token']);
      values={p_actor:user.id,p_token_hash:await hash(value.token)};
      name='nexus_accept_workspace_invitation';
    } else {
      let command={},operation;
      if (request.method==='GET') {
        operation='list';const text=url.searchParams.get('limit')??'50',after=url.searchParams.get('after');
        if (!/^[1-9][0-9]{0,2}$/.test(text) || Number(text)>100 || (after!==null&&!UUID.test(after))) throw invalid();
        command={limit:Number(text),...(after?{after}:{})};
      } else if (request.method==='DELETE') {
        if (!UUID.test(match[1])) throw invalid();
        operation='revoke';
      } else {
        operation='create';const value=await body(request,['recipient_email','role','token','idempotency_key']);
        if (typeof value.recipient_email!=='string'||value.recipient_email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(value.recipient_email.trim())
          || !['admin','editor','viewer'].includes(value.role) || typeof value.idempotency_key!=='string'||value.idempotency_key.length<1||value.idempotency_key.length>128) throw invalid();
        command={recipient_email:value.recipient_email.trim().toLowerCase(),role:value.role,token_hash:await hash(value.token),idempotency_key:value.idempotency_key};
      }
      values={p_workspace:workspace,p_actor:user.id,p_operation:operation,p_invitation:match[1]??null,p_command:command};
    }
    const result=await serviceRequest(env,`rpc/${name}`,{method:'POST',body:JSON.stringify(values)});
    if (result?.schema_version!=='040') return fail(request,env,'PERSISTENCE_UNAVAILABLE','The invitation outcome could not be verified. Refresh invitations before retrying.',503);
    return json(request,env,result,!accept&&request.method==='POST'?201:200);
  } catch(error) {
    if (['TimeoutError','AbortError','TypeError'].includes(error?.name) && typeof error?.code !== 'string')
      return fail(request,env,'PERSISTENCE_UNAVAILABLE','Invitation outcome is unknown. Refresh and retry with the same code; do not create a replacement yet.',503,true);
    if (error?.code==='TENANT_QUOTA_EXCEEDED') error.status=429;
    if (error?.code==='PERSISTENCE_UNAVAILABLE'&&['PGRST202','42883'].includes(error.storageCode))
      return capabilities ? json(request,env,{invitation_supported:false,state:'MIGRATION_REQUIRED'}) : fail(request,env,'MIGRATION_REQUIRED','Recipient-bound invitation storage is unavailable. Verify migration 040.',503);
    throw error;
  }
}
