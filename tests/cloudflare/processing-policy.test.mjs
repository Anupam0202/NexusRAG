import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../apps/gateway/src/preview-worker.js';
const workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const env={SUPABASE_URL:'https://supabase.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic'};
const policy={schema_version:'038',state:'RIGHTS_BLOCKED',provider:'gemini',policy_version:1};
async function exercise(t,{role='owner',body,method='GET',failure,reply=policy}={}) {
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const target=String(url);calls.push({target,init});
  if(target.endsWith('/auth/v1/user'))return Response.json({id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
  if(target.includes('/workspace_members?'))return Response.json([{workspace_id:workspace,role}]);
  if(target.includes('/workspaces?'))return Response.json([{id:workspace,lifecycle_state:'active'}]);
  if(target.endsWith('/rpc/nexus_workspace_processing_policy'))return failure?Response.json(failure,{status:400}):Response.json(reply);
  throw Error('Unexpected provider call');
 });
 const request=new Request('https://gateway.invalid/api/v1/privacy/processing-policy',{method,headers:{authorization:'Bearer synthetic','X-Nexus-Workspace-Id':workspace,'content-type':'application/json'},...(method==='PATCH'?{body:JSON.stringify(body)}:{})});
 const response=await handle(request,env);return {response,calls};
}
test('processing policy read is private, scoped and makes no provider call',async t=>{
 const {response,calls}=await exercise(t);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
 const rpc=JSON.parse(calls.find(c=>c.target.endsWith('/rpc/nexus_workspace_processing_policy')).init.body);
 assert.deepEqual(rpc,{p_workspace:workspace,p_actor:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',p_operation:'read',p_terms_hash:null,p_policy_version:null});
});
for(const role of ['admin','editor','viewer'])test(`${role} cannot record owner approval`,async t=>{
 const {response,calls}=await exercise(t,{role,method:'PATCH',body:{operation:'approve',terms_hash:'c'.repeat(64),policy_version:1,acknowledged_non_sensitive_only:true}});
 assert.equal(response.status,403);assert.equal(calls.some(c=>c.target.includes('/rpc/')),false);
});
for(const body of [null,[],{operation:'approve',terms_hash:'c'.repeat(64),policy_version:1},{operation:'approve',terms_hash:'bad',policy_version:1,acknowledged_non_sensitive_only:true},{operation:'revoke',policy_version:-1},{operation:'revoke',policy_version:1,actor:'spoof'}])test(`invalid owner decision ${JSON.stringify(body)}`,async t=>{
 const {response,calls}=await exercise(t,{method:'PATCH',body});assert.equal(response.status,422);assert.equal(calls.some(c=>c.target.includes('/rpc/')),false);
});
test('explicit owner decision passes only server-verified actor to atomic storage',async t=>{
 const {response,calls}=await exercise(t,{method:'PATCH',body:{operation:'approve',terms_hash:'c'.repeat(64),policy_version:1,acknowledged_non_sensitive_only:true}});
 assert.equal(response.status,200);const rpc=JSON.parse(calls.find(c=>c.target.includes('/rpc/')).init.body);assert.equal(rpc.p_operation,'approve');assert.equal(rpc.p_policy_version,1);assert.equal(rpc.p_terms_hash,'c'.repeat(64));
});
test('missing migration blocks approvals distinctly from storage outage',async t=>{
 const {response}=await exercise(t,{failure:{code:'PGRST202',message:'Function absent'}});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'MIGRATION_REQUIRED');
});
test('storage outage is not mislabeled as missing schema',async t=>{
 const {response}=await exercise(t,{failure:{code:'08006',message:'Unavailable'}});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'PERSISTENCE_UNAVAILABLE');
});
test('stale policy version remains a conflict instead of an implicit retry',async t=>{
 const {response}=await exercise(t,{method:'PATCH',body:{operation:'revoke',policy_version:1},failure:{code:'P0001',message:'NR:VERSION_CONFLICT'}});assert.equal(response.status,409);
});
