import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../../apps/gateway/src/preview-worker.js';
const user='22222222-2222-4222-8222-222222222222';
const ids=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
const env={SUPABASE_URL:'https://supabase.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret',FRONTEND_ORIGIN:'https://frontend.invalid'};
const request=query=>new Request(`https://gateway.invalid/api/v1/workspaces${query}`,{headers:{authorization:'Bearer synthetic'}});
function fixture(t,{count='*/203',inactive=false}={}){
 const calls=[];
 t.mock.method(globalThis,'fetch',async (url,init={})=>{
  const u=new URL(url);calls.push({u,init});
  if(u.pathname==='/auth/v1/user')return Response.json({id:user});
  assert.equal(u.pathname,'/rest/v1/workspace_members');
  assert.equal(u.searchParams.get('user_id'),`eq.${user}`);
  assert.equal(u.searchParams.get('workspaces.lifecycle_state'),'eq.active');
  assert.match(u.searchParams.get('select'),/workspaces!inner/);
  if(init.method==='HEAD'){
   assert.equal(init.headers.prefer,'count=exact');
   assert.equal(u.searchParams.has('workspace_id'),false);
   return new Response(null,{headers:count?{'content-range':count}:{}});
  }
  assert.equal(u.searchParams.get('order'),'workspace_id.asc');
  const after=u.searchParams.get('workspace_id')?.slice(3);
  return Response.json(ids.filter(id=>!after||id>after).slice(0,Number(u.searchParams.get('limit'))).map(id=>({workspace_id:id,role:'owner',workspaces:{id,name:'Synthetic workspace',slug:id,plan:'free',lifecycle_state:inactive?'deleting':'active'}})));
 });return calls;
}
test('workspace discovery uses exact active-only actor total and keyset pages',async t=>{
 fixture(t);const first=await handle(request('?limit=2'),env);assert.equal(first.status,200);
 const a=await first.json();assert.equal(a.total,203);assert.equal(a.total_is_exact,true);assert.equal(a.workspaces.length,2);assert.equal(a.next_after,ids[1]);
 const b=await (await handle(request(`?limit=2&after=${a.next_after}`),env)).json();assert.equal(b.workspaces.length,1);assert.equal(b.next_after,null);assert.equal(b.workspaces[0].id,ids[2]);
});
for(const query of ['?limit=0','?limit=101','?limit=2junk','?after=','?after=or(user_id.not.is.null)'])test(`workspace paging fails before inventory reads: ${query}`,async t=>{
 const calls=fixture(t);assert.equal((await handle(request(query),env)).status,422);assert.equal(calls.filter(c=>c.u.pathname.startsWith('/rest/')).length,0);
});
for(const count of [null,'*/9007199254740992','0-1/*'])test(`unknown exact active workspace count fails closed: ${count}`,async t=>{
 fixture(t,{count});const r=await handle(request(''),env);assert.equal(r.status,503);assert.equal((await r.json()).workspaces,undefined);
});
test('inactive workspace data is never returned even if upstream violates the filter',async t=>{
 fixture(t,{inactive:true});const r=await handle(request(''),env);assert.equal(r.status,503);assert.equal((await r.json()).workspaces,undefined);
});
test('default discovery filters inactive membership before selecting its first workspace',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async url=>{
  const u=new URL(url);calls.push(u);
  if(u.pathname==='/auth/v1/user')return Response.json({id:user});
  if(u.pathname==='/rest/v1/workspace_members'){
   assert.equal(u.searchParams.get('workspaces.lifecycle_state'),'eq.active');assert.match(u.searchParams.get('select'),/workspaces!inner/);
   return Response.json([{workspace_id:ids[1],user_id:user,role:'owner'}]);
  }
  if(u.pathname==='/rest/v1/workspaces')return Response.json([{id:ids[1],name:'Active workspace'}]);
  throw Error('Unexpected request');
 });
 const r=await handle(new Request('https://gateway.invalid/api/v1/workspaces/current',{headers:{authorization:'Bearer synthetic'}}),env);
 assert.equal(r.status,200);assert.equal((await r.json()).workspace_id,ids[1]);
 assert.equal(calls.filter(u=>u.pathname.endsWith('workspace_members')).length,2);
});
