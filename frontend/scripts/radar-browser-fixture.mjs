import assert from "node:assert/strict";
import {createServer} from "vite";
import react from "@vitejs/plugin-react";
import {readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {Readable} from "node:stream";
import {pipeline} from "node:stream/promises";
import {handle} from "../../apps/gateway/src/preview-worker.js";

// Actual pages, client and Gateway; controlled storage transport replays actual
// disposable-SQL fixture projections. This process does not prove SQL durability,
// hosted identity, permission to fetch a provider URL, or production operation.
const root=resolve(dirname(fileURLToPath(import.meta.url)),".."),port=Number(process.argv[2]||3036);
const fixture=JSON.parse(await readFile(process.env.E2E_RADAR_SQL_FIXTURE||resolve(root,"../tests/fixtures/radar-snapshot-sql.json"),"utf8"));
assert.equal(fixture.schema_version,"radar-browser-sql-fixture/1");
assert.equal(fixture.finding.confirmed_creation.schema_version,"radar-finding-creation/1");
const workspace=fixture.empty_source.workspace_id,actor=fixture.empty_source.created_by;
const reviewer=fixture.approved_change.confirmed_review.reviewer_id,policy="44444444-4444-4444-8444-444444444444";
const env={SUPABASE_URL:"https://radar-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const originalFetch=globalThis.fetch;
let state,lastApiRequestAt=0;
function reset(){state={sourceSaved:false,phase:0,reviewed:false,findingSaved:false,findingShared:false,findingReviewed:false,
  rightsApproved:false,packageSaved:false,packageInterrupted:false,sourceUnavailable:false,captureKeys:new Map(),captureAttempts:[],captureCommits:0};}
reset();
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json",...headers}});
const storageError=(code,status=400)=>json({code:"P0001",message:`NR:${code}`},status);
const currentSource=()=>state.phase===0?fixture.empty_source:state.phase===1?fixture.baseline_capture.source:fixture.changed_capture.source;
function currentChange(){const value=state.reviewed?fixture.approved_change:fixture.changed_capture.change;
  return {...value,finding_id:state.findingSaved?fixture.finding.id:null,...(state.sourceUnavailable?{source_available:false,before_text_preview:null,after_text_preview:null}:{})};}
function sourceDetail(){
  if(state.phase===0)return {schema_version:"radar-source-detail/1",source:fixture.empty_source,latest_snapshot:null,snapshots:{items:[],next_after:null},changes:{items:[],next_after:null},runs:{schema_version:"radar-run-list/1",items:[],next_after:null}};
  if(state.phase===1)return {schema_version:"radar-source-detail/1",source:fixture.baseline_capture.source,latest_snapshot:fixture.baseline_capture.snapshot,
    snapshots:{items:[fixture.baseline_capture.snapshot],next_after:null},changes:{items:[fixture.baseline_capture.change],next_after:null},runs:{...fixture.source_detail.runs,items:fixture.source_detail.runs.items.filter(run=>run.id===fixture.baseline_capture.change.id)}};
  return {...fixture.source_detail,source:currentSource(),changes:{items:[currentChange(),fixture.baseline_capture.change],next_after:null}};
}
function finding(user){const value=structuredClone(state.findingReviewed?fixture.finding_reviewed:fixture.finding);
  value.permission=user===actor?"owner":"contribute";
  value.participants=state.findingShared?fixture.finding_reviewed.participants:[];
  if(state.sourceUnavailable){value.source_unavailable=true;value.generated_markdown=null;value.evidence=[];value.radar_origin.source_available=false;}
  return value;}
const packageMetadata=()=>{const {manifest_text,...metadata}=fixture.package;void manifest_text;
  return {...metadata,...(state.sourceUnavailable?{state:"expired",reason:"SOURCE_UNAVAILABLE"}:{})};};
const selection=(snapshot,text)=>({...snapshot,normalized_text:text});
globalThis.fetch=async(input,init={})=>{
  const url=new URL(input);if(url.hostname!=="radar-peer.invalid")return originalFetch(input,init);
  const data=init.body?JSON.parse(init.body):{},headers=new Headers(init.headers),token=headers.get("authorization")||"";
  const user=token.includes("synthetic-research-browser:")?token.split(":").at(-1):data.p_context?.user_id||actor;
  if(url.pathname==="/auth/v1/user")return json({id:user});
  if(url.pathname==="/rest/v1/workspace_members"){
    const requested=url.searchParams.get("user_id");
    if(init.method==="HEAD")return json(null,200,{"content-range":"0-1/2"});
    if(requested?.startsWith("eq."))return json([{workspace_id:workspace,user_id:requested.slice(3),role:requested.slice(3)===actor?"owner":"editor",workspaces:{lifecycle_state:"active"}}]);
    return json([{workspace_id:workspace,user_id:actor,role:"owner",profiles:{display_name:"Synthetic author"}},
      {workspace_id:workspace,user_id:reviewer,role:"editor",profiles:{display_name:"Synthetic independent reviewer"}}]);
  }
  if(url.pathname==="/rest/v1/workspaces")return json([{id:workspace,name:"Synthetic Radar workspace",lifecycle_state:"active",capability_revision:1}]);
  if(url.pathname==="/rest/v1/workspace_settings")return json([{active_policy_id:policy,policy_version:1}]);
  if(url.pathname==="/rest/v1/documents")return json([fixture.chunks_before,fixture.chunks_after].map((chunks,index)=>({id:chunks.document_id,
    workspace_id:workspace,filename:index?"Supplied after.txt":"Supplied before.txt",status:"ready",file_type:"txt",file_size:chunks.document_original_bytes,
    chunk_count:chunks.stored_chunk_count,lifecycle_state:"active",active_version_id:chunks.version_id,created_at:"2026-10-26T00:00:00Z"})));
  if(url.pathname==="/rest/v1/finding_versions")return json([{author_id:actor}]);
  if(url.pathname==="/rest/v1/rpc/nexus_management_version")return json({version:"036"});
  if(url.pathname==="/rest/v1/rpc/nexus_invitation_version")return json({version:"040",recipient_bound:true,manual_delivery:true});
  if(url.pathname==="/rest/v1/rpc/nexus_radar_contract")return json({schema_version:"radar/1",source_mode:"SUPPLIED_DOCUMENT",max_selected_originals:156,fetch:false,recurring:false,ai:false});
  if(url.pathname==="/rest/v1/rpc/nexus_radar"){
    const command=data.p_command;
    if(data.p_operation==="providers")return json(fixture.providers);
    if(data.p_operation==="sources_list")return json({schema_version:"radar-source-list/1",items:state.sourceSaved?[currentSource()]:[],next_after:null});
    if(data.p_operation==="source_create"){assert.equal(command.title,fixture.empty_source.title);assert.equal(command.source_url,fixture.empty_source.source_url);
      assert.equal(command.provider_id,fixture.empty_source.provider_id);state.sourceSaved=true;return json(fixture.empty_source);}
    if(data.p_operation==="source_read")return json(sourceDetail());
    if(data.p_operation==="chunks")return json(data.p_id===fixture.chunks_before.document_id?fixture.chunks_before:fixture.chunks_after);
    if(data.p_operation==="prepare_snapshot"){
      const saved=state.captureKeys.get(data.p_key);state.captureAttempts.push({key:data.p_key,command});
      if(saved){assert.deepEqual(command,saved.command);return json({schema_version:"radar-prepare/1",replayed:true,result:saved.result});}
      const current=command.expected_revision===0?fixture.baseline_capture:fixture.changed_capture;
      return json({schema_version:"radar-prepare/1",replayed:false,source:currentSource(),previous:command.expected_revision===0?null:selection(fixture.baseline_capture.snapshot,fixture.changed_capture.change.before_text_preview),
        current:selection(current.snapshot,current.change.after_text_preview)});
    }
    if(data.p_operation==="capture"){
      const {classification,...intent}=command;
      assert.equal(classification.materiality,command.expected_revision===0?"NONE":"OPERATIONAL");
      const result=command.expected_revision===0?fixture.baseline_capture:fixture.changed_capture;
      state.captureKeys.set(data.p_key,{command:intent,result});state.phase=command.expected_revision+1;state.captureCommits++;
      return json({code:"08006",message:"Synthetic response interrupted after committed capture"},503);
    }
    if(data.p_operation==="change_read")return json(data.p_id===fixture.baseline_capture.change.id?fixture.baseline_capture.change:currentChange());
    if(data.p_operation==="review"){
      assert.equal(data.p_context.user_id,reviewer);assert.equal(command.comment,fixture.approved_change.confirmed_review.comment);
      state.reviewed=true;return json(currentChange());
    }
    if(data.p_operation==="finding"){
      assert.equal(data.p_context.user_id,actor);assert.equal(command.title,fixture.finding.title);assert.equal(command.authored_markdown,fixture.finding.authored_markdown);
      state.findingSaved=true;return json(finding(actor));
    }
    if(data.p_operation==="record_failure")return json({recorded:true});
    throw new Error(`Unexpected Radar fixture operation ${data.p_operation}`);
  }
  if(url.pathname==="/rest/v1/rpc/workbench_read")return json({items:state.findingSaved?[finding(data.p_context.user_id)]:[],next_after:null});
  if(url.pathname==="/rest/v1/rpc/nexus_finding"){
    if(data.p_operation==="read")return json(finding(data.p_context.user_id));
    if(data.p_operation==="share"){state.findingShared=true;return json(finding(data.p_context.user_id));}
    if(data.p_operation==="review"){assert.equal(data.p_context.user_id,reviewer);state.findingReviewed=true;return json(finding(reviewer));}
    throw new Error(`Unexpected Finding fixture operation ${data.p_operation}`);
  }
  if(url.pathname==="/rest/v1/rpc/nexus_finding_export_rights"){
    if(state.sourceUnavailable)return storageError("SOURCE_UNAVAILABLE");
    if(data.p_operation==="record")state.rightsApproved=true;
    return json(state.rightsApproved?fixture.rights_approved:fixture.rights_initial);
  }
  if(url.pathname==="/rest/v1/rpc/nexus_finding_package"){
    if(data.p_operation==="list")return json({schema_version:"finding-package-list/1",items:state.packageSaved?[packageMetadata()]:[],next_after:null});
    if(data.p_operation==="read")return state.sourceUnavailable?storageError("SOURCE_UNAVAILABLE"):json(fixture.package);
    if(data.p_operation==="create_receipt"){
      state.packageSaved=true;
      if(!state.packageInterrupted){state.packageInterrupted=true;return json({code:"08006",message:"Synthetic package reply interrupted after commit"},503);}
      return json({...packageMetadata(),schema_version:"finding-package-receipt/1"});
    }
  }
  throw new Error(`Unexpected controlled Radar storage path ${url.pathname}`);
};
const server=await createServer({root,configFile:false,envFile:false,cacheDir:process.env.NEXUSRAG_FIXTURE_CACHE_DIR,
  optimizeDeps:{entries:["scripts/fixtures/radar-workflow.tsx"],include:["react","react-dom/client","react/jsx-runtime","react/jsx-dev-runtime","lucide-react","zustand","clsx","tailwind-merge","framer-motion"],force:true,holdUntilCrawlEnd:true},
  plugins:[react(),{name:"synthetic-radar-transport",configureServer(instance){instance.middlewares.use((request,response,next)=>void serve(request,response,next,instance).catch(error=>{
    console.error(error);response.statusCode=500;response.end("Synthetic Radar fixture failed");}));}}],
  resolve:{alias:[{find:"@/lib/api-context",replacement:resolve(root,"scripts/fixtures/research-context.ts")},{find:"@",replacement:resolve(root,"src")}]},
  define:{"process.env":JSON.stringify({NODE_ENV:"development",NEXT_PUBLIC_API_URL:`http://127.0.0.1:${port}`})},
  server:{host:"127.0.0.1",port,strictPort:true,watch:{ignored:["**/.next/**","**/.open-next/**"]}}});
async function serve(request,response,next,instance){const url=new URL(request.url,`http://127.0.0.1:${port}`);
  if(url.pathname==="/__fixture__/reset"){reset();response.setHeader("content-type","application/json");response.end(JSON.stringify({reset:true}));return;}
  // Observe the real unchanged Gateway window; never clear its request buckets.
  if(url.pathname==="/__fixture__/quota-window"){response.setHeader("content-type","application/json");response.end(JSON.stringify({remaining_ms:Math.max(0,lastApiRequestAt+60_050-Date.now())}));return;}
  if(url.pathname==="/__fixture__/source-unavailable"){state.sourceUnavailable=true;response.end("{}");return;}
  if(url.pathname==="/__fixture__/summary"){response.setHeader("content-type","application/json");response.end(JSON.stringify({capture_commits:state.captureCommits,
    capture_attempts:state.captureAttempts,capture_distinct_keys:state.captureKeys.size,independent_pair_review:state.reviewed,independent_finding_review:state.findingReviewed,
    rights_review:state.rightsApproved,package_saved:state.packageSaved,source_withheld:state.sourceUnavailable}));return;}
  if(["/","/radar","/findings"].includes(url.pathname)){response.setHeader("content-type","text/html");response.end(await instance.transformIndexHtml("/",
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/radar-workflow.tsx"></script></body></html>'));return;}
  if(!url.pathname.startsWith("/api/"))return next();
  let body="";for await(const part of request)body+=part;
  lastApiRequestAt=Date.now();
  const result=await handle(new Request(url,{method:request.method,headers:request.headers,...(["GET","HEAD"].includes(request.method)?{}:{body})}),env);
  if(process.env.E2E_RADAR_EVENT_LOG==="1"&&result.status>=400)console.log(JSON.stringify({marker:"SYNTHETIC_RADAR_HTTP_FAILURE",path:url.pathname,status:result.status,body:await result.clone().text()}));
  response.statusCode=result.status;result.headers.forEach((value,key)=>response.setHeader(key,value));response.flushHeaders();
  if(!result.body){response.end();return;}await pipeline(Readable.fromWeb(result.body),response);
}
await server.listen();console.log(`SYNTHETIC_RADAR_UI_GATEWAY_FIXTURE http://127.0.0.1:${port}/; actual SQL projections with controlled transport, no hosted writes`);
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,async()=>{await server.close();process.exit(0);});
