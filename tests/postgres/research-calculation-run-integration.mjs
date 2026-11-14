// CALCULATION runs through the production executor, run, step and finding handlers, on owned local SQL with
// controlled provider peers. Checks that the database stores only results it computes itself.
import assert from "node:assert/strict";
import {execFile,execFileSync} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {processResearchMessage} from "../../apps/gateway/src/research-executor.js";
import {handleResearchRuns} from "../../apps/gateway/src/research-runs.js";
import {handleWorkbench} from "../../apps/gateway/src/workbench.js";
import {calculateBinary,CALCULATION_OPERATIONS} from "../../apps/gateway/src/research-calculation-runs.js";

assert.equal(process.env.NEXUS_DISPOSABLE_SQL,"1");assert.ok(process.env.PGHOST?.startsWith("/"));
const ws="11111111-1111-4111-8111-111111111111",actor="22226161-2222-4222-8222-222222222222",reviewer="33333333-3333-4333-8333-333333333333";
const args=["-X","-qAt","-v","ON_ERROR_STOP=1"];
function input(statement,values) {
  const keys=Object.keys(values);assert.ok(keys.every(key=>/^[a-z_]+$/.test(key)));
  const params=JSON.stringify(Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==="string"?value:JSON.stringify(value)])));
  return `set request.jwt.claim.role='service_role';\n${keys.length?`select ${keys.map(key=>`params->>'${key}' as "${key}"`).join(",")} from (select '${params.replaceAll("'","''")}'::jsonb params) input\n\\gset\n`:""}${statement}`;
}
function sql(statement,values={}) {
  try {const output=execFileSync("psql",args,{input:input(statement,values),encoding:"utf8",maxBuffer:32*1024*1024,stdio:["pipe","pipe","pipe"]}).trim();return output?JSON.parse(output):null;}
  catch(error){const code=String(error.stderr||error).match(/NR:([A-Z_]+)/)?.[1];if(code)throw Object.assign(new Error(`Disposable SQL ${code}`),{code});throw error;}
}
const connections=[];
function concurrent(expression,values) {
  const statement=`with ready as materialized(select pg_backend_pid() pid,clock_timestamp() began),
    waiting as materialized(select pg_sleep(0.5) from ready),result as materialized(select ${expression} value from waiting)
    select jsonb_build_object('pid',ready.pid,'began',ready.began,'ended',clock_timestamp(),'result',result.value) from ready,result;`;
  return new Promise((resolve,reject)=>{const child=execFile("psql",args,{encoding:"utf8",maxBuffer:32*1024*1024},(error,out,stderr)=>{
    if(error){const code=String(stderr||error).match(/NR:([A-Z_]+)/)?.[1];return reject(code?Object.assign(new Error(`Disposable SQL ${code}`),{code}):error);}
    try{const value=JSON.parse(out.trim());connections.push(value);resolve(value);}catch(error){reject(error);}});child.stdin.end(input(statement,values));});
}
function overlap(a,b) {assert.notEqual(a.pid,b.pid);assert.ok(Date.parse(a.began)<=Date.parse(b.ended)&&Date.parse(b.began)<=Date.parse(a.ended),"Independent SQL sessions must actually overlap");}

// The arithmetic the gateway runs and the database function it is checked against agree, refusals included.
const values=["0.1","0.2","1","3","-1","8","-125","9007199254740993.1","1e128","1e-128","2.5","-2.5","0.005","1234.5","1500","0","+7","12.",".5","1E3","-0.0"];
let seed=61;const rand=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
const cases=CALCULATION_OPERATIONS.flatMap(operation=>Array.from({length:60},()=>({operation,precision:[0,1,2,3,6,18][rand(6)],
  left:{value:values[rand(values.length)],unit:rand(4)?"USD":"EUR",evidence_ids:["Q1"]},right:{value:values[rand(values.length)],unit:rand(4)?"USD":"EUR",evidence_ids:["Q2"]}})));
const database=sql(`create function pg_temp.try_calculation(p jsonb) returns jsonb language plpgsql as 'begin return public.nexus_calculate_binary(p);
  exception when others then return jsonb_build_object(''error'',sqlerrm); end';
  select jsonb_agg(pg_temp.try_calculation(value) order by position) from jsonb_array_elements(:'cases'::jsonb) with ordinality t(value,position);`,{cases});
let parityRefusals=0;
cases.forEach((value,i)=>{
  const mine=calculateBinary(value),theirs=database[i];
  if(theirs.error){parityRefusals++;assert.ok(mine.error,JSON.stringify(value));assert.equal(mine.error==="INVALID",!theirs.error.includes("CALCULATION_INVALID"),JSON.stringify(value));}
  else assert.deepEqual(mine,theirs,JSON.stringify(value));
});

const documents=[
  {id:"ca1c0000-0000-4000-8100-000000000001",version:"ca1c0200-0000-4000-8100-000000000001",chunk:"ca1c0100-0000-4000-8100-000000000001",filename:"Synthetic annual report.txt",
    text:"\u{1f4c8} Revenue in fiscal 2023 was EUR 1,234.5 million, up from EUR 1,100.0 million in fiscal 2022.",page:3},
  {id:"ca1c0000-0000-4000-8100-000000000002",version:"ca1c0200-0000-4000-8100-000000000002",chunk:"ca1c0100-0000-4000-8100-000000000002",filename:"Synthetic headcount.txt",
    text:"Headcount at year end: 120 people (2023). Revenue per person is not reported here.",page:null},
  {id:"ca1c0000-0000-4000-8100-000000000003",version:"ca1c0200-0000-4000-8100-000000000003",chunk:"ca1c0100-0000-4000-8100-000000000003",filename:"Synthetic canteen notice.txt",
    text:"The canteen opens at eight.",page:1},
];
sql(`insert into auth.users(id,email,raw_user_meta_data) values(:'actor','calculation-runs061@example.invalid','{}');
 insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'actor','editor');
 insert into public.workspace_members(workspace_id,user_id,role) values(:'ws',:'reviewer','editor') on conflict(workspace_id,user_id) do update set role='editor';`,{actor,ws,reviewer});
for(const document of documents) {
  const hash=createHash("sha256").update(document.text).digest("hex");
  sql(`insert into public.documents(id,workspace_id,uploaded_by,filename,original_filename,status) values(:'doc',:'ws',:'actor',:'name',:'name','ready');
 insert into public.document_versions(id,workspace_id,document_id,original_bucket,original_key,original_hash,original_bytes,original_verified_at,parser_version,chunker_version,lifecycle_epoch,
   publication_state,index_generation,data_classification,classification_declared_by,classification_declared_at)
 values(:'version',:'ws',:'doc','documents',:'doc',:'hash',1024,now(),'synthetic','synthetic',1,'ready','calculation061-generation','non_sensitive',:'actor',now());
 update public.documents set active_version_id=:'version' where id=:'doc';
 insert into public.document_chunks(id,workspace_id,document_id,version_id,chunk_index,content,original_text,original_content_hash,page_number,location,embedding_space_id)
 values(:'chunk',:'ws',:'doc',:'version',0,:'text',:'text',:'hash',nullif(:'page','')::integer,:'location'::jsonb,'synthetic-space');`,
   {doc:document.id,ws,actor,name:document.filename,version:document.version,hash,chunk:document.chunk,text:document.text,page:document.page??"",
    location:{char_start:0,char_end:Array.from(document.text).length}});
}
const ctx=sql(`select jsonb_build_object('workspace_id',w.id,'user_id',:'actor','membership_revision',w.capability_revision,
 'policy_id',s.active_policy_id,'policy_version',s.policy_version,'deadline',clock_timestamp()+interval '20 minutes')
 from public.workspaces w join public.workspace_settings s on s.workspace_id=w.id where w.id=:'ws';`,{actor,ws});
const questions=["By what percentage did revenue grow from fiscal 2022 to fiscal 2023?","What was revenue per person in fiscal 2023?","How many tonnes of steel were bought?"];
const planPayload={plan_id:"actual-calculation061-plan",mode:"CALCULATION",question:questions[0],subquestions:questions.slice(1),
  private_source_ids:documents.map(document=>document.id),public_provider_ids:[],date_from:null,date_to:null,jurisdiction:null,entity_scope:[],rights_constraints:[],
  expected_calculations:["Percent change in revenue from fiscal 2022 to fiscal 2023","Revenue divided by year-end headcount"],
  completion_criteria:["Every figure is checked against its source passage."]};
const plan=sql("select public.nexus_research_plan(:'ctx'::jsonb,'create',p_plan=>:'plan'::jsonb,p_key=>'actual-calculation061-plan');",{ctx,plan:planPayload});
const start="public.nexus_research_run(:'ctx'::jsonb,'create',:'plan'::uuid,p_key=>:'key',p_command=>'{\"non_sensitive_attested\":true}')";
const starts=await Promise.all([concurrent(start,{ctx,plan:plan.id,key:"actual-calculation061-start"}),concurrent(start,{ctx,plan:plan.id,key:"actual-calculation061-start"})]);
overlap(...starts);assert.equal(starts[0].result.id,starts[1].result.id);let run=starts[0].result;
assert.equal(run.mode,"CALCULATION");assert.equal(run.questions.length,3);assert.equal(run.source_snapshot.length,3);assert.equal(run.total_steps,3);
assert.deepEqual(run.requested_calculations,planPayload.expected_calculations);
assert.ok(Math.abs((Date.parse(run.deadline)-Date.parse(run.created_at))/1000-180)<2,"A calculation run has 180 seconds");

// Gemini, as these synthetic passages would have it answer: figures by quotation, operations by name, no numbers of its own.
let generations=0,expansions=0,nextFailure=null;const sent=[],committed=[];
const wireFor=(question,sources)=>{
  const passage=text=>sources.find(source=>source.content.includes(text));
  const revenue=passage("Revenue in fiscal 2023"),people=passage("Headcount at year end");
  if(question===questions[0])return {schema_version:"research-calculation-wire/1",quantities:[
    {label:"Revenue, fiscal 2023",anchor:{citation_id:revenue.citation_id,quote:"Revenue in fiscal 2023 was EUR 1,234.5 million"},value:"1,234.5",unit:["EUR","million"],period:"fiscal 2023"},
    {label:"Revenue, fiscal 2022",anchor:{citation_id:revenue.citation_id,quote:"up from EUR 1,100.0 million in fiscal 2022"},value:"1,100.0",unit:["EUR","million"],period:"fiscal 2022"}],
    calculations:[{label:"Revenue growth",operation:"PERCENT_CHANGE",left:1,right:0,precision:2}]};
  if(question===questions[1])return {schema_version:"research-calculation-wire/1",quantities:[
    {label:"Revenue, fiscal 2023",anchor:{citation_id:revenue.citation_id,quote:"Revenue in fiscal 2023 was EUR 1,234.5 million"},value:"1,234.5",unit:["EUR","million"],period:"fiscal 2023"},
    {label:"Year-end headcount",anchor:{citation_id:people.citation_id,quote:"Headcount at year end: 120 people (2023)"},value:"120",unit:"people",period:"2023"},
    {label:"A figure Gemini misread",anchor:{citation_id:revenue.citation_id,quote:"Revenue in fiscal 2023"},value:"3",unit:"fiscal"}],
    calculations:[{label:"Revenue per person",operation:"DIVIDE",left:0,right:1,precision:3},{label:"Revenue plus headcount",operation:"ADD",left:0,right:1,precision:0},
      {label:"Uses the misread figure",operation:"ADD",left:0,right:2,precision:0}]};
  return {schema_version:"research-calculation-wire/1",quantities:[],calculations:[]};
};
const runExpression="public.nexus_research_run(:'ctx'::jsonb,:'op',:'plan'::uuid,nullif(:'id','')::uuid,nullif(:'key',''),:'command'::jsonb,:'limit'::integer,nullif(:'after','')::uuid)";
const findingExpression="public.nexus_finding(:'ctx'::jsonb,:'op',nullif(:'id','')::uuid,:'command'::jsonb,nullif(:'revision','')::bigint,nullif(:'key',''),nullif(:'hash',''))";
const stepStatement="select public.nexus_research_step(:'ctx'::jsonb,:'op',:'id'::uuid,:'generation'::integer,:'position'::integer,nullif(:'token','')::uuid,nullif(:'result','')::jsonb,nullif(:'error',''));";
async function db(_env,path,init={}) {
  const url=new URL(path,"https://synthetic.invalid"),table=url.pathname.slice(1),p=init.body?JSON.parse(init.body):{};
  if(table==="rpc/nexus_research_candidates")return sql("select public.nexus_research_candidates(:'ctx'::jsonb,:'id'::uuid,:'generation'::integer,:'position'::integer,array(select jsonb_array_elements_text(:'ids'::jsonb)::uuid));",
    {ctx:p.p_context,id:p.p_id,generation:p.p_generation,position:p.p_position,ids:p.p_document_ids});
  if(table==="rpc/nexus_research_step") {
    if(p.p_operation==="commit")committed.push(structuredClone(p.p_result));
    return sql(stepStatement,{ctx:p.p_context,op:p.p_operation,id:p.p_id,generation:p.p_generation,position:p.p_position,token:p.p_token||"",result:p.p_result?JSON.stringify(p.p_result):"",error:p.p_error||""});
  }
  if(table==="rpc/nexus_research_run")return sql(`select ${runExpression};`,{ctx:p.p_context,op:p.p_operation,plan:p.p_plan,id:p.p_id||"",key:p.p_key||"",command:p.p_command,limit:p.p_limit,after:p.p_after||""});
  if(table==="rpc/nexus_finding") {const values={ctx:p.p_context,op:p.p_operation,id:p.p_id||"",command:p.p_command,revision:p.p_revision||"",key:p.p_key||"",hash:p.p_hash||""};
    return p.p_operation==="create"?(await concurrent(findingExpression,values)).result:sql(`select ${findingExpression};`,values);}
  if(["rpc/nexus_research_calculation_run_contract","rpc/nexus_research_candidates_contract","rpc/nexus_research_finding_contract"].includes(table))return sql(`select public.${table.slice(4)}();`);
  assert.ok(["research_runs","documents","document_versions","document_chunks","workspaces","workspace_settings","finding_versions"].includes(table),table);
  const filters={};for(const [key,value] of url.searchParams) {
    if(["select","limit","order"].includes(key))continue;
    if(value.startsWith("eq."))filters[key]=[value.slice(3)];else if(value.startsWith("in.(")&&value.endsWith(")"))filters[key]=value.slice(4,-1).split(",");else throw Error(`Unsupported owned filter ${key}`);
  }
  const limit=Number(url.searchParams.get("limit")||201);assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=201);
  return sql(`select coalesce(jsonb_agg(value),'[]') from(select to_jsonb(t) value from public.${table} t
    where not exists(select 1 from jsonb_each(:'filters'::jsonb) f where not(f.value ? (to_jsonb(t)->>f.key))) limit ${limit}) rows;`,{filters});
}
const ordinaryFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const url=new URL(input instanceof Request?input.url:input),json=value=>new Response(JSON.stringify(value));
  if(url.hostname==="calculation-peer.invalid") {
    const body=JSON.parse(init.body);
    if(url.pathname.endsWith("/v6_reserve_many"))return json({state:"READY",reservations:Object.values(body.p_dimensions).map(amount=>({id:randomUUID(),amount,replayed:false}))});
    if(url.pathname.endsWith("/v6_settle_many"))return json({state:"SETTLED"});
  }
  if(url.hostname==="calculation-qdrant.invalid")return json(url.pathname.endsWith("/points/query/batch")?{result:JSON.parse(init.body).searches.map(()=>({points:[]}))}:{result:{config:{params:{vectors:{size:8,distance:"Cosine"}}}}});
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return json({embedding:{values:Array(8).fill(0.1)}});
    if(url.pathname.endsWith(":batchEmbedContents"))return json({embeddings:JSON.parse(init.body).requests.map(()=>({values:Array(8).fill(0.1)}))});
    const body=JSON.parse(init.body),prompt=body.contents[0].parts[0].text;
    if(prompt.startsWith("RESEARCH_QUERY_VARIANTS")) {
      expansions++;const question=prompt.split("QUESTION:\n")[1];
      assert.match(prompt,/at most 3 alternative/);
      return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries:[`${question} revenue headcount people`]})}]}}]});
    }
    generations++;
    if(nextFailure){const failure=nextFailure;nextFailure=null;return failure==="503"?new Response("Synthetic ordinary provider outage",{status:503}):json({candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:'{"quantities":['}]}}]});}
    assert.equal(body.generationConfig.temperature,0);assert.equal(body.generationConfig.maxOutputTokens,4096);
    assert.match(prompt,/Do not calculate anything yourself/);
    assert.ok(prompt.includes(JSON.stringify(planPayload.expected_calculations)));
    const question=prompt.split("QUESTION:\n")[1].split("\nCALCULATION_DOCUMENTS:")[0],sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
    return json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wireFor(question,sources))}]}}]});
  }
  throw Error(`Unexpected controlled external path ${url.hostname}${url.pathname}`);
};
const env={SUPABASE_URL:"https://calculation-peer.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-not-live",GOOGLE_API_KEY:"synthetic-not-live",
  QDRANT_URL:"https://calculation-qdrant.invalid",QDRANT_API_KEY:"synthetic-not-live",INGESTION_QUEUE:{send:async body=>sent.push(body)}};
const json=(_request,_env,value,status=200)=>new Response(JSON.stringify(value),{status});
const message=value=>({kind:"research",workspace_id:ws,run_id:value.id,generation:value.generation,position:value.position});
const read=id=>sql("select public.nexus_research_run(:'ctx'::jsonb,'read',:'plan'::uuid,:'id'::uuid);",{ctx,plan:plan.id,id});
async function command(operation,id,key) {
  const suffix=id?`/${id}${["cancel","resume"].includes(operation)?`/${operation}`:""}`:"";
  const response=await handleResearchRuns({request:new Request(`https://gateway.invalid/api/v2/research/plans/${plan.id}/runs${suffix}`,{
    method:operation==="read"?"GET":"POST",headers:key?{"Idempotency-Key":key}:undefined,
    body:operation==="read"?undefined:JSON.stringify({execution_mode:"CALCULATION",non_sensitive_attested:true})}),env,workspace:ws,user:{id:actor},member:{role:"editor"},serviceRequest:db,json});
  assert.equal(response.status,operation==="create"?201:200);return response.json();
}
const rejectedCommit=(result,state,code)=>assert.throws(()=>sql(stepStatement,{ctx,op:"commit",id:state.id,generation:state.generation,position:state.position,
  token:state.token,result:JSON.stringify(result),error:""}),{code},JSON.stringify(code));
try {
  for(let position=0;position<3;position++) {
    run=await processResearchMessage(env,message(run),db);
    assert.ok(run,JSON.stringify(read(starts[0].result.id)));assert.equal(run.position,position+1);
    assert.deepEqual(read(run.id).results,run.results);
  }
  assert.equal(run.state,"completed");assert.equal(generations,3);assert.equal(expansions,3);
  const [growth,perPerson,steel]=run.results;
  assert.deepEqual(growth.calculation.calculations.map(c=>[c.state,c.result?.value,c.result?.unit,c.result?.formula]),[["CALCULATED","12.23","%","((1234.5-1100.0)/1100.0)*100"]]);
  assert.deepEqual(growth.calculation.quantities.map(q=>[q.value_text,q.unit,q.period]),[["1,234.5","EUR million","fiscal 2023"],["1,100.0","EUR million","fiscal 2022"]]);
  assert.equal(growth.claim_state,"REVIEW_REQUIRED");assert.equal(growth.abstained,false);assert.deepEqual(growth.validated_citation_ids,["S1"]);
  assert.equal(growth.sources[0].document_id,documents[0].id);
  // 1234.5/120 = 10.2875 is a tie at three places; half to even rounds it to 10.288.
  assert.deepEqual(perPerson.calculation.calculations.map(c=>[c.state,c.reason,c.result?.value,c.result?.unit]),
    [["CALCULATED",null,"10.288","EUR million/people"],["NOT_CALCULATED","UNITS_DIFFER",undefined,undefined]]);
  assert.deepEqual(perPerson.calculation.rejections,[{kind:"QUANTITY",index:2,reason:"VALUE_NOT_IN_QUOTE"},{kind:"CALCULATION",index:2,reason:"QUANTITY_UNAVAILABLE"}]);
  assert.deepEqual(perPerson.calculation.documents.map(d=>d.evidence_state),["QUANTITY_FOUND","QUANTITY_FOUND","NO_INDEXED_EVIDENCE"]);
  assert.equal(steel.claim_state,"UNSUPPORTED");assert.equal(steel.abstained,true);assert.deepEqual(steel.sources,[]);
  assert.match(steel.answer,/does not show that the documents do not contain them/);
  assert.equal(sql("select jsonb_agg(results->1->'calculation'->'calculations'->0->'result') from public.research_runs where id=:'id';",{id:run.id})[0].value,"10.288");

  // Findings: only from a step that computed a result, and reviewed by a second member.
  const createFinding=(index,key)=>handleWorkbench({request:new Request("https://gateway.invalid/api/v2/findings",{method:"POST",headers:{"idempotency-key":key},
    body:JSON.stringify({title:"Synthetic revenue per person",research_run_id:run.id,result_index:index})}),env,workspace:ws,user:{id:actor},member:{role:"editor"},serviceRequest:db,json});
  await assert.rejects(createFinding(2,"calculation061-unsupported-finding"),{code:"EVIDENCE_REQUIRED"});
  const created=await createFinding(1,"calculation061-finding");assert.equal(created.status,201);const finding=await created.json();
  assert.deepEqual(finding.research_origin.calculation,perPerson.calculation);assert.equal(finding.evidence.length,2);
  async function findingCommand(who,operation,body,method="POST") {
    const response=await handleWorkbench({request:new Request(`https://gateway.invalid/api/v2/findings/${finding.id}${operation?`/${operation}`:""}`,{method,body:JSON.stringify(body)}),
      env,workspace:ws,user:{id:who},member:{role:"editor"},serviceRequest:db,json});assert.equal(response.status,200);return response.json();
  }
  await findingCommand(actor,"share",{user_id:reviewer,permission:"contribute"});
  const reviewed=await findingCommand(reviewer,"review",{decision:"approved",comment:"Checked 1,234.5 and 120 against their passages.",revision:1});
  assert.equal(reviewed.reviews[0].reviewer_id,reviewer);assert.equal(reviewed.research_origin.calculation.calculations[0].result.value,"10.288");

  // The database refuses a step whose figures or results it did not compute itself.
  let tamper=await command("create",undefined,"calculation061-tamper");
  const claimed=sql(stepStatement,{ctx,op:"claim",id:tamper.id,generation:tamper.generation,position:0,token:"",result:"",error:""});
  assert.equal(claimed.claimed,true);const state={id:tamper.id,generation:tamper.generation,position:0,token:claimed.token};
  const good=committed[0],change=edit=>{const copy=structuredClone(good);edit(copy);return copy;},first=copy=>copy.calculation.calculations[0];
  rejectedCommit(change(copy=>{first(copy).result.value="12.24";}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{first(copy).precision=3;}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{Object.assign(first(copy),{state:"NOT_CALCULATED",reason:"UNITS_DIFFER",result:null});}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{const q=copy.calculation.quantities[0];q.value_text="1,234.6";q.value="1234.6";first(copy).input.right.value="1234.6";}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{copy.calculation.quantities[0].quote="Revenue in fiscal 2024 was EUR 1,234.5 million";}),state,"SOURCE_UNAVAILABLE");
  rejectedCommit(change(copy=>{copy.calculation.quantities[1].unit="USD million";first(copy).input.left.unit="USD million";}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{copy.calculation.quantities[1].period_start=0;}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{copy.abstained=true;copy.claim_state="UNSUPPORTED";}),state,"INVALID_SCOPE");
  rejectedCommit(change(copy=>{copy.calculation.calculations.push({...first(copy)});}),state,"INVALID_SCOPE");
  const accepted=sql(stepStatement,{ctx,op:"commit",id:state.id,generation:state.generation,position:0,token:state.token,result:JSON.stringify(good),error:""});
  assert.equal(accepted.run.position,1);

  // Cancel and resume keep saved results; a resumed run gets 180 seconds again; provider failures keep progress.
  tamper=await command("cancel",tamper.id);assert.equal(tamper.state,"cancelled");
  tamper=await command("resume",tamper.id);assert.equal(tamper.generation,2);assert.equal(tamper.results.length,1);
  assert.equal(sql("select to_jsonb(abs(extract(epoch from deadline-updated_at)-180)<1) from public.research_runs where id=:'id';",{id:tamper.id}),true);
  for(const [failure,code] of [["503","PROVIDER_UNAVAILABLE"],["incomplete","PROVIDER_INCOMPLETE"]]) {
    nextFailure=failure;assert.equal(await processResearchMessage(env,message(tamper),db),null);tamper=await command("read",tamper.id);
    assert.equal(tamper.error_code,code);assert.equal(tamper.results.length,1);tamper=await command("resume",tamper.id);
  }
  tamper=await processResearchMessage(env,message(tamper),db);assert.equal(tamper.position,2);
  const listed=sql(`select ${runExpression};`,{ctx,op:"list",plan:plan.id,id:"",key:"",command:{},limit:20,after:""});
  assert.ok(listed.items.every(item=>item.results_included===false&&item.results.length===0&&item.mode==="CALCULATION"));
  assert.equal(sql("select free_chat_queries from public.nexus_account_usage where user_id=:'actor';",{actor}),2);
  console.log(JSON.stringify({marker:"REAL_SQL_CALCULATION_RUN_EXECUTOR_REVIEW_PASS",parity_cases:cases.length,parity_refusals:parityRefusals,
    steps:3,computed_results:2,refused_calculations:1,rejected_figures:1,tampered_commits_refused:9,finding_review:"second member",
    cancel_resume_preserves_results:true,resume_deadline_seconds:180,provider503_incomplete_preserve_progress:true,hosted_or_real_provider_quality:false}));
} finally {globalThis.fetch=ordinaryFetch;}
