import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { handle } from '../../apps/gateway/src/preview-worker.js';
import { unzipEntries } from '../../apps/gateway/src/worker-lifecycle.js';
const workspace='11111111-1111-4111-8111-111111111111';
const user='22222222-2222-4222-8222-222222222222';
const env={SUPABASE_URL:'https://supabase.invalid',SUPABASE_PUBLISHABLE_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret',FRONTEND_ORIGIN:'https://frontend.invalid'};
const request=(path,init={})=>new Request(`https://gateway.invalid${path}`,{...init,headers:{authorization:'Bearer synthetic', 'x-workspace-id':workspace,...init.headers}});
const json=value=>new Response(JSON.stringify(value),{status:200});
const mockAuth=t=>t.mock.method(globalThis,'fetch',async url=>{
 const u=new URL(url);if(u.pathname==='/auth/v1/user')return json({id:user});
 if(u.pathname==='/rest/v1/workspace_members')return json([{workspace_id:workspace,user_id:user,role:'owner'}]);
 throw Error(`Unexpected persistence/provider call: ${u.pathname}`);
});
test('CORS permits browser key deletion only from configured origin',async()=>{
 const r=await handle(request('/api/v1/apikey',{method:'OPTIONS',headers:{origin:env.FRONTEND_ORIGIN,'access-control-request-method':'DELETE'}}),env);
 assert.equal(r.status,204);assert.match(r.headers.get('access-control-allow-methods'),/DELETE/);assert.equal(r.headers.get('access-control-allow-origin'),env.FRONTEND_ORIGIN);
 const other=await handle(request('/api/v1/apikey',{method:'OPTIONS',headers:{origin:'https://untrusted.invalid'}}),env);assert.equal(other.headers.get('access-control-allow-origin'),null);
});
for(const body of [{question:'test',chat_scope:'documents'},{question:'test',document_ids:['invalid']},{question:'test',filename:'private.txt'},{question:'test',file_types:['pdf']},{question:'test',min_page:0},{question:'test',metadata_filters:{classification:'private'}}]){
 test(`chat rejects scope widening before admission: ${JSON.stringify(body)}`,async t=>{mockAuth(t);const r=await handle(request('/api/v1/chat',{method:'POST',body:JSON.stringify({...body,non_sensitive_attested:true})}),env);assert.equal(r.status,422);assert.ok(['INVALID_SCOPE','UNSUPPORTED_FILTER'].includes((await r.json()).error.code));});
}
test('malformed JSON is a client error, not an internal failure',async t=>{mockAuth(t);const r=await handle(request('/api/v1/chat',{method:'POST',body:'{'}),env);assert.equal(r.status,400);assert.equal((await r.json()).error.code,'INVALID_REQUEST');});
test('first login resolves only the authenticated users membership',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);calls.push(u);if(u.pathname==='/auth/v1/user')return json({id:user});if(u.pathname==='/rest/v1/workspace_members')return json([{workspace_id:workspace,user_id:user,role:'owner'}]);if(u.pathname==='/rest/v1/workspaces')return json([{id:workspace,name:'Synthetic workspace'}]);throw Error('Unexpected request');});
 const r=await handle(new Request('https://gateway.invalid/api/v1/workspaces/current',{headers:{authorization:'Bearer synthetic'}}),env);assert.equal(r.status,200);assert.equal((await r.json()).workspace_id,workspace);assert.ok(calls.filter(u=>u.pathname.endsWith('workspace_members')).every(u=>u.searchParams.get('user_id')===`eq.${user}`));
});
function zipEntry(name,content,{compressed=false,declaredSize=content.length}={}){const nameBytes=Buffer.from(name),data=compressed?deflateRawSync(content):content;const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(compressed?8:0,8);header.writeUInt32LE(data.length,18);header.writeUInt32LE(declaredSize,22);header.writeUInt16LE(nameBytes.length,26);return Buffer.concat([header,nameBytes,data]);}
test('ZIP decoding rejects declared expansion before allocation',async()=>{await assert.rejects(unzipEntries(zipEntry('a.txt',Buffer.from('a'),{declaredSize:20_000_001})),e=>e.code==='ARCHIVE_LIMIT'&&e.status===413);});
test('ZIP decoding stops an expansion bomb even with forged size metadata',async()=>{const archive=zipEntry('bomb.txt',Buffer.alloc(20_000_001,65),{compressed:true,declaredSize:0});await assert.rejects(unzipEntries(archive),e=>e.code==='ARCHIVE_LIMIT'&&e.status===413);});
test('ZIP decoding rejects entry overflow rather than dropping files',async()=>{const archive=Buffer.concat(Array.from({length:65},(_,i)=>zipEntry(`${i}.txt`,Buffer.from('a'))));await assert.rejects(unzipEntries(archive),e=>e.code==='ARCHIVE_LIMIT');});
test('bounded valid ZIP text remains extractable',async()=>{const result=await unzipEntries(zipEntry('a.txt',Buffer.from('evidence'),{compressed:true}));assert.equal(new TextDecoder().decode(result[0].content),'evidence');});
for(const path of ['/api/v1/analytics/summary','/api/v1/privacy/settings','/api/v1/workspaces/current/members','/api/v1/audit'])test(`read route denies cross-workspace access: ${path}`,async t=>{t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/auth/v1/user')?json({id:user}):json([]));const r=await handle(request(path),env);assert.equal(r.status,403);});
test('analytics uses exact tenant counts and does not invent quality metrics',async t=>{const calls=[];t.mock.method(globalThis,'fetch',async(url,init={})=>{const u=new URL(url);calls.push(u);if(u.pathname==='/auth/v1/user')return json({id:user});if(u.pathname==='/rest/v1/workspace_members')return json([{workspace_id:workspace,user_id:user,role:'owner'}]);assert.equal(init.method,'HEAD');assert.equal(u.searchParams.get('workspace_id'),`eq.${workspace}`);return new Response(null,{headers:{'content-range':'*/7'}});});const r=await handle(request('/api/v1/analytics/summary'),env);assert.equal(r.status,200);const b=await r.json();assert.equal(b.total_queries,7);assert.equal(b.measurement_states.avg_confidence,'NOT_MEASURED');assert.equal(calls.filter(u=>u.searchParams.get('role')==='eq.user').length,2);});

test('privacy remains gated and existing-account member management is declared',async t=>{
 t.mock.method(globalThis,'fetch',async url=>{const u=new URL(url);if(u.pathname==='/auth/v1/user')return json({id:user});if(u.pathname==='/rest/v1/rpc/nexus_management_version')return json({version:"036"});assert.equal(u.searchParams.get('workspace_id'),`eq.${workspace}`);if(u.pathname==='/rest/v1/workspace_members')return json([{workspace_id:workspace,user_id:user,role:'owner'}]);if(u.pathname==='/rest/v1/workspace_settings')return json([{retention_enabled:false,retention_days:0}]);throw Error('Unexpected read');});
 const privacy=await (await handle(request('/api/v1/privacy/settings'),env)).json();assert.equal(privacy.retention_mutation_supported,false);assert.equal(privacy.workspace_deletion_supported,false);
 const members=await (await handle(request('/api/v1/workspaces/current/members'),env)).json();assert.equal(members.management_supported,true);assert.equal(members.invitation_supported,false);assert.equal(members.members[0].user_id,user);
});
test('audit feed is unavailable to viewer memberships',async t=>{t.mock.method(globalThis,'fetch',async url=>String(url).endsWith('/auth/v1/user')?json({id:user}):json([{workspace_id:workspace,user_id:user,role:'viewer'}]));const r=await handle(request('/api/v1/audit'),env);assert.equal(r.status,403);});
