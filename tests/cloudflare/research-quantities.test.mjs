import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../../apps/gateway/src/preview-worker.js';
import {validateQuantityCapture} from '../../apps/gateway/src/research-quantities.js';
const workspace='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const plan='33333333-3333-4333-8333-333333333333',id='66666666-6666-4666-8666-666666666666';
const input={document_id:'44444444-4444-4444-8444-444444444444',version_id:'55555555-5555-4555-8555-555555555555',
  chunk_index:0,original_content_hash:'a'.repeat(64),value_span:{start:8,end:13},unit_span:{start:14,end:16}};
const sourceText='\u{1F4CA} mass: 1.005 kg; other mass 9 kg';
const row={id,workspace_id:workspace,owner_id:actor,plan_id:plan,document_id:input.document_id,version_id:input.version_id,
  chunk_id:'77777777-7777-4777-8777-777777777777',input,quantity:{value:'1.005',unit:'kg',evidence_ids:[`urn:nexusrag:quantity:${id}`]},
  source:{filename:'quantity.txt',page_number:2,location:{page:2},value_context:{text:sourceText,span_start:8,span_end:13},unit_context:{text:sourceText,span_start:14,span_end:16}},
  state:'captured',persistence_state:'PERSISTED',schema_version:'research-quantity/1',source_state:'SOURCE_SPANS_MATCHED_REVIEW_REQUIRED',freshness:'current'};
const env={SUPABASE_URL:'https://quantity-peer.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'};
const headers={authorization:'Bearer synthetic','x-workspace-id':workspace,'content-type':'application/json','idempotency-key':'ordinary-quantity'};
function fixture(t,rpc,role='editor'){
  t.mock.method(globalThis,'fetch',async(resource,init={})=>{
    const url=new URL(resource),json=value=>new Response(JSON.stringify(value));
    if(url.pathname==='/auth/v1/user')return json({id:actor});
    if(url.pathname==='/rest/v1/workspace_members')return json([{workspace_id:workspace,user_id:actor,role}]);
    if(url.pathname==='/rest/v1/workspaces')return json([{lifecycle_state:'active',capability_revision:1}]);
    if(url.pathname==='/rest/v1/workspace_settings')return json([{active_policy_id:plan,policy_version:1}]);
    if(url.pathname==='/rest/v1/rpc/nexus_research_quantity')return rpc(JSON.parse(init.body),json);
    throw new Error(`Unexpected synthetic peer ${url.pathname}`);
  });
}
function request(method='POST',body=input){return new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/quantities`,
  {method,headers,...(method==='POST'?{body:JSON.stringify(body)}:{})});}
test('source quantity capture stores exact codepoint spans and reads matching source context',async t=>{
  fixture(t,(data,json)=>{assert.equal(data.p_plan_id,plan);if(data.p_operation==='create'){assert.deepEqual(data.p_input,input);assert.equal(data.p_key,'ordinary-quantity');return json(row);}return json({items:[row],next_after:null});});
  const saved=await handle(request(),env);assert.equal(saved.status,201);assert.deepEqual((await saved.json()).quantity,row.quantity);
  const listed=await handle(request('GET'),env);assert.equal(listed.status,200);assert.deepEqual((await listed.json()).items[0].source,row.source);
});
test('unavailable captured source stays readable as unavailable without numeric/source payload',async t=>{
  fixture(t,(_data,json)=>json({items:[{...row,source_state:'SOURCE_UNAVAILABLE',freshness:'unavailable',quantity:null,source:null}],next_after:null}));
  const result=await handle(request('GET'),env);assert.equal(result.status,200);assert.equal((await result.json()).items[0].quantity,null);
});
test('stale immutable source remains explicitly stale rather than becoming current',async t=>{
  fixture(t,(_data,json)=>json({...row,freshness:'stale'}));const result=await handle(request(),env);assert.equal(result.status,201);assert.equal((await result.json()).freshness,'stale');
});
for(const change of [{value_span:{start:8,end:8}},{unit_span:{start:10,end:12}},{value_span:{start:8.5,end:13}},
  {chunk_index:-1},{original_content_hash:'not-a-hash'},{unit_span:{start:14,end:1000001}},{version_id:'no-version'}])test(`invalid ordinary source selection is actionable ${JSON.stringify(change)}`,()=>{
  assert.throws(()=>validateQuantityCapture({...input,...change}),error=>error.status===422 && error.code==='INVALID_QUANTITY_CAPTURE');
});
for(const change of [{quantity:{...row.quantity,value:'9'}},{source:{...row.source,value_context:{text:sourceText,span_start:9,span_end:14}}},
  {source_state:'SUPPORTED'},{persistence_state:'NOT_PERSISTED'},{quantity:{...row.quantity,evidence_ids:['typed-unverified']}}])test(`inconsistent source receipt is not saved confirmation ${JSON.stringify(change)}`,async t=>{
  fixture(t,(_data,json)=>json({...row,...change}));const result=await handle(request(),env);assert.equal(result.status,503);assert.equal((await result.json()).error.code,'PERSISTENCE_UNCONFIRMED');
});
test('source changed before capture produces refresh guidance rather than a stored success',async t=>{
  fixture(t,()=>new Response(JSON.stringify({code:'P0001',message:'NR:SOURCE_UNAVAILABLE'}),{status:400}));
  const result=await handle(request(),env);assert.equal(result.status,409);assert.equal((await result.json()).error.code,'SOURCE_UNAVAILABLE');
});
test('ordinary viewer reads captures without executing a new capture',async t=>{
  let creates=0;fixture(t,(data,json)=>{if(data.p_operation==='create')creates++;return json({items:[row],next_after:null});},'viewer');
  assert.equal((await handle(request('GET'),env)).status,200);assert.equal((await handle(request(),env)).status,403);assert.equal(creates,0);
});
