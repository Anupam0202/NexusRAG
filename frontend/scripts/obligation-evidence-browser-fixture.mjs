import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {handle} from "../../apps/gateway/src/preview-worker.js";
// Actual React pages/client/Gateway, with controlled storage transport replaying
// disposable-SQL projections. This is not hosted identity or SQL durability proof.
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),port=Number(process.argv[2]||3037);
const fixture=JSON.parse(await readFile(process.env.E2E_OBLIGATION_SQL_FIXTURE||resolve(root,"../tests/fixtures/obligation-evidence-sql.json"),"utf8"));
assert.equal(fixture.schema_version,"obligation-evidence-browser-sql-fixture/1");
const workspace=fixture.workspace_id,actor=fixture.actor_id,author=fixture.author_id,reviewer=fixture.finding.reviews[0]?.reviewer_id;
assert.equal(fixture.finding.workspace_id,workspace);assert.equal(fixture.detail_api.schema_version,"obligation-evidence-detail/1");
for(const key of ["api","mcp"]){
  const allowed=fixture[`rights_${key}_allowed`],erased=fixture[`rights_${key}_erased`];
  assert.equal(erased?.schema_version,"finding-serving-rights/1");assert.equal(erased.eligible,false);
  assert.deepEqual(erased.items.map(row=>[row.version_id,row.review_id,row.actor_id,row.created_at]),allowed.items.map(row=>[row.version_id,row.review_id,row.actor_id,row.created_at]));
  assert.ok(erased.items.every(row=>row.policy===null&&typeof row.policy_erased_at==="string"&&!row.allowed));
}
const policy="44444444-4444-4444-8444-444444444444",env={SUPABASE_URL:"https://obligation-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const originalFetch=globalThis.fetch,json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json",...headers}});
let state,lastApiRequestAt=0;
function reset(){state={rights:{SERVE_API:"initial",SERVE_MCP:"initial"},keys:new Map(),attempts:[],commits:0,sourceUnavailable:false,reviewRequired:false,
  rightsErased:false,lifecycleErasureObserved:false,lifecycleRollbackObserved:false};}
reset();
const keyFor=action=>action==="SERVE_API"?"api":"mcp";
const currentRights=action=>fixture[`rights_${keyFor(action)}_${state.rightsErased?"erased":state.rights[action]}`];
function storageProjection(value){
  // The exported MCP read was captured after the real Gateway added its HTTP
  // envelope. Storage returns only the SQL projection; the Gateway must add
  // and validate this envelope again during the browser request.
  if(value.action!=="SERVE_MCP")return value;
  const {protocol,operation,...projection}=value;
  assert.equal(protocol,"nexusrag-evidence-mcp/1");assert.equal(operation,"obligation_lookup");
  return projection;
}
function currentDetail(action){const key=keyFor(action);
  if(state.sourceUnavailable)return storageProjection(fixture[`source_unavailable_${key}`]);
  if(state.reviewRequired)return storageProjection(fixture[`review_required_${key}`]);
  return storageProjection(state.rights[action]==="allowed"?fixture[`detail_${key}`]:fixture[`withheld_${key}`]);}
function currentList(action){const detail=currentDetail(action),original=storageProjection(fixture[`list_${keyFor(action)}`]);
  const summary=Object.fromEntries(["finding_id","revision","run_id","result_index","created_at","updated_at","state","source_state","review_state","rights_state"].map(key=>[key,detail[key]]));
  // Controlled presentation scope selects the same real saved Finding; list
  // pagination/capacity is exercised independently by the actual SQL suite.
  return {...original,items:[summary],next_after:null};}
globalThis.fetch=async(input,init={})=>{
  const url=new URL(input);if(url.hostname!=="obligation-peer.invalid")return originalFetch(input,init);
  const data=init.body?JSON.parse(init.body):{},headers=new Headers(init.headers),token=headers.get("authorization")||"";
  const user=token.includes("synthetic-obligation-browser:")?token.split(":").at(-1):data.p_context?.user_id||actor;
  if(url.pathname==="/auth/v1/user")return json({id:user});
  if(url.pathname==="/rest/v1/workspace_members"){
    const requested=url.searchParams.get("user_id");if(init.method==="HEAD")return json(null,200,{"content-range":"0-1/2"});
    if(requested?.startsWith("eq."))return json([{workspace_id:workspace,user_id:requested.slice(3),role:requested.slice(3)===actor?"owner":"editor",workspaces:{lifecycle_state:"active"}}]);
    return json([{workspace_id:workspace,user_id:actor,role:"owner",profiles:{display_name:"Synthetic rights reviewer"}},
      {workspace_id:workspace,user_id:reviewer,role:"editor",profiles:{display_name:"Synthetic independent Finding reviewer"}}]);
  }
  if(url.pathname==="/rest/v1/workspaces")return json([{id:workspace,name:"Synthetic Obligation workspace",lifecycle_state:"active",capability_revision:1}]);
  if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:policy,policy_version:1}]);
  if(url.pathname==="/rest/v1/finding_versions")return json([{author_id:author}]);
  if(url.pathname==="/rest/v1/rpc/nexus_management_version")return json({version:"036"});
  if(url.pathname==="/rest/v1/rpc/nexus_invitation_version")return json({version:"040",recipient_bound:true,manual_delivery:true});
  if(url.pathname==="/rest/v1/audit_events")return json(null,201);
  if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence_contract")return json({schema_version:"obligation-evidence/1",list_schema:"obligation-evidence-list/1",detail_schema:"obligation-evidence-detail/1",rights_schema:"finding-serving-rights/1",actions:["SERVE_API","SERVE_MCP"],default_limit:20,max_limit:50,max_sources:50,max_candidates:12,max_criteria:11,max_result_bytes:1000000});
  if(url.pathname==="/rest/v1/rpc/nexus_obligation_evidence"){assert.equal(data.p_context.workspace_id,workspace);return json(data.p_operation==="list"?currentList(data.p_action):currentDetail(data.p_action));}
  if(url.pathname==="/rest/v1/rpc/nexus_finding_serving_rights"){
    const action=data.p_action,key=keyFor(action);if(data.p_operation==="read")return json({...currentRights(action),confirmed_review:null});
    const intent=`${action}:${data.p_key}`,saved=state.keys.get(intent);state.attempts.push({key:data.p_key,action,command:data.p_command});
    if(saved){assert.deepEqual(data.p_command,saved.command);return json({...currentRights(action),confirmed_review:saved.confirmation});}
    const target=data.p_command.policy.decision==="REVOKED"?"revoked":"allowed",projected=fixture[`rights_${key}_${target}`],command=fixture[`${target==="revoked"?"revoke":"review"}_command_${key}`];
    assert.ok(projected?.confirmed_review,`Actual SQL ${key} ${target} confirmation required`);assert.equal(data.p_revision,command.revision);assert.deepEqual(data.p_command,{selections:command.selections,policy:command.policy});
    state.keys.set(intent,{command:structuredClone(data.p_command),confirmation:projected.confirmed_review});state.rights[action]=target;state.commits++;
    return json({code:"08006",message:"Synthetic reply interrupted after recorded serving decision"},503);
  }
  if(url.pathname==="/rest/v1/rpc/workbench_read")return json({items:[fixture.finding],next_after:null});
  if(url.pathname==="/rest/v1/rpc/nexus_finding")return json(fixture.finding);
  throw new Error(`Unexpected controlled Obligation storage path ${url.pathname}`);
};
const server=await createServer({root,configFile:false,envFile:false,cacheDir:process.env.NEXUSRAG_FIXTURE_CACHE_DIR,
  optimizeDeps:{entries:["scripts/fixtures/obligation-evidence-workflow.tsx"],include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","lucide-react","zustand","clsx","tailwind-merge","framer-motion"],force:true,holdUntilCrawlEnd:true},
  plugins:[react(),{name:"synthetic-obligation-transport",configureServer(instance){instance.middlewares.use((request,response,next)=>void serve(request,response,next,instance).catch(error=>{console.error(error);response.statusCode=500;response.end("Synthetic Obligation fixture failed");}));}}],
  resolve:{alias:[{find:"@/lib/api-context",replacement:resolve(root,"scripts/fixtures/obligation-evidence-context.ts")},{find:"@",replacement:resolve(root,"src")}]},
  define:{"process.env":JSON.stringify({NODE_ENV:"development",NEXT_PUBLIC_API_URL:`http://127.0.0.1:${port}`})},server:{host:"127.0.0.1",port,strictPort:true,watch:{ignored:["**/.next/**","**/.open-next/**"]}}});
async function serve(request,response,next,instance){const url=new URL(request.url,`http://127.0.0.1:${port}`);
  if(url.pathname.startsWith("/__fixture__/")){
    const start=performance.now(),observed=new Date().toISOString(),observation=request.headers["x-fixture-observation-id"]??null;
    response.once("finish",()=>console.log(JSON.stringify({marker:"SYNTHETIC_OBLIGATION_CONTROL",observation,path:url.pathname,observed_at_utc:observed,
      finished_at_utc:new Date().toISOString(),elapsed_ms:Math.round((performance.now()-start)*1000)/1000,status:response.statusCode})));
  }
  if(url.pathname==="/__fixture__/reset"){reset();response.setHeader("content-type","application/json");response.end(JSON.stringify({reset:true}));return;}
  if(url.pathname==="/__fixture__/quota-window"){response.setHeader("content-type","application/json");response.end(JSON.stringify({remaining_ms:Math.max(0,lastApiRequestAt+60_050-Date.now())}));return;}
  if(url.pathname==="/__fixture__/source-unavailable"){state.sourceUnavailable=true;response.end("{}");return;}
  // Native SQL captured these projections inside an actual rolled-back source
  // lifecycle transaction. This controlled branch mirrors that rollback; it is
  // not an application restore command or evidence of hosted data recovery.
  if(url.pathname==="/__fixture__/source-lifecycle"){
    assert.deepEqual(state.rights,{SERVE_API:"allowed",SERVE_MCP:"allowed"});
    state.rightsErased=true;state.sourceUnavailable=true;state.lifecycleErasureObserved=true;response.end("{}");return;
  }
  if(url.pathname==="/__fixture__/rollback-source-lifecycle"){
    assert.equal(state.rightsErased,true);state.rightsErased=false;state.sourceUnavailable=false;state.lifecycleRollbackObserved=true;response.end("{}");return;
  }
  if(url.pathname==="/__fixture__/review-required"){state.reviewRequired=true;response.end("{}");return;}
  if(url.pathname==="/__fixture__/review-current"){state.reviewRequired=false;response.end("{}");return;}
  if(url.pathname==="/__fixture__/summary"){response.setHeader("content-type","application/json");response.end(JSON.stringify({commits:state.commits,attempts:state.attempts,distinct_intents:state.keys.size,api:state.rights.SERVE_API,mcp:state.rights.SERVE_MCP,source_unavailable:state.sourceUnavailable,review_required:state.reviewRequired,
    controlled_sql_lifecycle_branch:{observed:state.lifecycleErasureObserved,rolled_back:state.lifecycleRollbackObserved}}));return;}
  if(["/","/evidence-api","/findings"].includes(url.pathname)){response.setHeader("content-type","text/html");response.end(await instance.transformIndexHtml("/",`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script>window.__OBLIGATION_FIXTURE__=${JSON.stringify({workspace,actor})}</script><script type="module" src="/scripts/fixtures/obligation-evidence-workflow.tsx"></script></body></html>`));return;}
  if(!url.pathname.startsWith("/api/"))return next();let body="";for await(const part of request)body+=part;lastApiRequestAt=Date.now();
  const result=await handle(new Request(url,{method:request.method,headers:request.headers,...(["GET","HEAD"].includes(request.method)?{}:{body})}),env);
  if(process.env.E2E_OBLIGATION_EVENT_LOG==="1"&&result.status>=400)console.log(JSON.stringify({marker:"SYNTHETIC_OBLIGATION_HTTP_FAILURE",path:url.pathname,status:result.status,body:await result.clone().text()}));
  response.statusCode=result.status;result.headers.forEach((value,key)=>response.setHeader(key,value));response.flushHeaders();if(!result.body){response.end();return;}await pipeline(Readable.fromWeb(result.body),response);
}
await server.listen();console.log(`SYNTHETIC_OBLIGATION_UI_GATEWAY_FIXTURE http://127.0.0.1:${port}/; SQL projections and controlled state, no hosted writes`);
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{await server.close();process.exit(0);});
