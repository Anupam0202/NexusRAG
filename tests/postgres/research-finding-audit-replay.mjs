// Ordinary retries on disposable executor fixtures; no hosted or provider calls.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");
assert.ok(process.env.PGHOST?.startsWith("/"));
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"];
function input(statement,values={}) {
  const entries=Object.entries(values);assert.ok(entries.every(([key])=>/^[a-z_]+$/.test(key)));
  const params=JSON.stringify(Object.fromEntries(entries.map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  return `set request.jwt.claim.role='service_role';\n${entries.length?`select ${entries.map(([key])=>`p->>'${key}' as "${key}"`).join(",")} from (select '${params.replaceAll("'","''")}'::jsonb p) input\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}) {
  const out=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",maxBuffer:32*1024*1024}).trim();
  return out?JSON.parse(out):null;
}
function concurrent(statement,values) {return new Promise((resolve,reject)=>{
  const child=execFile("psql",args,{encoding:"utf8",maxBuffer:32*1024*1024},(error,out)=>{
    if(error)reject(error);else try{resolve(JSON.parse(out.trim()));}catch(error){reject(error);}
  });child.stdin.end(input(statement,values));
});}
const examples=sql(`select jsonb_agg(to_jsonb(example) order by mode) from (
  select distinct on(r.mode) r.mode,f.workspace_id,f.owner_id,r.id run_id,f.source_research_position result_index
  from public.findings f join public.research_runs r on r.id=f.source_research_run_id
  where f.deleted_at is null and f.revision=1 and public.nexus_research_sources_current(f.workspace_id,r.source_snapshot)
  order by r.mode,f.id) example;`);
assert.deepEqual(examples.map(row=>row.mode).sort(),["COMPARE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH","EVIDENCE_ANSWER","OBLIGATION_ANALYSIS","TIMELINE"]);
const evidence=examples.find(row=>row.mode==="EVIDENCE_ANSWER");
function context(row) {return sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor',
  'membership_revision',w.capability_revision,'policy_id',s.active_policy_id,'policy_version',s.policy_version,
  'deadline',clock_timestamp()+interval '5 minutes') from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,
  {actor:row.owner_id,ws:row.workspace_id});}
// A Quick Lookup uses the same normal persisted-answer path with one question.
const quickContext=context(evidence);
const quickPlan=sql(`select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>(p.plan||
  '{"plan_id":"ordinary-quick-audit-045","mode":"QUICK_LOOKUP","subquestions":[]}'::jsonb),p_key=>'ordinary-quick-audit-045')
  from public.research_runs r join public.research_plans p on p.id=r.plan_id where r.id=:'run';`,{ctx:quickContext,run:evidence.run_id});
sql("update public.nexus_account_usage set free_chat_queries=0 where user_id=:'actor';",{actor:evidence.owner_id});
const quickRun=sql("select public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>'ordinary-quick-audit-045',p_command=>'{\"non_sensitive_attested\":true}');",{ctx:quickContext,plan:quickPlan.id});
const quickClaim=sql("select public.nexus_research_step(:'ctx'::jsonb,'claim',:'run'::uuid,1,0);",{ctx:quickContext,run:quickRun.id});
sql(`select public.nexus_research_step(:'ctx'::jsonb,'commit',:'run'::uuid,1,0,:'token'::uuid,
  (select results->0 from public.research_runs where id=:'original'));`,{ctx:quickContext,run:quickRun.id,token:quickClaim.token,original:evidence.run_id});
examples.push({...evidence,mode:"QUICK_LOOKUP",run_id:quickRun.id,result_index:0});
examples.push({...evidence,mode:"MANUAL",run_id:null,result_index:null});
const rows=[];
for(const example of examples) {
  const ctx=context(example),command={title:`Ordinary ${example.mode} retry`,authored_markdown:"Synthetic reviewer note",
    ...(example.run_id?{research_run_id:example.run_id,result_index:example.result_index}:{})};
  const statement="select public.nexus_finding(:'ctx'::jsonb,'create',null,:'command'::jsonb,null,:'key',repeat('e',64));";
  const values={ctx,command,key:`ordinary-audit-045-${example.mode}`};
  const [first,second]=await Promise.all([concurrent(statement,values),concurrent(statement,values)]);
  assert.equal(first.id,second.id);assert.deepEqual(first,second);
  const count=()=>sql("select count(*) from public.audit_events where workspace_id=:'ws' and action='finding.create' and resource_id=:'id';",{ws:example.workspace_id,id:first.id});
  const afterConcurrent=count();
  const replay=sql(statement,values);assert.deepEqual(replay,first);
  const afterRetry=count();
  assert.equal(sql("select count(*) from public.findings where workspace_id=:'ws' and owner_id=:'actor' and create_key=:'key';",{ws:example.workspace_id,actor:example.owner_id,key:values.key}),1);
  assert.equal(sql("select count(*) from public.finding_versions where workspace_id=:'ws' and finding_id=:'id';",{ws:example.workspace_id,id:first.id}),1);
  const edited=sql("select public.nexus_finding(:'ctx'::jsonb,'edit',:'id'::uuid,:'command'::jsonb,1,null,null);",
    {ctx,id:first.id,command:{title:command.title,authored_markdown:"An independent later authored note"}});
  assert.equal(edited.revision,2);assert.equal(edited.authored_markdown,"An independent later authored note");
  const afterEdit=sql(statement,values);assert.deepEqual(afterEdit,edited);
  assert.equal(afterEdit.generated_markdown,first.generated_markdown);
  assert.equal(afterEdit.source_research_run_id,first.source_research_run_id);
  assert.equal(sql("select count(*) from public.finding_versions where workspace_id=:'ws' and finding_id=:'id';",{ws:example.workspace_id,id:first.id}),2);
  assert.equal(sql("select count(*) from public.audit_events where workspace_id=:'ws' and action='finding.edit' and resource_id=:'id';",{ws:example.workspace_id,id:first.id}),1);
  rows.push({mode:example.mode,findings:1,versions_before_edit:1,versions_after_edit:2,
    after_concurrent_creation_events:afterConcurrent,after_retry_creation_events:afterRetry,after_edit_retry_creation_events:count(),later_note_preserved:true});
}
console.log(JSON.stringify({marker:"ORDINARY_FINDING_AUDIT_REPLAY_OBSERVED",rows,independent_connections:2,provider_processing:false,hosted:false}));
assert.ok(rows.every(row=>row.after_concurrent_creation_events===1&&row.after_retry_creation_events===1&&row.after_edit_retry_creation_events===1),"A normal retry must not report another Finding creation");
console.log("ORDINARY_FINDING_AUDIT_REPLAY_PASS eight_paths_one_creation_event");
