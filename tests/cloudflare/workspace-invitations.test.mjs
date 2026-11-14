import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../apps/gateway/src/preview-worker.js';
const actor='22222222-2222-4222-8222-222222222222',ws='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333';
const token='a'.repeat(43),env={SUPABASE_URL:'https://supabase.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret'};
function request(path,method='GET',body,bind=true){return new Request('https://gateway.invalid'+path,{method,headers:{authorization:'Bearer synthetic',...(bind?{'x-nexus-workspace-id':ws}:{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
function fixture(t,{role='owner',supported=true,denial=null}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const u=new URL(url),body=init.body?JSON.parse(init.body):null;calls.push({u,body});
  if(u.pathname==='/auth/v1/user')return Response.json({id:actor});
  if(u.pathname==='/rest/v1/workspace_members')return Response.json([{user_id:actor,workspace_id:ws,role}]);
  if(u.pathname==='/rest/v1/workspaces')return Response.json([{id:ws,lifecycle_state:'active'}]);
  if(u.pathname==='/rest/v1/rpc/nexus_invitation_version')return supported?Response.json({version:'040',recipient_bound:true,manual_delivery:true}):Response.json({code:'PGRST202',message:'unknown function'},{status:404});
  if(u.pathname==='/rest/v1/rpc/nexus_workspace_invitation'){
   if(denial)return Response.json({message:`NR:${denial}`},{status:400});
   return Response.json(body.p_operation==='list'?{schema_version:'040',invitations:[],total:0,total_is_exact:true,next_after:null}:{schema_version:'040',id,state:body.p_operation==='create'?'pending':'revoked'});
  }
  if(u.pathname==='/rest/v1/rpc/nexus_accept_workspace_invitation'){
   if(denial)return Response.json({message:`NR:${denial}`},{status:400});
   return Response.json({schema_version:'040',accepted:true,workspace_id:ws,role:'viewer'});
  }
  throw Error('Unexpected service path');
 });return calls;
}
test('invitation create derives actor/workspace and sends only a SHA256 code hash to storage',async t=>{
 const calls=fixture(t),response=await handle(request('/api/v1/workspaces/current/invitations','POST',{recipient_email:' Person@Example.invalid ',role:'viewer',token,idempotency_key:'same-request'}),env);
 assert.equal(response.status,201);const call=calls.find(c=>c.u.pathname.endsWith('/nexus_workspace_invitation'));
 assert.equal(call.body.p_actor,actor);assert.equal(call.body.p_workspace,ws);assert.equal(call.body.p_command.recipient_email,'person@example.invalid');
 assert.match(call.body.p_command.token_hash,/^[0-9a-f]{64}$/);assert.notEqual(call.body.p_command.token_hash,token);
 assert.equal(JSON.stringify(calls.filter(c=>c.u.pathname.startsWith('/rest/'))).includes(token),false);
 assert.equal(JSON.stringify(await response.json()).includes(token),false);
});
test('recipient acceptance does not require an existing workspace and cannot choose its actor',async t=>{
 const calls=fixture(t);const response=await handle(request('/api/v1/workspaces/invitations/accept','POST',{token},false),env);
 assert.equal(response.status,200);assert.equal((await response.json()).accepted,true);
 const call=calls.find(c=>c.u.pathname.endsWith('/nexus_accept_workspace_invitation'));assert.equal(call.body.p_actor,actor);assert.match(call.body.p_token_hash,/^[0-9a-f]{64}$/);
 assert.equal(calls.some(c=>c.u.pathname.endsWith('/workspace_members')),false);
});
for(const role of ['viewer','editor'])test(`${role} cannot list/create invitations`,async t=>{
 const calls=fixture(t,{role});assert.equal((await handle(request('/api/v1/workspaces/current/invitations'),env)).status,403);assert.equal(calls.some(c=>c.u.pathname.includes('/rpc/')),false);
});
for(const body of [{token,p_actor:id},{token,workspace_id:ws},{token:'short'},{token,role:'owner'}])test(`recipient request rejects client authority and malformed code ${Object.keys(body).join(',')}`,async t=>{
 const calls=fixture(t);assert.equal((await handle(request('/api/v1/workspaces/invitations/accept','POST',body,false),env)).status,422);assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_accept_workspace_invitation')),false);
});
for(const body of [{recipient_email:'person@example.invalid',role:'owner',token,idempotency_key:'same'}, {recipient_email:'person@example.invalid',role:'viewer',token,idempotency_key:'same',p_actor:id}])test('invalid create is rejected before mutation',async t=>{
 const calls=fixture(t);assert.equal((await handle(request('/api/v1/workspaces/current/invitations','POST',body),env)).status,422);assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_workspace_invitation')),false);
});
test('missing forward schema is actionable and never performs acceptance',async t=>{
 const calls=fixture(t,{supported:false});const r=await handle(request('/api/v1/workspaces/invitations/accept','POST',{token},false),env);assert.equal(r.status,503);assert.equal((await r.json()).error.code,'MIGRATION_REQUIRED');assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_accept_workspace_invitation')),false);
});
for(const [denial,status] of [['FORBIDDEN',403],['VERSION_CONFLICT',409]])test(`atomic ${denial} is not rewritten as successful acceptance`,async t=>{
 fixture(t,{denial});const r=await handle(request('/api/v1/workspaces/invitations/accept','POST',{token},false),env);assert.equal(r.status,status);assert.equal((await r.json()).error.code,denial);
});
test('invitation cursor limits remain bounded and never reach storage mutation',async t=>{
 const calls=fixture(t);const r=await handle(request('/api/v1/workspaces/current/invitations?limit=101'),env);assert.equal(r.status,422);assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_workspace_invitation')),false);
});
test('revoke sends only the workspace-bound UUID and server actor',async t=>{
 const calls=fixture(t);const r=await handle(request(`/api/v1/workspaces/current/invitations/${id}`,'DELETE'),env);assert.equal(r.status,200);const call=calls.find(c=>c.u.pathname.endsWith('/nexus_workspace_invitation'));assert.equal(call.body.p_invitation,id);assert.equal(call.body.p_actor,actor);assert.equal(call.body.p_workspace,ws);assert.deepEqual(call.body.p_command,{});
});
test('streamed oversized invitation bodies are bounded without storage mutation',async t=>{
 const calls=fixture(t);const r=await handle(request('/api/v1/workspaces/invitations/accept','POST',{token:'x'.repeat(5000)},false),env);assert.equal(r.status,413);assert.equal((await r.json()).error.code,'PAYLOAD_TOO_LARGE');assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_accept_workspace_invitation')),false);
});
for(const supported of [true,false])test(`unbound authenticated capability requires actual schema: ${supported}`,async t=>{
 const calls=fixture(t,{supported});const r=await handle(request('/api/v1/workspaces/invitations/capabilities','GET',undefined,false),env);assert.equal(r.status,200);assert.equal((await r.json()).invitation_supported,supported);assert.equal(calls.some(c=>c.u.pathname.endsWith('/workspace_members')),false);
});
test('ambiguous storage timeout is not a successful invite or automatic replacement',async t=>{
 fixture(t);const previous=globalThis.fetch;
 t.mock.method(globalThis,'fetch',async(url,init)=>new URL(url).pathname.endsWith('/nexus_accept_workspace_invitation')?Promise.reject(new DOMException('synthetic timeout','TimeoutError')):previous(url,init));
 const r=await handle(request('/api/v1/workspaces/invitations/accept','POST',{token},false),env);assert.equal(r.status,503);const result=await r.json();assert.equal(result.error.code,'PERSISTENCE_UNAVAILABLE');assert.equal(result.error.retryable,true);assert.match(result.error.message,/same code/);
});

test('a stalled stream cancellation cannot delay oversized invitation denial',async t=>{
 const calls=fixture(t);
 const stream=new ReadableStream({
  start(controller){controller.enqueue(new Uint8Array(4097));},
  cancel(){return new Promise(()=>{});},
 });
 const req=new Request('https://gateway.invalid/api/v1/workspaces/invitations/accept',{
  method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},
  body:stream,duplex:'half',
 });
 let timer;
 try {
  const response=await Promise.race([
   handle(req,env),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Bounded denial stalled')),500);}),
  ]);
  assert.equal(response.status,413);
  assert.equal(calls.some(c=>c.u.pathname.endsWith('/nexus_accept_workspace_invitation')),false);
 } finally {clearTimeout(timer);}
});
