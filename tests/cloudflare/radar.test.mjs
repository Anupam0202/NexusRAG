import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {handle} from "../../apps/gateway/src/preview-worker.js";
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222",policy="33333333-3333-4333-8333-333333333333";
const sourceId="44444444-4444-4444-8444-444444444444",doc="55555555-5555-4555-8555-555555555555",version="66666666-6666-4666-8666-666666666666",chunk="77777777-7777-4777-8777-777777777777",snapshotId="88888888-8888-4888-8888-888888888888",changeId="99999999-9999-4999-8999-999999999999",reviewId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const date="2026-10-26T00:00:00.000Z",sha="a".repeat(64),otherSha="b".repeat(64),env={SUPABASE_URL:"https://radar-peer.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"};
const rights=()=>({decision:"ALLOW",state:"READY",reason_code:"APPROVED",duties:[]});
const source=(revision=1)=>({schema_version:"radar-source/1",id:sourceId,workspace_id:ws,provider_id:"synthetic",source_url:"https://example.invalid/quota",title:"Supplied quota",kind:"QUOTA",revision,latest_snapshot_id:revision?snapshotId:null,created_by:actor,created_at:date,rights:rights(),monitor:{id:reviewId,tier:"MANUAL_REVIEW",retrieval_method:"SUPPLIED_DOCUMENT",enabled:false,next_run_at:null}});
const ref=()=>({id:chunk,document_id:doc,version_id:version,chunk_index:0,original_content_hash:sha,original_bytes:10,location:{page:1}});
const snapshot=(revision=1)=>({schema_version:"radar-snapshot/1",id:snapshotId,workspace_id:ws,source_id:sourceId,document_id:doc,version_id:version,actor_id:actor,change_id:changeId,revision,document_original_hash:sha,document_original_bytes:10,selection_hash:sha,normalized_hash:sha,chunk_ids:[chunk],selected_originals:[ref()],selected_utf8_bytes:10,stored_chunk_count:1,comparison_complete:true,coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT",captured_at:date,recorded_at:date});
const change=(revision=1)=>({schema_version:"radar-change/1",id:changeId,workspace_id:ws,source_id:sourceId,before_snapshot_id:null,after_snapshot_id:snapshotId,previous_hash:null,current_hash:sha,previous_selection_hash:null,current_selection_hash:sha,before_chunk_ids:[],status:"BASELINE",materiality:"NONE",review_state:"NOT_REQUIRED",review_revision:0,finding_id:null,created_at:date,before:null,after:snapshot(revision),coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT",source_available:true,rights:rights(),reviews:[],review_count:0,reviews_next_after:null,review_history_hash:sha,before_text_preview:null,after_text_preview:"Quota 100",preview_truncated:false,selections:{before:[],after:[ref()]}});
const capture=(revision=1)=>({schema_version:"radar-capture/1",source:source(revision),snapshot:snapshot(revision),change:change(revision)});
const command=(revision=0)=>({expected_revision:revision,document_id:doc,version_id:version,chunk_ids:[chunk],captured_at:date,rights_rationale:"Synthetic author supplied this retained lawful original."});
const contract=()=>({schema_version:"radar/1",source_mode:"SUPPLIED_DOCUMENT",max_selected_originals:156,fetch:false,recurring:false,ai:false});
function peer(t,onRpc,role="owner"){
 const calls=[];t.mock.method(globalThis,"fetch",async(input,init={})=>{const url=new URL(input),reply=v=>new Response(JSON.stringify(v));
  if(url.pathname==="/auth/v1/user")return reply({id:actor});
  if(url.pathname==="/rest/v1/workspace_members")return reply([{workspace_id:ws,user_id:actor,role}]);
  if(url.pathname==="/rest/v1/workspaces")return reply([{lifecycle_state:"active",capability_revision:7}]);
  if(url.pathname==="/rest/v1/workspace_settings")return reply([{active_policy_id:policy,policy_version:9}]);
  assert.ok(url.pathname.startsWith("/rest/v1/rpc/"),url.pathname);const data=JSON.parse(init.body);calls.push({name:url.pathname.split("/").at(-1),data});
  if(url.pathname.endsWith("nexus_radar_contract"))return reply(contract());return onRpc(data,reply);
 });return calls;
}
const request=(path,body,key="stable-radar-intent")=>new Request(`https://gateway.invalid/api/v2/radar/${path}`,{method:body?"POST":"GET",headers:{authorization:"Bearer synthetic","x-workspace-id":ws,...(body?{"Idempotency-Key":key}:{})},...(body?{body:JSON.stringify(body)}:{})});
const prepared=(previous=null,current={})=>({schema_version:"radar-prepare/1",replayed:false,source:source(0),previous,current:{document_id:doc,version_id:version,chunk_ids:[chunk],normalized_hash:sha,selection_hash:sha,normalized_text:"Daily quota: 100 requests.",comparison_complete:true,...current}});
const previous=()=>({document_id:doc,version_id:version,chunk_ids:[chunk],normalized_hash:otherSha,selection_hash:sha,normalized_text:"Daily quota: 100 requests.",comparison_complete:true});
test("actual Worker routes bounded source listing through current workspace context",async t=>{
 peer(t,(data,reply)=>{assert.equal(data.p_operation,"sources_list");assert.equal(data.p_limit,20);assert.equal(data.p_context.user_id,actor);assert.equal(data.p_context.workspace_id,ws);assert.equal(data.p_context.membership_revision,7);assert.ok(Date.parse(data.p_context.deadline)-Date.now()<=30000);return reply({schema_version:"radar-source-list/1",items:[source()],next_after:null});});
 const response=await handle(request("sources"),env);assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,sourceId);
});
test("initial retained baseline succeeds only after actual prepare and confirmed capture",async t=>{
 const calls=peer(t,(data,reply)=>{assert.equal(data.p_key,"stable-radar-intent");if(data.p_operation==="prepare_snapshot")return reply(prepared());assert.equal(data.p_operation,"capture");assert.equal(data.p_command.classification.materiality,"NONE");assert.equal(data.p_command.classification.previous_hash,null);return reply(capture());});
 const response=await handle(request(`sources/${sourceId}/snapshots`,command()),env);assert.equal(response.status,201);assert.equal((await response.json()).change.status,"BASELINE");assert.deepEqual(calls.map(x=>x.name==="nexus_radar_contract"?"contract":x.data.p_operation),["contract","prepare_snapshot","capture"]);
});
for(const [label,current,expected] of [["numeric quota",{normalized_text:"Daily quota: 10 requests."},"OPERATIONAL"],["incomplete selected evidence",{normalized_text:"Daily quota: 10 requests.",comparison_complete:false},"REVIEW_REQUIRED"],["changed complete hash beyond equal prefix",{normalized_text:"Daily quota: 100 requests."},"REVIEW_REQUIRED"]])test(`${label} is classified with full hash binding`,async t=>{
 peer(t,(data,reply)=>{if(data.p_operation==="prepare_snapshot")return reply(prepared(previous(),current));if(data.p_operation==="capture"){assert.equal(data.p_command.classification.materiality,expected);assert.equal(data.p_command.classification.previous_hash,otherSha);assert.equal(data.p_command.classification.current_hash,sha);return reply(capture());}return reply({});});
 assert.equal((await handle(request(`sources/${sourceId}/snapshots`,command()),env)).status,201);
});
test("old capture intent confirms historical snapshot while preserving newer source revision",async t=>{
 const saved=capture();saved.source=source(5);peer(t,(_data,reply)=>reply({schema_version:"radar-prepare/1",replayed:true,result:saved}));const response=await handle(request(`sources/${sourceId}/snapshots`,command()),env);assert.equal(response.status,201);assert.equal((await response.json()).source.revision,5);
});
for(const [field,value] of [["revision",2],["document_id",sourceId],["version_id",sourceId],["actor_id",sourceId],["chunk_ids",[sourceId]]])test(`unconfirmed capture ${field} fails explicitly`,async t=>{
 const saved=capture();saved.snapshot[field]=value;peer(t,(data,reply)=>reply(data.p_operation==="prepare_snapshot"?{schema_version:"radar-prepare/1",replayed:true,result:saved}:{}));const response=await handle(request(`sources/${sourceId}/snapshots`,command()),env);assert.equal(response.status,503);assert.equal((await response.json()).error.code,"PERSISTENCE_UNCONFIRMED");
});
function reviewed(){const value=change();return {...value,review_revision:25,confirmed_review:{id:reviewId,reviewer_id:actor,revision:21,decision:"approved",comment:"Exact intent",created_at:date,affected_workflows:[]},reviews:[],review_count:25,reviews_next_after:20};}
test("review retry confirms immutable intent receipt beyond bounded first history page",async t=>{
 peer(t,(_data,reply)=>reply(reviewed()));const response=await handle(request(`changes/${changeId}/review`,{expected_review_revision:20,decision:"approved",comment:"Exact intent",affected_workflows:[]}),env);assert.equal(response.status,201);assert.equal((await response.json()).confirmed_review.revision,21);
});
for(const [field,value] of [["reviewer_id",sourceId],["revision",22],["decision","changes_requested"],["comment","Different intent"],["affected_workflows",["unexpected"]]])test(`unconfirmed immutable review ${field} fails explicitly`,async t=>{
 const valueToReturn=reviewed();valueToReturn.confirmed_review[field]=value;peer(t,(_data,reply)=>reply(valueToReturn));const response=await handle(request(`changes/${changeId}/review`,{expected_review_revision:20,decision:"approved",comment:"Exact intent",affected_workflows:[]}),env);assert.equal(response.status,503);
});
for(const [name,patch] of [["duplicate selected IDs",{chunk_ids:[chunk,chunk]}],["unknown original",{chunk_ids:["unavailable"]}],["negative revision",{expected_revision:-1}],["future captured time",{captured_at:"2999-01-01T00:00:00Z"}],["blank rationale",{rights_rationale:" "}]])test(`${name} cannot start a durable capture`,async t=>{
 const calls=peer(t,()=>{throw Error("Unexpected mutation");});const response=await handle(request(`sources/${sourceId}/snapshots`,{...command(),...patch}),env);assert.equal(response.status,422);assert.equal(calls.filter(x=>x.name==="nexus_radar").length,0);
});
test("viewer may inspect history but cannot capture supplied evidence",async t=>{
 const calls=peer(t,()=>{throw Error("Unexpected mutation");},"viewer");const response=await handle(request(`sources/${sourceId}/snapshots`,command()),env);assert.equal(response.status,403);assert.equal(calls.filter(x=>x.name==="nexus_radar").length,0);
});
test("provider rights failure records only a failed run and never returns snapshot success",async t=>{
 const calls=peer(t,(data,reply)=>data.p_operation==="prepare_snapshot"?new Response(JSON.stringify({code:"P0001",message:"NR:RIGHTS_BLOCKED"}),{status:400}):reply({schema_version:"radar-failed-run/1"}));
 const response=await handle(request(`sources/${sourceId}/snapshots`,command()),env);assert.equal(response.status,403);assert.equal((await response.json()).error.code,"RIGHTS_BLOCKED");assert.deepEqual(calls.filter(x=>x.name==="nexus_radar").map(x=>x.data.p_operation),["prepare_snapshot","record_failure"]);
});

const creationCommand=()=>({expected_review_revision:1,title:"Original submitted title",authored_markdown:"Original submitted qualification 📊"});
function createdFinding(){const body=creationCommand();return {id:reviewId,workspace_id:ws,revision:3,title:"Later edited title",authored_markdown:"Later edited qualification",source_radar_change_id:changeId,radar_origin:{id:changeId},source_unavailable:false,evidence:[],confirmed_creation:{schema_version:"radar-finding-creation/1",workspace_id:ws,finding_id:reviewId,change_id:changeId,created_by:actor,revision:1,expected_review_revision:1,title:body.title,authored_markdown_hash:createHash("sha256").update(body.authored_markdown).digest("hex"),authored_markdown_bytes:Buffer.byteLength(body.authored_markdown)}};}
test("old Finding creation intent confirms original receipt while projecting current edit",async t=>{
 peer(t,(_data,reply)=>reply(createdFinding()));const response=await handle(request(`changes/${changeId}/finding`,creationCommand()),env);assert.equal(response.status,201);assert.equal((await response.json()).revision,3);
});
for(const [field,value] of [["created_by",sourceId],["finding_id",sourceId],["change_id",sourceId],["revision",2],["expected_review_revision",2],["title","Different title"],["authored_markdown_hash",otherSha],["authored_markdown_bytes",999]])test(`unconfirmed immutable Finding creation ${field} fails explicitly`,async t=>{
 const result=createdFinding();result.confirmed_creation[field]=value;peer(t,(_data,reply)=>reply(result));const response=await handle(request(`changes/${changeId}/finding`,creationCommand()),env);assert.equal(response.status,503);
});
