// Actual durable RPCs, concurrent connections and ordinary synthetic lifecycle only.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";

assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222",reviewer="33333333-3333-4333-8333-333333333333";
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"];
function input(statement,values={}){
  const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
  const json=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${json.replaceAll("'","''")}'::jsonb params) x\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}){const text=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",stdio:["pipe","pipe","pipe"],maxBuffer:1024*1024}).trim();return text?JSON.parse(text):null;}
function concurrent(statement,values={}){return new Promise((resolve,reject)=>{
  const child=execFile("psql",args,{encoding:"utf8",maxBuffer:1024*1024},(error,out,stderr)=>{if(error)reject(Object.assign(error,{stderr}));else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}});
  child.stdin.end(input(statement,values));
});}
const doc=randomUUID(),ver=randomUUID(),chunk=randomUUID(),original="Synthetic concurrent package evidence: 1.005 kg.";
const hash=createHash("sha256").update(original).digest("hex");
sql(`insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'reviewer','editor') on conflict(workspace_id,user_id) do update set role='editor';
  insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor','Owned concurrent.txt','Owned concurrent.txt','ready');
  insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,
    chunker_version,lifecycle_epoch,publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
    values(:'ver',:'ws',:'doc','documents',:'ver',:'hash',octet_length(:'original'),now(),'synthetic','synthetic',1,'ready','package-concurrent','non_sensitive',:'actor',now());
  update public.documents set active_version_id=:'ver' where id=:'doc';
  insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
    values(:'chunk',:'ws',:'doc',:'ver',0,:'original',:'original',:'hash',1,'{"page":1}','synthetic-space');`,{ws,reviewer,doc,actor,ver,hash,original,chunk});
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,'policy_id',s.active_policy_id,
  'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '10 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{ws,actor});
const base=sql("select plan from public.research_plans where plan->>'plan_id'='mode-QUICK_LOOKUP';");
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>'package-concurrent-plan');",{ctx,
  plan:{...base,plan_id:"package-concurrent",private_source_ids:[doc],subquestions:[]}});
sql("update public.nexus_account_usage set free_chat_queries=0 where user_id=:'actor';",{actor});
const run=sql("select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>'package-concurrent-run',p_command=>'{\"non_sensitive_attested\":true}');",{ctx,plan:plan.id});
const claim=sql("select public.nexus_research_step(:'ctx'::jsonb,'claim',:'run'::uuid,1,0);",{ctx,run:run.id});
const answer={question:base.question,answer:"Synthetic mass is 1.005 kg [S1].",claim_state:"REVIEW_REQUIRED",abstained:false,
  sources:[{citation_id:"S1",document_id:doc,version_id:ver,chunk_id:chunk,original_content_hash:hash}],validated_citation_ids:["S1"],
  coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"NOT_CALLED",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"};
sql("select public.nexus_research_step(:'ctx'::jsonb,'commit',:'run'::uuid,1,0,:'token'::uuid,:'answer'::jsonb);",{ctx,run:run.id,token:claim.token,answer});
const finding=sql("select public.nexus_finding(:'ctx'::jsonb,'create',null,:'command'::jsonb,null,'package-concurrent-finding',repeat('c',64));",{ctx,
  command:{title:"Concurrent synthetic finding",authored_markdown:"Not certification",research_run_id:run.id,result_index:0}});
const rightsSQL="select public.nexus_finding_export_rights(:'ctx'::jsonb,'record',:'fid'::uuid,:'command'::jsonb,1,:'key');";
const packageSQL="select public.nexus_finding_package(:'ctx'::jsonb,'create',:'fid'::uuid,p_revision=>:'revision'::bigint,p_key=>:'key');";
const readPackage=(id)=>sql("select public.nexus_finding_package(:'ctx'::jsonb,'read',:'fid'::uuid,:'id'::uuid);",{ctx,fid:finding.id,id});
const policy={decision:"ALLOW",basis:"OWNED_CONTENT",rationale:"Synthetic fixture author permission.",evidence_reference:"urn:fixture:concurrent61",
  attribution:"Synthetic fixture author",duties:["Preserve qualifications"],review_by:"2027-01-01T00:00:00Z"};
const command=(expected,decision="ALLOW")=>({selections:[{version_id:ver,expected_review_id:expected}],policy:{...policy,decision}});
const rights=await Promise.all([concurrent(rightsSQL,{ctx,fid:finding.id,key:"same-rights",command:command(null)}),
  concurrent(rightsSQL,{ctx,fid:finding.id,key:"same-rights",command:command(null)})]);
assert.deepEqual(rights[0],rights[1]);
assert.equal(sql("select count(*) from public.finding_export_rights where version_id=:'ver';",{ver}),1);
const competing=await Promise.allSettled([concurrent(rightsSQL,{ctx,fid:finding.id,key:"competing-allow",command:command(rights[0].items[0].review_id)}),
  concurrent(rightsSQL,{ctx,fid:finding.id,key:"competing-deny",command:command(rights[0].items[0].review_id,"DENY")})]);
assert.equal(competing.filter(row=>row.status==="fulfilled").length,1);
assert.ok(String(competing.find(row=>row.status==="rejected").reason.stderr).includes("NR:VERSION_CONFLICT"));
let review=sql("select public.nexus_finding_export_rights(:'ctx'::jsonb,'read',:'fid'::uuid);",{ctx,fid:finding.id});
review=sql(rightsSQL,{ctx,fid:finding.id,key:"restore-before-export",command:command(review.items[0].review_id)});
sql("select public.nexus_finding(:'ctx'::jsonb,'share',:'fid'::uuid,:'command'::jsonb,null,null,null);",{ctx,fid:finding.id,command:{user_id:reviewer,permission:"contribute"}});
const approve=(revision)=>sql("select public.nexus_finding(:'ctx'::jsonb,'review',:'fid'::uuid,'{\"decision\":\"approved\",\"comment\":\"Inspected exact synthetic evidence\"}',:'revision'::bigint,null,null);",{ctx:{...ctx,user_id:reviewer},fid:finding.id,revision});
approve(1);
const same=await Promise.all([concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"same-package"}),concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"same-package"})]);
assert.deepEqual(same[0],same[1]);assert.equal(same[0].state,"ready");
const equivalent=await Promise.all([concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"other-click-a"}),concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"other-click-b"})]);
assert.ok(equivalent.every(row=>row.id===same[0].id));
assert.equal(sql("select count(*) from public.audit_events where action='finding.package' and resource_id=:'fid';",{fid:finding.id}),1);
const race=await Promise.allSettled([concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"racing-export"}),
  concurrent(rightsSQL,{ctx,fid:finding.id,key:"racing-revoke",command:command(review.items[0].review_id,"REVOKED")})]);
assert.equal(race[1].status,"fulfilled");
if(race[0].status==="rejected")assert.ok(String(race[0].reason.stderr).includes("NR:RIGHTS_BLOCKED"));
const withheld=readPackage(same[0].id);assert.equal(withheld.state,"expired");assert.equal(withheld.manifest_text,null);
review=sql(rightsSQL,{ctx,fid:finding.id,key:"restore-after-revoke",command:command(race[1].value.items[0].review_id)});
const current=sql(packageSQL,{ctx,fid:finding.id,revision:1,key:"new-allow-package"});assert.equal(current.state,"ready");assert.notEqual(current.id,same[0].id);
sql("update public.finding_export_rights set policy=jsonb_set(policy,'{review_by}','\"2000-01-01T00:00:00Z\"') where id=:'id';",{id:review.items[0].review_id});
assert.equal(readPackage(current.id).state,"expired");assert.equal(readPackage(current.id).manifest_text,null);
review=sql(rightsSQL,{ctx,fid:finding.id,key:"restore-after-expiry",command:command(review.items[0].review_id)});
const retained=sql(packageSQL,{ctx,fid:finding.id,revision:1,key:"retained-before-capacity"});
sql(`with added as(insert into public.evidence_exports(workspace_id,requested_by,format,state,manifest_hash)
  select :'ws',:'actor','JSON_LD','ready',repeat('d',64) from generate_series(1,1000-(select count(*) from public.finding_packages where workspace_id=:'ws')) returning id)
  insert into public.finding_packages(id,workspace_id,finding_id,finding_revision,manifest_bytes) select id,:'ws',:'fid',1,1 from added;`,{ws,actor,fid:finding.id});
assert.equal(sql("select count(*) from public.finding_packages where workspace_id=:'ws';",{ws}),1000);
const near=await Promise.all([concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"near-capacity-a"}),concurrent(packageSQL,{ctx,fid:finding.id,revision:1,key:"near-capacity-b"})]);
assert.ok(near.every(row=>row.id===retained.id));assert.equal(readPackage(retained.id).manifest_text,retained.manifest_text);
sql("select public.nexus_finding(:'ctx'::jsonb,'edit',:'fid'::uuid,'{\"title\":\"Revised finding\",\"authored_markdown\":\"New qualified context\"}',1,null,null);",{ctx,fid:finding.id});approve(2);
assert.throws(()=>sql(packageSQL,{ctx,fid:finding.id,revision:2,key:"over-capacity"}),error=>String(error.stderr).includes("NR:RESOURCE_LIMIT_EXCEEDED"));
assert.equal(readPackage(retained.id).state,"ready");
console.log(JSON.stringify({marker:"REAL_SQL_FINDING_PACKAGE_CONCURRENCY_PASS",same_intent_one_receipt:true,competing_review_one_conflict:true,
  create_revoke_revalidated:true,expiry_withheld:true,near_capacity_reuse_and_read:1000,new_artifact_capacity_denial:true,
  hosted_provider_or_customer_operations:false}));
