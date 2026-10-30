// Production original-download handler with real disposable quota/metadata SQL.
// Only the identity and original-object HTTP transports are synthetic.
import assert from "node:assert/strict";
import { execFile,execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { handle } from "../../apps/gateway/src/preview-worker.js";
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
const doc="d0360000-0000-4000-8100-000000000001",version="e0360000-0000-4000-8100-000000000001";
const key=`${ws}/${doc}/${version}/Synthetic-original.txt`;
const bytes=new TextEncoder().encode("\uFEFFStored original bytes. Extra source-only material.\r\n"),hash=createHash("sha256").update(bytes).digest("hex");
function args(values){return ["-X","-qAt","-v","ON_ERROR_STOP=1",...Object.entries(values).flatMap(([k,v])=>["-v",`${k}=${typeof v==="string"?v:JSON.stringify(v)}`])];}
function sql(statement,values={}) {
  const text=execFileSync("psql",args(values),{input:`set request.jwt.claim.role='service_role';\n${statement}`,encoding:"utf8"}).trim();
  return text?JSON.parse(text):null;
}
function sqlAsync(statement,values={}) {return new Promise((resolve,reject)=>{
  const child=execFile("psql",args(values),{encoding:"utf8"},(error,out)=>{if(error)reject(error);else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
  child.stdin.end(`set request.jwt.claim.role='service_role';\n${statement}`);
});}
sql(`insert into public.provider_registry(id,display_name,authority,documentation_url,terms_url,status)
 values('supabase_storage','Synthetic original-transfer provider','Disposable fixture only','https://example.invalid/docs','https://example.invalid/terms','APPROVED');
 insert into public.workspace_provider_policies(workspace_id,provider_id,status,allowed_actions,rights_hash,reviewed_by,reviewed_at)
 values(:'ws','supabase_storage','APPROVED',array['original_download'],repeat('d',64),:'actor',now());
 insert into public.resource_budgets(scope_key,workspace_id,provider_id,dimension,hard_limit,window_kind,reset_at,state)
 select scope,workspace_id,'supabase_storage',dimension,case when dimension='requests' then 20 else :'bytes'::bigint*10 end,'daily',now()+interval '1 day','READY'
 from(values('global',null::uuid),('workspace:'||:'ws',:'ws'::uuid))scopes(scope,workspace_id)
 cross join(values('requests'),('egress_bytes'))dims(dimension);
 insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,file_size_bytes,content_type)
 values(:'doc',:'ws',:'actor','Synthetic SQL original.txt','Synthetic SQL original.txt','ready',:'bytes','text/plain');
 insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,
 parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation)
 values(:'version',:'ws',:'doc','documents',:'key',:'hash',:'bytes',now(),'synthetic','synthetic',1,'ready','original-transfer-fixture');
 update public.documents set active_version_id=:'version' where id=:'doc';`,{ws,actor,doc,version,key,hash,bytes:bytes.length});

let storageReads=0,quotaConnections=0;
const ordinary=globalThis.fetch;
globalThis.fetch=async(raw,init={})=>{
  const url=new URL(raw),body=init.body?JSON.parse(init.body):{};
  const json=value=>new Response(JSON.stringify(value));
  assert.equal(url.hostname,"original-peer.invalid");
  if(url.pathname==="/auth/v1/user")return json({id:actor});
  const table=url.pathname.slice("/rest/v1/".length);
  if(table==="rpc/v6_reserve_many") {
    quotaConnections++;
    return json(await sqlAsync("select public.v6_reserve_many(:'ws'::uuid,:'provider',:'dimensions'::jsonb,:'key',:'priority',:'action',:'classification');",
      {ws:body.p_workspace,provider:body.p_provider,dimensions:body.p_dimensions,key:body.p_idempotency_key,priority:body.p_priority,action:body.p_action,classification:body.p_data_classification}));
  }
  if(table==="rpc/v6_settle_many")return json(await sqlAsync("select public.v6_settle_many(:'reservations'::jsonb,:'called'::boolean);",{reservations:body.p_reservations,called:String(body.p_provider_called)}));
  if(url.pathname.startsWith("/storage/v1/object/")) {
    storageReads++;
    assert.equal(decodeURIComponent(url.pathname),`/storage/v1/object/${init.method==="HEAD"?"":"authenticated/"}documents/${key}`);
    return new Response(init.method==="HEAD"?null:bytes,{headers:{"content-length":String(bytes.length)}});
  }
  assert.ok(["workspace_members","documents","document_versions"].includes(table),table);
  const filters={};let workspaceState;
  for(const [name,value] of url.searchParams) {
    if(["select","limit"].includes(name))continue;
    assert.ok(value.startsWith("eq."));
    if(name==="workspaces.lifecycle_state") {assert.equal(table,"workspace_members");workspaceState=value.slice(3);}
    else filters[name]=value.slice(3);
  }
  if(table==="workspace_members")return json(sql(`select coalesce(jsonb_agg(value),'[]') from(
    select to_jsonb(t)||jsonb_build_object('workspaces',jsonb_build_object('lifecycle_state',w.lifecycle_state))value
    from public.workspace_members t join public.workspaces w on w.id=t.workspace_id
    where to_jsonb(t)@>:'filters'::jsonb and w.lifecycle_state=:'state' limit 1)rows;`,{filters,state:workspaceState}));
  return json(sql(`select coalesce(jsonb_agg(value),'[]') from(select to_jsonb(t)value from public.${table} t where to_jsonb(t)@>:'filters'::jsonb limit 1)rows;`,{filters}));
};
const env={SUPABASE_URL:"https://original-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic",SUPABASE_SERVICE_ROLE_KEY:"synthetic"};
const run=method=>handle(new Request(`https://gateway.invalid/api/v1/documents/${doc}/original?version_id=${version}`,{
 method,headers:{authorization:"Bearer synthetic",'x-nexus-workspace-id':ws}}),env);
const budget=()=>sql("select jsonb_agg(jsonb_build_object('scope',scope_key,'dimension',dimension,'used',used,'reserved',reserved)order by scope_key,dimension) from public.resource_budgets where provider_id='supabase_storage';");
try {
 const first=await run("GET");assert.equal(first.status,200,first.ok?undefined:await first.clone().text());assert.deepEqual(new Uint8Array(await first.arrayBuffer()),bytes);
 assert.equal(first.headers.get("x-nexus-original-sha256"),hash);
 let rows=budget();assert.equal(rows.length,4);
 for(const row of rows){assert.equal(row.reserved,0);assert.equal(row.used,row.dimension==="requests"?1:bytes.length);}
 const head=await run("HEAD");assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
 rows=budget();for(const row of rows)assert.equal(row.used,row.dimension==="requests"?2:bytes.length);
 sql("update public.resource_budgets set used=hard_limit where provider_id='supabase_storage' and dimension='egress_bytes';");
 const before=storageReads,exhausted=await run("GET");assert.equal(exhausted.status,429);assert.equal(storageReads,before);
 sql("update public.resource_budgets set used=0,reserved=0,hard_limit=case when dimension='requests' then 20 else :'limit'::bigint end where provider_id='supabase_storage';",{limit:Math.ceil(bytes.length*1.5)});
 const concurrent=await Promise.all([run("GET"),run("GET")]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,429]);
 for(const response of concurrent)if(response.ok)assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 rows=budget();for(const row of rows){assert.equal(row.reserved,0);if(row.dimension==="egress_bytes")assert.equal(row.used,bytes.length);}
 console.log(JSON.stringify({marker:"REAL_SQL_ORIGINAL_TRANSFER_QUOTA_PASS",original_bytes:bytes.length,original_sha256:hash,
   real_global_and_workspace_request_egress_settlement:true,head_without_egress_charge:true,exhausted_storage_read_started:false,
   independent_quota_connections:quotaConnections,concurrent_get_outcomes:[200,429],tables_added:0,functions_added:0,
   provider_processing:false,hosted_storage_or_private_acceptance:false}));
}finally{globalThis.fetch=ordinary;}
