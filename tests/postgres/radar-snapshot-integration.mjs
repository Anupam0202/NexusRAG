// Actual Gateway Radar handler and durable PostgreSQL RPCs. HTTP transport is a
// controlled local bridge; no provider fetch, model, hosted write or scheduling.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {writeFileSync} from "node:fs";
import {handleRadar} from "../../apps/gateway/src/radar.js";
import {handleWorkbench} from "../../apps/gateway/src/workbench.js";
import {normalizeRadarText} from "../../apps/gateway/src/radar-materiality.js";
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222",reviewer="33333333-3333-4333-8333-333333333333";
const provider=`synthetic-radar-native-${randomUUID()}`,args=["-X","-qAt","-v","ON_ERROR_STOP=1"],hash=value=>createHash("sha256").update(value).digest("hex");
function input(statement,values={}){
 const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
 const params=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
 return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${params.replaceAll("'","''")}'::jsonb params) x\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}){const out=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",maxBuffer:64*1024*1024,stdio:["pipe","pipe","pipe"]}).trim();return out?JSON.parse(out):null;}
function concurrent(statement,values={}){return new Promise((resolve,reject)=>{
 const child=execFile("psql",args,{encoding:"utf8",maxBuffer:64*1024*1024},(error,out,stderr)=>{if(error)reject(Object.assign(error,{stderr}));else try{resolve(out.trim()?JSON.parse(out.trim()):null);}catch(error){reject(error);}});child.stdin.end(input(statement,values));
});}
const context=who=>sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '15 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor:who,ws});
sql(`insert into public.workspace_policy_versions(id,workspace_id,version,policy) values('66666666-6666-4666-8666-666666666666',:'ws',1,'{}') on conflict(workspace_id,version) do nothing;
 insert into public.workspace_settings(workspace_id,active_policy_id,policy_version) values(:'ws','66666666-6666-4666-8666-666666666666',1) on conflict(workspace_id) do nothing;
 insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'reviewer','editor') on conflict(workspace_id,user_id) do update set role='editor';
 insert into public.provider_registry(id,display_name,authority,documentation_url,terms_url,status,terms_hash,terms_checked_at) values(:'provider','Synthetic native supplied provider','Synthetic fixture author','https://example.invalid/docs','https://example.invalid/terms','APPROVED',repeat('a',64),now());
 insert into public.workspace_provider_policies(workspace_id,provider_id,status,allowed_actions,rights_hash,reviewed_by,reviewed_at) values(:'ws',:'provider','APPROVED',array['STORE','DISPLAY','MONITOR','EXPORT'],repeat('a',64),:'actor',now());`,{ws,actor,reviewer,provider});
function document(originals,originalBytes=null){
 const doc=randomUUID(),ver=randomUUID(),chunks=originals.map(()=>randomUUID()),whole=originals.join("\n");
 sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status,chunk_count) values(:'doc',:'ws',:'actor','Synthetic supplied.txt','Synthetic supplied.txt','ready',jsonb_array_length(:'originals'::jsonb));
 insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
 values(:'ver',:'ws',:'doc','documents',:'ver',:'hash',:'bytes'::bigint,now(),'synthetic','synthetic',1,'ready','radar-native','non_sensitive',:'actor',now());
 update public.documents set active_version_id=:'ver' where id=:'doc';
 insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
 select (:'chunks'::jsonb->>(ordinal-1)::integer)::uuid,:'ws',:'doc',:'ver',ordinal-1,original,original,encode(sha256(convert_to(original,'UTF8')),'hex'),null,jsonb_build_object('char_start',0,'char_end',length(original)),'synthetic-space' from jsonb_array_elements_text(:'originals'::jsonb) with ordinality x(original,ordinal);`,{doc,ver,ws,actor,hash:hash(whole),bytes:originalBytes??Buffer.byteLength(whole),originals,chunks});
 return {doc,ver,chunks,originals,hash:hash(whole)};
}
let loseCommit=null,loseFinding=null;const calls=[],timings=[];
async function db(_env,path,init={}){
 const url=new URL(`https://local.invalid/${path}`),table=url.pathname.slice(1),p=init.body?JSON.parse(init.body):{},started=performance.now();
 try{
  if(table==="rpc/nexus_radar_contract")return sql("select public.nexus_radar_contract();");
  if(table==="rpc/nexus_radar"){
   calls.push(p.p_operation);
   let result;
   try{result=await concurrent("select public.nexus_radar(:'ctx'::jsonb,:'op',nullif(:'source','')::uuid,nullif(:'id','')::uuid,:'command'::jsonb,nullif(:'key',''),:'limit'::integer,nullif(:'after','')::uuid);",{ctx:p.p_context,op:p.p_operation,source:p.p_source||"",id:p.p_id||"",command:p.p_command,key:p.p_key||"",limit:p.p_limit,after:p.p_after||""});}
   catch(error){const code=String(error.stderr).match(/NR:([A-Z_]+)/)?.[1];if(code)throw Object.assign(new Error(code),{code});throw error;}
   if(p.p_operation==="finding"&&p.p_key===loseFinding){loseFinding=null;throw Object.assign(new Error("Synthetic lost Finding reply after actual SQL commit"),{code:"PERSISTENCE_UNCONFIRMED",status:503});}
   if(p.p_operation==="capture"&&p.p_key===loseCommit){loseCommit=null;throw Object.assign(new Error("Synthetic lost response after actual SQL commit"),{code:"PERSISTENCE_UNCONFIRMED",status:503});}
   return result;
  }
  if(table==="rpc/nexus_finding")return concurrent("select public.nexus_finding(:'ctx'::jsonb,:'op',nullif(:'id','')::uuid,:'command'::jsonb,nullif(:'revision','')::bigint,nullif(:'key',''),nullif(:'hash',''));",{ctx:p.p_context,op:p.p_operation,id:p.p_id||"",command:p.p_command,revision:p.p_revision||"",key:p.p_key||"",hash:p.p_hash||""});
  if(table==="finding_versions"){
   const fid=url.searchParams.get("finding_id")?.slice(3),revision=Number(url.searchParams.get("revision")?.slice(3));assert.ok(/^[a-f0-9-]{36}$/.test(fid||"")&&Number.isSafeInteger(revision)&&revision>=1);
   return sql("select coalesce(jsonb_agg(jsonb_build_object('author_id',author_id)),'[]') from public.finding_versions where workspace_id=:'ws' and finding_id=:'fid' and revision=:'revision'::bigint;",{ws,fid,revision});
  }
  assert.ok(["workspaces","workspace_settings"].includes(table),`Unexpected bridge ${table}`);
  return sql(`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${table} t where ${table==="workspaces"?"id":"workspace_id"}=:'ws';`,{ws});
 }finally{timings.push({operation:p.p_operation||table,milliseconds:performance.now()-started});}
}
async function route(path,{body,key,who=actor,method=body?"POST":"GET"}={}){
 const request=new Request(`https://gateway.invalid/api/v2/radar/${path}`,{method,headers:{...(key?{"idempotency-key":key}:{}),"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
 const response=await handleRadar({request,env:{},user:{id:who},workspace:ws,member:{role:who===actor?"owner":"editor"},serviceRequest:db,json:(_r,_e,value,status=200)=>new Response(JSON.stringify(value),{status})});
 return response.json();
}
const capture=(source,document,revision,key,extra={})=>route(`sources/${source.id}/snapshots`,{key,body:{expected_revision:revision,document_id:document.doc,version_id:document.ver,chunk_ids:document.chunks,captured_at:"2026-10-26T00:00:00Z",rights_rationale:"The synthetic author supplied these retained approved originals.",...extra}});
const makeSource=async suffix=>route("sources",{key:`source-${suffix}`,body:{provider_id:provider,source_url:`https://example.invalid/${suffix}`,title:`Supplied ${suffix}`,kind:"QUOTA",affected_workflows:["research"]}});
const before=document(["\ufeffDaily\u0085quota:\u001c100 requests per account. 📊"]),after=document(["\ufeffDaily quota: 10 requests per account. 📊"]);
const normalized=sql("select to_jsonb(public.nexus_radar_normalize(:'text'));",{text:before.originals[0]});assert.equal(normalized,normalizeRadarText(before.originals[0]));assert.notEqual(hash(normalized),before.hash);
const source=await makeSource("numeric"),sourceRetry=await makeSource("numeric");assert.equal(source.id,sourceRetry.id);
assert.equal(source.monitor.enabled,false);assert.equal(source.monitor.next_run_at,null);
const chunkPage=await route(`documents/${before.doc}/chunks?limit=1&version_id=${before.ver}`);assert.equal(chunkPage.items[0].id,before.chunks[0]);assert.equal(chunkPage.items[0].original_content_hash,before.hash);
const baseline=await capture(source,before,0,"baseline"),baselineRetry=await capture(source,before,0,"baseline");assert.equal(baseline.snapshot.id,baselineRetry.snapshot.id);assert.equal(baseline.change.status,"BASELINE");
loseCommit="changed-lost-response";
await assert.rejects(capture(source,after,1,"changed-lost-response"),error=>error.code==="PERSISTENCE_UNCONFIRMED");
const changed=await capture(source,after,1,"changed-lost-response");assert.equal(changed.snapshot.revision,2);assert.equal(changed.change.materiality,"OPERATIONAL");assert.equal(changed.change.review_state,"PENDING");
assert.equal(sql("select count(*) from public.radar_snapshots where source_id=:'id';",{id:source.id}),2);
const baselineLaterReplay=await capture(source,before,0,"baseline");assert.equal(baselineLaterReplay.snapshot.id,baseline.snapshot.id);assert.equal(baselineLaterReplay.source.revision,2);
await assert.rejects(route(`changes/${changed.change.id}/review`,{key:"self-review",body:{expected_review_revision:0,decision:"approved",comment:"Self"}}),error=>error.code==="FORBIDDEN");
const approve={expected_review_revision:0,decision:"approved",comment:"Inspected exact synthetic originals and comparison qualifications."};
const reviewed=await route(`changes/${changed.change.id}/review`,{key:"independent-review",who:reviewer,body:approve});assert.equal(reviewed.confirmed_review.reviewer_id,reviewer);assert.equal(reviewed.confirmed_review.revision,1);
const findingBody={expected_review_revision:1,title:"📊".repeat(160),authored_markdown:"📊".repeat(10000)};
loseFinding="finding";await assert.rejects(route(`changes/${changed.change.id}/finding`,{key:"finding",body:findingBody}),error=>error.code==="PERSISTENCE_UNCONFIRMED");
const finding=await route(`changes/${changed.change.id}/finding`,{key:"finding",body:findingBody});assert.equal(finding.confirmed_creation.title,findingBody.title);assert.equal(finding.confirmed_creation.authored_markdown_hash,hash(findingBody.authored_markdown));assert.equal(finding.confirmed_creation.authored_markdown_bytes,40000);assert.equal(finding.confirmed_creation.revision,1);
await assert.rejects(route(`changes/${changed.change.id}/finding`,{key:"different-finding-intent",body:{...findingBody,title:"Different submitted intent"}}),error=>error.code==="VERSION_CONFLICT");

assert.equal(finding.source_radar_change_id,changed.change.id);assert.ok(finding.source_run_id==null);assert.ok(finding.source_research_run_id==null);assert.equal(finding.evidence.length,2);assert.deepEqual(finding.evidence.map(item=>item.citation_id),["S1","S2"]);assert.equal(finding.radar_origin.current_hash,changed.change.current_hash);
const ctx=context(actor),otherContext=context(reviewer);
sql("select public.nexus_finding(:'ctx'::jsonb,'share',:'fid'::uuid,:'command'::jsonb,null,null,null);",{ctx,fid:finding.id,command:{user_id:reviewer,permission:"contribute"}});
sql("select public.nexus_finding(:'ctx'::jsonb,'review',:'fid'::uuid,'{\"decision\":\"approved\",\"comment\":\"Inspected exact Finding\"}',1,null,null);",{ctx:otherContext,fid:finding.id});
const rights=sql("select public.nexus_finding_export_rights(:'ctx'::jsonb,'read',:'fid'::uuid);",{ctx,fid:finding.id});
const rightsCommand={selections:rights.items.map(item=>({version_id:item.version_id,expected_review_id:item.review_id})),policy:{decision:"ALLOW",basis:"OWNED_CONTENT",rationale:"Synthetic fixture author owns the supplied originals.",evidence_reference:"urn:fixture:radar-native",attribution:"Synthetic fixture author",duties:[],review_by:"2027-01-01T00:00:00Z"}};
sql("select public.nexus_finding_export_rights(:'ctx'::jsonb,'record',:'fid'::uuid,:'command'::jsonb,1,'radar-native-rights');",{ctx,fid:finding.id,command:rightsCommand});
const pack=sql("select public.nexus_finding_package(:'ctx'::jsonb,'create',:'fid'::uuid,p_revision=>1,p_key=>'radar-native-package');",{ctx,fid:finding.id});assert.equal(pack.state,"ready");assert.equal(hash(pack.manifest_text),pack.manifest_hash);assert.equal(JSON.parse(pack.manifest_text).analysis.id,changed.change.id);
for(let revision=1;revision<=24;revision++)await route(`changes/${changed.change.id}/review`,{key:`history-review-${revision}`,who:reviewer,body:{expected_review_revision:revision,decision:"approved",comment:`Inspected qualification revision ${revision}`}});
const oldReviewReplay=await route(`changes/${changed.change.id}/review`,{key:"independent-review",who:reviewer,body:approve});assert.equal(oldReviewReplay.review_revision,25);assert.equal(oldReviewReplay.reviews.length,20);assert.equal(oldReviewReplay.confirmed_review.revision,1);assert.equal(oldReviewReplay.review_count,25);
const reviewPage=await route(`changes/${changed.change.id}/reviews?limit=20&after=20`);assert.equal(reviewPage.items.length,5);assert.equal(reviewPage.items[0].revision,21);assert.equal(reviewPage.next_after,null);
assert.equal(sql("select count(*) from public.radar_reviews where change_id=:'id';",{id:changed.change.id}),25);
const editedTitle="🧪".repeat(160),editedNote="😀".repeat(10000);
const editedResponse=await handleWorkbench({request:new Request(`https://gateway.invalid/api/v2/findings/${finding.id}`,{method:"PATCH",body:JSON.stringify({revision:1,title:editedTitle,authored_markdown:editedNote})}),env:{},user:{id:actor},workspace:ws,member:{role:"owner"},serviceRequest:db,json:(_r,_e,value,status=200)=>new Response(JSON.stringify(value),{status})});
const edited=await editedResponse.json();assert.equal(edited.revision,2);assert.equal(edited.title,editedTitle);assert.equal(edited.authored_markdown,editedNote);
const findingAfterEditReplay=await route(`changes/${changed.change.id}/finding`,{key:"finding",body:findingBody});assert.equal(findingAfterEditReplay.revision,2);assert.equal(findingAfterEditReplay.title,editedTitle);assert.equal(findingAfterEditReplay.authored_markdown,editedNote);assert.deepEqual(findingAfterEditReplay.confirmed_creation,finding.confirmed_creation);assert.equal(findingAfterEditReplay.radar_origin.review_revision,25);
const concurrentSource=await makeSource("concurrent");await capture(concurrentSource,before,0,"concurrent-baseline");
const same=await Promise.all([capture(concurrentSource,after,1,"concurrent-same"),capture(concurrentSource,after,1,"concurrent-same")]);assert.equal(same[0].snapshot.id,same[1].snapshot.id);
const competing=await Promise.allSettled([capture(concurrentSource,before,2,"competing-a"),capture(concurrentSource,after,2,"competing-b")]);assert.equal(competing.filter(r=>r.status==="fulfilled").length,1);assert.equal(competing.find(r=>r.status==="rejected").reason.code,"VERSION_CONFLICT");
// Actual maximum retained quote bytes. The large document metadata envelope is
// supplied by the existing verified-original contract; this is not an upload test.
const maxOriginal=`Daily quota: 100 requests. ${"📊".repeat(8185)}`;assert.ok(Buffer.byteLength(maxOriginal)<=32768);
const padded=maxOriginal+"x".repeat(32768-Buffer.byteLength(maxOriginal));assert.equal(Buffer.byteLength(padded),32768);
const maximum=document(Array.from({length:156},()=>padded),524288000),maximumSource=await makeSource("maximum");
const maxBaseline=await capture(maximumSource,maximum,0,"max-baseline");assert.equal(maxBaseline.snapshot.selected_utf8_bytes,156*32768);assert.equal(maxBaseline.snapshot.document_original_bytes,524288000);assert.equal(maxBaseline.snapshot.chunk_ids.length,156);assert.equal(maxBaseline.snapshot.comparison_complete,false);
const overlap=await capture(maximumSource,maximum,1,"max-overlap");assert.equal(overlap.change.status,"UNCHANGED");assert.equal(overlap.change.materiality,"NONE");
await assert.rejects(capture(maximumSource,after,2,"max-unselected-before"),error=>error.code==="RESOURCE_LIMIT_EXCEEDED");
const selected=await capture(maximumSource,after,2,"max-explicit-before",{before_chunk_ids:maximum.chunks.slice(0,155)});assert.equal(selected.change.materiality,"REVIEW_REQUIRED");assert.equal(selected.change.selections.before.length,155);assert.equal(selected.change.selections.after.length,1);assert.equal(selected.change.before.chunk_ids.length,156);assert.notEqual(selected.change.previous_hash,selected.change.before.normalized_hash);
const maxReviewed=await route(`changes/${selected.change.id}/review`,{key:"maximum-pair-review",who:reviewer,body:{expected_review_revision:0,decision:"approved",comment:"Inspected the exact155 before originals and one after original; selected coverage only."}});assert.equal(maxReviewed.review_state,"APPROVED");
const maxFinding=await route(`changes/${selected.change.id}/finding`,{key:"maximum-finding",body:{expected_review_revision:1,title:"Maximum selected source change",authored_markdown:"Selected evidence only; larger original and complete provider policy require separate assessment."}});assert.equal(maxFinding.evidence.length,156);
sql("select public.nexus_finding(:'ctx'::jsonb,'share',:'fid'::uuid,:'command'::jsonb,null,null,null);",{ctx,fid:maxFinding.id,command:{user_id:reviewer,permission:"contribute"}});
sql("select public.nexus_finding(:'ctx'::jsonb,'review',:'fid'::uuid,'{\"decision\":\"approved\",\"comment\":\"Inspected exact156 original Finding\"}',1,null,null);",{ctx:otherContext,fid:maxFinding.id});
const maxRights=sql("select public.nexus_finding_export_rights(:'ctx'::jsonb,'read',:'fid'::uuid);",{ctx,fid:maxFinding.id});
sql("select public.nexus_finding_export_rights(:'ctx'::jsonb,'record',:'fid'::uuid,:'command'::jsonb,1,'radar-maximum-rights');",{ctx,fid:maxFinding.id,command:{...rightsCommand,selections:maxRights.items.map(item=>({version_id:item.version_id,expected_review_id:item.review_id}))}});
const maxPackage=sql("select public.nexus_finding_package(:'ctx'::jsonb,'create',:'fid'::uuid,p_revision=>1,p_key=>'radar-maximum-package');",{ctx,fid:maxFinding.id});assert.equal(maxPackage.state,"ready");assert.equal(hash(maxPackage.manifest_text),maxPackage.manifest_hash);
if(process.env.NEXUS_RADAR_PACKAGE_OUTPUT){
 const output=process.env.NEXUS_RADAR_PACKAGE_OUTPUT,countBefore=sql("select count(*) from public.finding_packages where workspace_id=:'ws' and finding_id=:'fid';",{ws,fid:maxFinding.id});
 const receipt=sql("select public.nexus_finding_package(:'ctx'::jsonb,'create_receipt',:'fid'::uuid,p_revision=>1,p_key=>'radar-maximum-package');",{ctx,fid:maxFinding.id});
 assert.equal(receipt.schema_version,"finding-package-receipt/1");assert.equal(receipt.id,maxPackage.id);assert.equal(receipt.manifest_hash,maxPackage.manifest_hash);assert.equal(receipt.manifest_bytes,maxPackage.manifest_bytes);assert.equal(receipt.finding_id,maxPackage.finding_id);assert.equal(receipt.finding_revision,1);assert.equal(receipt.state,"ready");assert.equal(Object.hasOwn(receipt,"manifest_text"),false);
 assert.equal(sql("select count(*) from public.finding_packages where workspace_id=:'ws' and finding_id=:'fid';",{ws,fid:maxFinding.id}),countBefore);
 writeFileSync(output,JSON.stringify(maxPackage)+"\n",{flag:"wx"});writeFileSync(output.replace(/\.json$/,"")+".receipt.json",JSON.stringify(receipt)+"\n",{flag:"wx"});
}
const maxManifest=JSON.parse(maxPackage.manifest_text);assert.equal(maxManifest.evidence.length,156);assert.equal(maxManifest.analysis.before_chunk_ids.length,155);assert.equal(maxManifest.analysis.before.chunk_ids.length,156);assert.equal(maxManifest.analysis.coverage,"SELECTED_CHUNKS_NOT_FULL_DOCUMENT");assert.equal(new Set(maxManifest.evidence.map(item=>item.id)).size,156);assert.deepEqual(maxManifest.evidence.map(item=>item.citation_id),Array.from({length:156},(_,i)=>`S${i+1}`));
const detail=await route(`sources/${source.id}?limit=1`);assert.equal(detail.latest_snapshot.id,changed.snapshot.id);assert.equal(detail.snapshots.items.length,1);assert.ok(detail.snapshots.next_after);const later=await route(`sources/${source.id}?limit=1&after=${detail.snapshots.next_after}`);assert.equal(later.snapshots.items.length,1);assert.notEqual(later.snapshots.items[0].id,detail.snapshots.items[0].id);assert.equal(later.latest_snapshot.id,changed.snapshot.id);
sql("update public.workspace_provider_policies set status='DISABLED' where workspace_id=:'ws' and provider_id=:'provider';",{ws,provider});
const withheld=await route(`changes/${changed.change.id}`);assert.equal(withheld.source_available,false);assert.equal(withheld.before_text_preview,null);assert.equal(withheld.after_text_preview,null);assert.equal(withheld.selections.before.length,1);
await assert.rejects(capture(source,before,2,"rights-withdrawn"),error=>error.code==="RIGHTS_BLOCKED");
const blocked=sql("select public.nexus_finding_package(:'ctx'::jsonb,'read',:'fid'::uuid,:'id'::uuid);",{ctx,fid:finding.id,id:pack.id});assert.equal(blocked.manifest_text,null);assert.equal(blocked.state,"expired");
sql("update public.workspace_provider_policies set status='APPROVED' where workspace_id=:'ws' and provider_id=:'provider'; update public.documents set lifecycle_state='deleting',lifecycle_epoch=lifecycle_epoch+1 where id=:'doc';",{ws,provider,doc:before.doc});
const unavailable=await route(`changes/${changed.change.id}`);assert.equal(unavailable.source_available,false);assert.equal(unavailable.after_text_preview,null);assert.equal(unavailable.before.chunk_ids[0],before.chunks[0]);
assert.equal(sql("select count(*) from public.provider_terms_snapshots where provider_id=:'provider';",{provider}),0);
assert.equal(sql("select count(*) from public.monitors where provider_id=:'provider' and(enabled or next_run_at is not null);",{provider}),0);
const longest=timings.reduce((best,row)=>row.milliseconds>best.milliseconds?row:best,{milliseconds:0});assert.ok(longest.milliseconds<8000,`Actual owned SQL call exceeded unchanged Gateway8s RPC limit: ${JSON.stringify(longest)}`);
console.log(JSON.stringify({marker:"REAL_SQL_RADAR_SUPPLIED_SNAPSHOT_WORKFLOW_PASS",actual_gateway_handler:true,actual_postgres_rpc:true,numeric_materiality:"OPERATIONAL",normalization_parity:true,lost_committed_response_one_snapshot:true,same_intent_concurrency:true,competing_intent_conflict:true,review_count:25,immutable_old_review_receipt:true,immutable_finding_creation_receipt_after_edit:true,finding_creation_lost_committed_response:true,ordinary_finding_edit_unicode_title_codepoints:160,ordinary_finding_edit_unicode_note_codepoints:10000,maximum_original_metadata_envelope_bytes:524288000,maximum_selected_originals:156,maximum_selected_utf8_bytes:156*32768,overlapping_selection_unchanged:true,explicit_before_subset_after_maximum:true,incomplete_projection_requires_review:true,exact_radar_finding_and_package:true,maximum_selected_package_originals:156,rights_withdrawal_content_withheld:true,source_loss_history_retained:true,maximum_rpc_milliseconds:Math.ceil(longest.milliseconds),hosted_provider_or_customer_operations:false}));
