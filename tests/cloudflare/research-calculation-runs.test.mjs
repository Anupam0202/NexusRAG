import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { confirmedRun } from "../../apps/gateway/src/research-runs.js";
import { calculateBinary, calculationRunPrompt, calculationRunResult, calculationRunWork, locateNumber, locateUnit,
  normalizeQuotedNumber, plainText } from "../../apps/gateway/src/research-calculation-runs.js";

const input=(operation,left,right,precision=2,units=["USD","USD"])=>({operation,precision,
  left:{value:left,unit:units[0],evidence_ids:["Q1"]},right:{value:right,unit:units[1],evidence_ids:["Q2"]}});

test("results are exact decimals rounded half to even, with the formula, unit and evidence kept", () => {
  assert.deepEqual(calculateBinary(input("ADD","1234.5","765.5")),
    {operation:"ADD",value:"2000.00",unit:"USD",formula:"1234.5+765.5",evidence_ids:["Q1","Q2"],precision:2,rounding:"ROUND_HALF_EVEN"});
  assert.deepEqual(calculateBinary(input("PERCENT_CHANGE","1200","1500",1)),
    {operation:"PERCENT_CHANGE",value:"25.0",unit:"%",formula:"((1500-1200)/1200)*100",evidence_ids:["Q1","Q2"],precision:1,rounding:"ROUND_HALF_EVEN"});
  // Floating point would give 0.30000000000000004 and round 0.125 and 2.5 away from zero.
  assert.equal(calculateBinary(input("ADD","0.1","0.2",18)).value,"0.300000000000000000");
  for(const [left,right,places,expected] of [["1","8",2,"0.12"],["3","8",2,"0.38"],["-1","8",2,"-0.12"],["5","2",0,"2"],["7","2",0,"4"],["-5","2",0,"-2"],["1","3",6,"0.333333"]])
    assert.equal(calculateBinary(input("DIVIDE",left,right,places)).value,expected,`${left}/${right}`);
  assert.equal(calculateBinary(input("DIVIDE","-1","1000",2)).value,"0.00");
  assert.equal(calculateBinary(input("MULTIPLY","9007199254740993.1","3",1,["m","s"])).value,"27021597764222979.3");
  assert.equal(calculateBinary(input("MULTIPLY","2","3",0,["m","s"])).unit,"m*s");
  assert.equal(calculateBinary(input("RATIO","10","4",2,["EUR million","people"])).unit,"EUR million/people");
  assert.equal(calculateBinary(input("SUBTRACT","1","1.005",3)).value,"-0.005");
  assert.deepEqual(calculateBinary({...input("ADD","1","2"),left:{value:"1",unit:"USD",evidence_ids:["Q1"]},right:{value:"2",unit:"USD",evidence_ids:["Q1"]}}).evidence_ids,["Q1"]);
});

test("a calculation the database would refuse is refused for the same reason", () => {
  assert.deepEqual(calculateBinary(input("ADD","1","2",2,["USD","EUR"])),{error:"UNITS_DIFFER"});
  assert.deepEqual(calculateBinary(input("PERCENT_CHANGE","0","2",2,["USD","EUR"])),{error:"UNITS_DIFFER"});
  assert.deepEqual(calculateBinary(input("PERCENT_CHANGE","0","2")),{error:"DIVISION_BY_ZERO"});
  assert.deepEqual(calculateBinary(input("DIVIDE","2","0.000")),{error:"DIVISION_BY_ZERO"});
  // Division and multiplication may mix units; their result carries both.
  assert.equal(calculateBinary(input("DIVIDE","2","4",2,["USD","EUR"])).value,"0.50");
  for(const bad of [input("ADD","1","2",19),input("ADD","1","2",1.5),input("POWER","1","2"),input("ADD","1e129","1"),input("ADD","1e-129","1"),input("ADD","12a","1")])
    assert.deepEqual(calculateBinary(bad),{error:"INVALID"});
});

test("a figure must stand in its passage as a whole number with any sign it has", () => {
  assert.deepEqual(locateNumber("Revenue was EUR 1,234.5 million.","1,234.5"),[16,23]);
  assert.equal(locateNumber("In 2021 the board met.","1"),null);
  assert.equal(locateNumber("Revenue was 1,234.5 million.","234.5"),null);
  assert.equal(locateNumber("Revenue was 1,234.5 million.","1,234"),null);
  assert.equal(locateNumber("Revenue was 1.25 million.","1"),null);
  assert.equal(locateNumber("Revenue was .5 million.","5"),null);
  assert.equal(locateNumber("Profit fell to -12 million.","12"),null);
  assert.deepEqual(locateNumber("Profit fell to -12 million.","-12"),[15,18]);
  assert.deepEqual(locateNumber("Q4 2023: 12% (FY2023: 15%)","15"),[22,24]);
  // Code points, not UTF-16 units: an emoji before the figure counts once.
  assert.deepEqual(locateNumber("\u{1f4c8} 42 units","42"),[2,4]);
  assert.equal(normalizeQuotedNumber("−1,234.50"),"-1234.50");
  assert.equal(plainText("EUR million"),true);
  for(const bad of [""," EUR","EUR\n","a\u0007b","x".repeat(65),3])assert.equal(plainText(bad),false);
  assert.deepEqual(locateUnit("EUR 1.2 million and USD 3 million",["EUR","million"],[4,7]),{unit:"EUR million",spans:[[0,3],[8,15]]});
  assert.equal(locateUnit("EUR 1.2 million",["EUR","EUR"],[4,7]),null);
  assert.equal(locateUnit("EUR 1.2 million",["EUR","million","x"],[4,7]),null);
});

function fixture(documentCount=2) {
  const documents=Array.from({length:documentCount},(_,i)=>({id:`document-${i}`,filename:`Synthetic report ${i}.txt`}));
  const contents=["\u{1f4c8} Revenue in fiscal 2023 was EUR 1,234.5 million, up from EUR 1,100.0 million in fiscal 2022.",
    "Headcount at year end: 120 people (2023).","Unrelated appendix text."];
  const sources=contents.map((content,i)=>({citation_id:`S${i+4}`,document_id:documents[i===1?1:0].id,version_id:`version-${i===1?1:0}`,
    chunk_id:`chunk-${i}`,content,original_content_hash:String(i).repeat(64),page_number:i===1?2:null,chunk_index:i}));
  const run={mode:"CALCULATION",position:0,questions:["How much did revenue grow?","Revenue per employee?"],
    requested_calculations:["Percent change in revenue from fiscal 2022 to fiscal 2023"],source_snapshot:documents.map(document=>({document_id:document.id}))};
  const s1=sources[0].content,start=Array.from(s1.slice(0,s1.indexOf("up from"))).length;
  const wire={schema_version:"research-calculation-wire/1",quantities:[
    {label:"Revenue, fiscal 2023",anchor:{citation_id:"S4",quote:"Revenue in fiscal 2023 was EUR 1,234.5 million"},value:"1,234.5",unit:["EUR","million"],period:"fiscal 2023"},
    {label:"Revenue, fiscal 2022",anchor:["S4",start,start+43],value:"1,100.0",unit:["EUR","million"],period:"fiscal 2022"},
    {label:"Headcount",anchor:{citation_id:"S5",quote:"Headcount at year end: 120 people (2023)"},value:"120",unit:"people",period:"2023"},
    {label:"Not in the passage",anchor:{citation_id:"S4",quote:"Revenue in fiscal 2024"},value:"5",unit:"EUR"},
    {label:"A digit of a year",anchor:{citation_id:"S4",quote:"Revenue in fiscal 2023"},value:"3",unit:"fiscal"},
    {label:"The same figure again",anchor:{citation_id:"S4",quote:"EUR 1,234.5 million"},value:"1,234.5",unit:"million",period:null},
    {label:"A unit the passage lacks",anchor:{citation_id:"S5",quote:"120 people"},value:"120",unit:"staff"},
  ],calculations:[
    {label:"Revenue growth",operation:"PERCENT_CHANGE",left:1,right:0,precision:1},
    {label:"Revenue per employee",operation:"DIVIDE",left:0,right:2,precision:2},
    {label:"Revenue plus headcount",operation:"ADD",left:0,right:2,precision:0},
    {label:"Uses a refused figure",operation:"ADD",left:0,right:3,precision:0},
    {label:"Revenue growth again",operation:"PERCENT_CHANGE",left:1,right:0,precision:3},
    {label:"Not an operation",operation:"POWER",left:0,right:1,precision:0},
  ]};
  return {run,work:calculationRunWork(run),documents,sources,wire,generated:value=>({answer:JSON.stringify(value)})};
}

test("figures are kept only where the passage states them, and results are computed, never taken from Gemini", () => {
  const {work,documents,sources,wire,generated}=fixture(),result=calculationRunResult(work,documents,sources,generated(wire));
  const {quantities,calculations,rejections}=result.analysis;
  assert.deepEqual(quantities.map(q=>[q.quantity_id,q.value_text,q.value,q.unit,q.period,q.citation_id]),
    [["Q1","1,234.5","1234.5","EUR million","fiscal 2023","S1"],["Q2","1,100.0","1100.0","EUR million","fiscal 2022","S1"],["Q3","120","120","people","2023","S2"]]);
  for(const q of quantities) {
    const quote=Array.from(q.quote),source=Array.from(result.sources.find(s=>s.citation_id===q.citation_id).content);
    assert.equal(source.slice(q.quote_start,q.quote_end).join(""),q.quote);
    assert.equal(quote.slice(q.value_start,q.value_end).join(""),q.value_text);
    assert.equal(q.unit_spans.map(([s,e])=>quote.slice(s,e).join("")).join(" "),q.unit);
    assert.equal(quote.slice(q.period_start,q.period_end).join(""),q.period);
    assert.equal(q.claim_state,"REVIEW_REQUIRED");
  }
  assert.deepEqual(rejections,[{kind:"QUANTITY",index:3,reason:"UNCONFIRMED_SOURCE_ANCHOR"},{kind:"QUANTITY",index:4,reason:"VALUE_NOT_IN_QUOTE"},
    {kind:"QUANTITY",index:5,reason:"REPEATED_QUANTITY"},{kind:"QUANTITY",index:6,reason:"UNIT_NOT_IN_QUOTE"},
    {kind:"CALCULATION",index:3,reason:"QUANTITY_UNAVAILABLE"},{kind:"CALCULATION",index:4,reason:"REPEATED_CALCULATION"},
    {kind:"CALCULATION",index:5,reason:"INVALID_CALCULATION"}]);
  assert.deepEqual(calculations.map(c=>[c.operation,c.left,c.right,c.state,c.reason,c.result?.value,c.result?.unit]),
    [["PERCENT_CHANGE","Q2","Q1","CALCULATED",null,"12.2","%"],["DIVIDE","Q1","Q3","CALCULATED",null,"10.29","EUR million/people"],
     ["ADD","Q1","Q3","NOT_CALCULATED","UNITS_DIFFER",undefined,undefined]]);
  assert.deepEqual(calculations[0].input,{operation:"PERCENT_CHANGE",left:{value:"1100.0",unit:"EUR million",evidence_ids:["Q2"]},
    right:{value:"1234.5",unit:"EUR million",evidence_ids:["Q1"]},precision:1});
  assert.equal(calculations[0].result.formula,"((1234.5-1100.0)/1100.0)*100");
  // Passages no figure is quoted from are dropped and the rest renumbered; every document says what was read.
  assert.deepEqual(result.sources.map(s=>[s.citation_id,s.chunk_id]),[["S1","chunk-0"],["S2","chunk-1"]]);
  assert.deepEqual(result.analysis.documents.map(d=>[d.evidence_state,d.consulted_sources.length]),[["QUANTITY_FOUND",2],["QUANTITY_FOUND",1]]);
  assert.equal(result.analysis.documents[1].consulted_sources[0].page_number,2);
  assert.deepEqual(result.checked.citations,[1,2]);
  assert.equal(result.checked.claim_state,"REVIEW_REQUIRED");assert.equal(result.checked.abstained,false);
  assert.match(result.checked.answer,/Revenue growth: \(\(1234\.5-1100\.0\)\/1100\.0\)\*100 = 12\.2 %/);
  assert.match(result.checked.answer,/not calculated, because the units differ \(EUR million; people\)/);
  assert.match(result.checked.answer,/Q2 Revenue, fiscal 2022: 1,100\.0 EUR million \(fiscal 2022\) \[S1\]/);
  assert.equal(result.analysis.interpretation,"FIGURES_QUOTED_FROM_SOURCES_RESULTS_COMPUTED_BY_DATABASE");
});

test("figures without a computed result, or no figures at all, answer nothing", () => {
  const {work,documents,sources,wire,generated}=fixture();
  const onlyRefused=calculationRunResult(work,documents,sources,generated({...wire,calculations:[wire.calculations[2]]}));
  assert.equal(onlyRefused.checked.abstained,true);assert.equal(onlyRefused.checked.claim_state,"UNSUPPORTED");
  assert.deepEqual(onlyRefused.checked.citations,[1,2]);
  const none=calculationRunResult(work,documents,sources,null);
  assert.deepEqual([none.analysis.quantities,none.analysis.calculations,none.sources],[[],[],[]]);
  assert.match(none.checked.answer,/does not show that the documents do not contain them/);
  assert.deepEqual(none.analysis.documents.map(d=>d.evidence_state),["NO_QUANTITY_FOUND","NO_QUANTITY_FOUND"]);
  const noSources=calculationRunResult(work,documents,[],null);
  assert.deepEqual(noSources.analysis.documents.map(d=>d.evidence_state),["NO_INDEXED_EVIDENCE","NO_INDEXED_EVIDENCE"]);
  // A fenced JSON answer is read; anything else is a provider error, not an empty result.
  assert.equal(calculationRunResult(work,documents,sources,{answer:"```json\n"+JSON.stringify(wire)+"\n```"}).analysis.quantities.length,3);
  for(const bad of ["Revenue grew 12%.",JSON.stringify({...wire,schema_version:"other"}),JSON.stringify({...wire,quantities:Array(13).fill(wire.quantities[0])}),
    JSON.stringify({...wire,calculations:Array(7).fill(wire.calculations[0])})])
    assert.throws(()=>calculationRunResult(work,documents,sources,{answer:bad}),{code:"PROVIDER_INVALID_RESPONSE"});
});

test("the prompt asks only for figures and operations, with the plan's requested calculations as guidance", () => {
  const {work,documents,sources}=fixture(),prompt=calculationRunPrompt(work,documents,sources);
  assert.match(prompt,/Do not calculate anything yourself/);
  assert.match(prompt,/Never convert units or currencies, never rescale/);
  assert.ok(prompt.includes(`REQUESTED_CALCULATIONS (from the plan; guidance, not evidence):\n${JSON.stringify(work.requested)}`));
  assert.ok(prompt.includes(`QUESTION:\n${work.question}`));
  assert.ok(prompt.endsWith(`EVIDENCE:\n${JSON.stringify(sources.map(s=>({citation_id:s.citation_id,document_id:s.document_id,content:s.content})))}`));
});

test("a calculation run takes one question and up to six more over at most thirty documents", () => {
  const {run}=fixture(30);
  run.questions=Array.from({length:7},(_,i)=>`Calculation ${i+1}`);run.position=6;
  assert.equal(calculationRunWork(run).question,"Calculation 7");
  for(const changed of [{questions:[...run.questions,"extra"]},{source_snapshot:[...run.source_snapshot,{document_id:"extra"}]},{position:7},
    {requested_calculations:[""]},{requested_calculations:Array(51).fill("x")},{mode:"PROCUREMENT_RESEARCH"},
    {source_snapshot:[run.source_snapshot[0],run.source_snapshot[0]]}])
    assert.throws(()=>calculationRunWork({...run,...changed}),{code:"INVALID_SCOPE"});
  assert.deepEqual(calculationRunWork({...run,requested_calculations:undefined}).requested,[]);
});

const workspace="11111111-1111-4111-8111-111111111111",user="22222222-2222-4222-8222-222222222222";
const plan="33333333-3333-4333-8333-333333333333",runId="55555555-5555-4555-8555-555555555555";
const receipt=()=>({id:runId,plan_id:plan,workspace_id:workspace,owner_id:user,schema_version:"research-run/1",persistence_state:"PERSISTED",
  mode:"CALCULATION",state:"queued",generation:1,position:0,questions:["Revenue growth?","Revenue per employee?"],results:[],source_state:"CURRENT",
  error_code:null,created_at:"2026-11-14T00:00:00Z",total_steps:2,requested_calculations:["Percent change in revenue"],
  source_snapshot:Array.from({length:30},(_,i)=>({document_id:`00000061-0000-4000-8000-${String(i).padStart(12,"0")}`}))});

test("a stored calculation run is confirmed only within its limits", () => {
  const scope={workspace,user:{id:user}};
  assert.equal(confirmedRun(receipt(),scope,plan),true);
  for(const changed of [{questions:Array(8).fill("q"),total_steps:8},{source_snapshot:[...receipt().source_snapshot,{document_id:plan}]},
    {requested_calculations:undefined},{requested_calculations:[" "]},{total_steps:3}])
    assert.equal(confirmedRun({...receipt(),...changed},scope,plan),false,JSON.stringify(Object.keys(changed)));
  assert.equal(confirmedRun({...receipt(),results_included:false},scope,plan),true);
});

for(const mismatch of [null,"absent","limits"])test(`a calculation run confirms the database contract before it starts: ${mismatch}`,async t=>{
  const calls=[],sent=[];
  t.mock.method(globalThis,"fetch",async(rawUrl,init={})=>{
    const path=new URL(rawUrl).pathname,json=(value,status=200)=>new Response(JSON.stringify(value),{status});
    if(path==="/auth/v1/user")return json({id:user});
    if(path==="/rest/v1/workspace_members")return json([{workspace_id:workspace,user_id:user,role:"editor"}]);
    if(path==="/rest/v1/workspaces")return json([{lifecycle_state:"active",capability_revision:1}]);
    if(path==="/rest/v1/workspace_settings")return json([{active_policy_id:"44444444-4444-4444-8444-444444444444",policy_version:1}]);
    if(path==="/rest/v1/rpc/nexus_research_calculation_run_contract")return mismatch==="absent"?json({code:"PGRST202",message:"absent"},404)
      :json({schema_version:"research-calculation-run/1",max_sources:mismatch==="limits"?50:30,max_subquestions:6,max_steps:7,max_query_variants:4,
        runtime_seconds:180,max_quantities:12,max_calculations:6,max_context_passages:12,max_result_bytes:1000000,max_run_bytes:7000000});
    if(path==="/rest/v1/rpc/nexus_research_candidates_contract")return json({schema_version:"research-candidates/1",max_rows:201,max_candidates:200,max_sources:50});
    if(path==="/rest/v1/rpc/nexus_research_run"){calls.push(JSON.parse(init.body));return json(receipt());}
    throw new Error(`Unexpected request ${path}`);
  });
  const env={SUPABASE_URL:"https://supabase.invalid",SUPABASE_PUBLISHABLE_KEY:"synthetic-public",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",
    INGESTION_QUEUE:{send:async value=>{sent.push(value);}}};
  const response=await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/runs`,{method:"POST",
    headers:{authorization:"Bearer synthetic","x-workspace-id":workspace,"content-type":"application/json","idempotency-key":"synthetic-calculation-run"},
    body:JSON.stringify({non_sensitive_attested:true,execution_mode:"CALCULATION"})}),env);
  assert.equal(response.status,mismatch?503:201);assert.equal(calls.length,mismatch?0:1);assert.equal(sent.length,mismatch?0:1);
  if(mismatch)assert.match((await response.json()).error.message,/research_calculation_runs migration/);
  else assert.equal((await response.json()).requested_calculations[0],"Percent change in revenue");
});
