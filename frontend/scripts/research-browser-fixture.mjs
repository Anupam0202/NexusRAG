import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { handle, queue } from "../../apps/gateway/src/preview-worker.js";
import { RESEARCH_MODE_LIMITS } from "../../apps/gateway/src/research-plans.js";
import {obligationCapacity,obligationWire} from "../../tests/fixtures/research-obligation-capacity.mjs";
import {entityData,entityProposals,entityWire,entityCapacity} from "../../tests/fixtures/research-entity-data.mjs";
import {diligenceData,diligenceWire,diligenceCapacity} from "../../tests/fixtures/research-diligence-data.mjs";
import {passportCapacity,passportWire} from "../../tests/fixtures/research-passport-data.mjs";
import {procurementCapacity,procurementWire} from "../../tests/fixtures/research-procurement-data.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.argv[2] || 3024);
const workspace = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const policy = "44444444-4444-4444-8444-444444444444", document = "60606060-6060-4060-8060-606060606060";
const env = { SUPABASE_URL: "https://research-peer.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" };
const records = new Map(), keys = new Map();
const calculations = new Map(), calculationKeys = new Map();
const aggregations = new Map(), aggregationKeys = new Map();
const conversions = new Map(), conversionKeys = new Map();
const quantities = new Map(), quantityKeys = new Map();
const runs=new Map(),runKeys=new Map(),interruptedQuestions=new Set();
const findings=new Map(),findingKeys=new Map(),actors=new Set([user,"33333333-3333-4333-8333-333333333333"]);
const reviewer="33333333-3333-4333-8333-333333333333";
const reviewers=new Set([reviewer]);
// Ordinary pagination stays exercised even in a fresh isolated fixture process.
for(let i=1;i<=101;i++)actors.add(`00000034-0000-4000-8000-${String(i).padStart(12,"0")}`);
env.GOOGLE_API_KEY="synthetic-local-not-a-key";env.QDRANT_URL="https://research-qdrant.invalid";env.QDRANT_API_KEY="synthetic-local";
const fixtureEvent=(event,body,extra={})=>{
  if(process.env.E2E_RESEARCH_EVENT_LOG==="1")console.log(JSON.stringify({marker:"SYNTHETIC_RESEARCH_EVENT",at:performance.now(),event,
    run_id:body.run_id??body.p_id,mode:runs.get(body.run_id??body.p_id)?.mode,generation:body.generation??body.p_generation,
    position:body.position??body.p_position,...extra}));
};
env.INGESTION_QUEUE={send:async body=>{
  const delay=runs.get(body.run_id)?.questions[0]?.includes("cancel")?2500:500;
  fixtureEvent("queue_scheduled",body,{delay});
  setTimeout(()=>{
    fixtureEvent("queue_started",body);
    void queue({messages:[{body,ack(){fixtureEvent("queue_ack",body);},retry(){throw Error("Unexpected automatic generation retry");}}]},env)
      .then(()=>fixtureEvent("queue_finished",body)).catch(error=>{fixtureEvent("queue_error",body,{code:error.code??null});console.error(error);});
  },delay);
}};
const sourceVersion="70707070-7070-4070-8070-707070707070",sourceChunk="80808080-8080-4080-8080-808080808080";
const sourceText="\u{1F4CA} mass: 1.005 kg; other mass 9 kg",sourceHash=createHash("sha256").update(sourceText).digest("hex");
const comparisonDocument="61616161-6161-4161-8161-616161616161",comparisonVersion="71717171-7171-4171-8171-717171717171",comparisonChunk="81818181-8181-4181-8181-818181818181";
const comparisonText="The synthetic second mass is 2.005 kg.";
const timelineTexts=["\u{1F4CA} Issued 2024-02. Effective 2024-02-29.","Reviewed 03/04/2024. Open period 2024/2025."];
const largeDocument="64646464-6464-4464-8464-646464646464",largeVersion="74747474-7474-4474-8474-747474747474",largeChunk="84848484-8484-4484-8484-848484848484";
const pagelessDocument="65656565-6565-4565-8565-656565656565",pagelessVersion="75757575-7575-4575-8575-757575757575",pagelessChunk="85858585-8585-4585-8585-858585858585";
const obligationDocument="d0440000-0000-4000-8100-000000000001",obligationDefinition="d0440000-0000-4000-8100-000000000002";
const obligationTexts=["\u{1F4CA} Section 3. Synthetic Board. In Region Example, operators must retain reports for 30 days, except public summaries. Effective from 2026-01-01. Replaces section 2.",
  'Definitions: "Report" means a synthetic inspection record. Applies only to listed operators. Amendment A extends the reporting requirement.'];
const fixtureDocuments=[{id:document,workspace_id:workspace,filename:"Synthetic policy.txt",active_version_id:sourceVersion},
  {id:comparisonDocument,workspace_id:workspace,filename:"Synthetic second policy.txt",active_version_id:comparisonVersion},
  ...timelineTexts.map((_,i)=>({id:`63636363-6363-4363-8363-63636363636${i}`,workspace_id:workspace,filename:i?"Timeline amendment.txt":"Timeline policy.txt",active_version_id:`73737373-7373-4373-8373-73737373737${i}`})),
  {id:largeDocument,workspace_id:workspace,filename:"Synthetic large policy.txt",active_version_id:largeVersion},
  {id:pagelessDocument,workspace_id:workspace,filename:"Synthetic pageless policy.txt",active_version_id:pagelessVersion},
  {id:obligationDocument,workspace_id:workspace,filename:"Obligation policy.txt",active_version_id:"e0440000-0000-4000-8100-000000000001"},
  {id:obligationDefinition,workspace_id:workspace,filename:"Obligation definitions.txt",active_version_id:"e0440000-0000-4000-8100-000000000002"}
].map(d=>({...d,status:"ready",file_type:"txt",chunk_count:d.id===largeDocument?400:1,file_size:100,lifecycle_state:"active",lifecycle_epoch:1}));
const fixtureVersions=fixtureDocuments.map(d=>({id:d.active_version_id,workspace_id:workspace,document_id:d.id,publication_state:"ready",data_classification:"non_sensitive",index_generation:"synthetic-source-generation",lifecycle_epoch:1}));
const fixtureChunks=fixtureDocuments.map((d,i)=>{
  const obligation=[obligationDocument,obligationDefinition].indexOf(d.id),pageless=d.id===pagelessDocument||obligation===0;
  const text=obligation>=0?obligationTexts[obligation]:pageless||i===4?sourceText:i<2?i?comparisonText:sourceText:timelineTexts[i-2];
  return {id:obligation>=0?`f0440000-0000-4000-8100-00000000000${obligation+1}`:pageless?pagelessChunk:i===4?largeChunk:i<2?i?comparisonChunk:sourceChunk:`83838383-8383-4383-8383-83838383838${i}`,workspace_id:workspace,document_id:d.id,version_id:d.active_version_id,
    chunk_index:0,original_text:text,content:text,original_content_hash:createHash("sha256").update(text).digest("hex"),page_number:pageless?null:2,
    location:pageless?{char_start:0,char_end:Array.from(text).length}:{page:2},metadata:{}};
});
const capacity=obligationCapacity();
fixtureDocuments.push(...capacity.documents.map((doc,i)=>({...doc,workspace_id:workspace,active_version_id:capacity.originals[i].version_id,
  status:"ready",file_type:"txt",chunk_count:1,file_size:32768,lifecycle_state:"active",lifecycle_epoch:1})));
fixtureVersions.push(...capacity.originals.map(row=>({id:row.version_id,document_id:row.document_id,workspace_id:workspace,
  publication_state:"ready",data_classification:"non_sensitive",index_generation:"synthetic-capacity",lifecycle_epoch:1})));
fixtureChunks.push(...capacity.originals.map(row=>({...row,workspace_id:workspace,content:row.original_text,metadata:{}})));
const entityFixtures=entityData(),entityMaximum=entityCapacity(),diligenceFixtures=diligenceData(),diligenceMaximum=diligenceCapacity(),passportMaximum=passportCapacity(),procurementMaximum=procurementCapacity();
for(const data of [entityFixtures,entityMaximum,diligenceFixtures,diligenceMaximum,passportMaximum,procurementMaximum]) {
  fixtureDocuments.push(...data.documents.map((doc,i)=>({...doc,workspace_id:workspace,active_version_id:data.originals[i].version_id,
    status:"ready",file_type:"txt",chunk_count:1,file_size:32768,lifecycle_state:"active",lifecycle_epoch:1})));
  fixtureVersions.push(...data.originals.map(row=>({id:row.version_id,document_id:row.document_id,workspace_id:workspace,
    publication_state:"ready",data_classification:"non_sensitive",index_generation:"synthetic-entity",lifecycle_epoch:1})));
  fixtureChunks.push(...data.originals.map(row=>({...row,workspace_id:workspace,content:row.original_text,metadata:{}})));
}
for(let i=1;i<400;i++) {
  const text=i===399?"Final appendix record. Reference END-400.":"Unrelated appendix material.";
  fixtureChunks.push({id:`00340000-0000-4000-8000-${String(i).padStart(12,"0")}`,workspace_id:workspace,document_id:largeDocument,version_id:largeVersion,
    chunk_index:i,original_text:text,content:text,original_content_hash:createHash("sha256").update(text).digest("hex"),page_number:3,location:{page:3},metadata:{}});
}
const fixtureOriginals=new Map();
for(const d of fixtureDocuments) {
  const originals=fixtureChunks.filter(c=>c.document_id===d.id);
  const bytes=Buffer.from(d.id===pagelessDocument?originals.map(c=>c.original_text).join("\n"):`\uFEFF${d.filename}\r\n${originals.map(c=>c.original_text).join("\r\n")}\r\nOriginal-file-only footer.\r\n`);
  const key=`${workspace}/${d.id}/${d.active_version_id}/${d.filename}`;
  fixtureOriginals.set(key,bytes);
  Object.assign(fixtureVersions.find(v=>v.id===d.active_version_id),{original_bucket:"documents",original_key:key,
    original_bytes:bytes.length,original_hash:createHash("sha256").update(bytes).digest("hex"),original_verified_at:"2026-10-01T00:00:00Z"});
  Object.assign(d,{content_type:"text/plain",file_size_bytes:bytes.length,
    page_count:Math.max(...originals.map(c=>c.page_number)),created_at:"2026-10-01T00:00:00Z",updated_at:"2026-10-01T00:00:00Z"});
}
function scoped(rows,url) {
  return rows.filter(row=>[...url.searchParams].every(([key,value])=>{
    if(!Object.hasOwn(row,key))return true;
    if(value.startsWith("eq."))return String(row[key])===value.slice(3);
    if(value.startsWith("gt."))return String(row[key])>value.slice(3);
    if(value.startsWith("in.("))return value.slice(4,-1).split(",").includes(String(row[key]));
    return true;
  }));
}
const ordinaryFetch = globalThis.fetch;
// Storage/provider peers are controlled. Production pages, API client, Gateway
// and executor run unchanged. This is not SQL durability, real OAuth or hosted proof.
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input);
  const result=value=>new Response(JSON.stringify(value));
  if(url.hostname==="generativelanguage.googleapis.com") {
    if(url.pathname.endsWith(":embedContent"))return result({embedding:{values:Array(8).fill(0.1)}});
    if(url.pathname.endsWith(":batchEmbedContents"))return result({embeddings:JSON.parse(init.body).requests.map(()=>({values:Array(8).fill(0.1)}))});
    const prompt=JSON.parse(init.body).contents[0].parts[0].text;
    if(prompt.startsWith("RESEARCH_QUERY_VARIANTS")) {
      const question=prompt.split("QUESTION:\n")[1],limit=Number(prompt.match(/at most (\d+)/)[1]);
      const queries=question.startsWith("Synthetic literal quantity")?[question.replace("1.005 kg","11.005 kg")]:
        question.includes("Synthetic multi-query")?["duration","interval","policy","schedule","rule","period","context"].slice(0,limit).map(word=>`${question} ${word}`):[];
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({queries})}]}}]});
    }
    if(prompt.startsWith("DEEP_RESEARCH_")) {
      const question=prompt.split("QUESTION:\n")[1].split("\nPREVIOUS_ANALYSES_NOT_EVIDENCE:")[0];
      if(question.includes("Synthetic interrupted deep")&&!interruptedQuestions.has(question)){interruptedQuestions.add(question);return new Response("synthetic Deep interruption",{status:503});}
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
      const answer=sources.map(source=>`${source.content} [${source.citation_id}]`).join("\n");
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({answer,limitations:["Synthetic context still requires independent review."],gaps:["No external evidence was acquired."]})}]}}]});
    }
    if(prompt.includes("PROCUREMENT_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]),question=prompt.split("QUESTION:\n")[1].split("\nPROCUREMENT_DOCUMENTS:")[0];
      if(question.includes("Synthetic interrupted procurement")&&!interruptedQuestions.has(question)){
        interruptedQuestions.add(question);return new Response("Synthetic procurement interruption",{status:503});
      }
      const wire=question.includes("Synthetic empty procurement")?{schema_version:"research-procurement-wire/1",anchors:[],texts:[],records:[],gaps:[]}:
        question.includes("maximum-field procurement")?procurementWire(sources):{
          schema_version:"research-procurement-wire/1",anchors:sources.slice(0,2).flatMap(source=>[source.content.match(/Notice N-\d+/)[0],"value USD 9007199254740993.25","2026-12-01T12:00:00Z"].map(quote=>({citation_id:source.citation_id,quote}))),
          texts:["Notice version,qualifications and current eligibility require independent review.","Later amendments and missing suppliers are not established."],
          records:sources.slice(0,2).map((_,i)=>({kind:"TENDER",fields:{notice_id:i*3,value:i*3+1,deadline:i*3+2},limitations:[0]})),
          gaps:[{document_id:null,description:1}]};
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wire)}]}}]});
    }
    if(prompt.includes("PASSPORT_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]),question=prompt.split("QUESTION:\n")[1].split("\nDECLARED_PRODUCT_NOT_VERIFIED:")[0];
      if(question.includes("Synthetic interrupted passport")&&!interruptedQuestions.has(question)){
        interruptedQuestions.add(question);return new Response("Synthetic passport interruption",{status:503});
      }
      const empty={schema_version:"research-passport-wire/1",anchors:[],texts:[],claims:[],gaps:[]};
      const wire=question.includes("Synthetic empty passport")?empty:question.includes("maximum-field passport")?passportWire(sources):{
        schema_version:"research-passport-wire/1",anchors:[[sources[0].citation_id,0,Math.min(200,Array.from(sources[0].content).length)]],
        texts:["Certificate reference","Supplier-reported C-1","Current validity and declared-product applicability require independent review.","Later reports and amendments not established."],
        claims:[{kind:"CERTIFICATE",property:0,value:1,status:"ASSERTED_BY_SUPPLIER",evidence:[0],qualifications:[2]}],
        gaps:[{document_id:null,description:3}]};
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wire)}]}}]});
    }
    if(prompt.includes("DILIGENCE_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]),question=prompt.split("QUESTION:\n")[1].split("\nREQUESTED_SUBJECTS_NOT_VERIFIED_IDENTITIES:")[0];
      if(question.includes("Synthetic interrupted diligence")&&!interruptedQuestions.has(question)){
        interruptedQuestions.add(question);return new Response("Synthetic diligence interruption",{status:503});
      }
      const wire=diligenceWire(sources,{capacity:question.includes("Synthetic maximum-field diligence"),empty:question.includes("Synthetic empty diligence")});
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wire)}]}}]});
    }
    if(prompt.includes("ENTITY_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]),question=prompt.split("QUESTION:\n")[1].split("\nREQUESTED_TARGETS_NOT_VERIFIED_IDENTITIES:")[0];
      if(question.includes("Synthetic interrupted entity")&&!interruptedQuestions.has(question)){
        interruptedQuestions.add(question);return new Response("Synthetic entity interruption",{status:503});
      }
      const candidates=question.includes("Synthetic empty entity")?[]:question.includes("Synthetic maximum-field entity")
        ?entityMaximum.candidates:entityProposals(sources);
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(entityWire(candidates,sources,!question.includes("Synthetic maximum-field entity")))}]}}]});
    }
    if(prompt.includes("OBLIGATION_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]),question=prompt.split("QUESTION:\n")[1].split("\nOBLIGATION_DOCUMENTS:")[0];
      if(question.startsWith("Synthetic maximum-field")) {
        const wire=obligationWire(capacity.candidates,sources);
        return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(wire)}]}}]});
      }
      if(question.includes("Synthetic interrupted obligation")&&!interruptedQuestions.has(question)){interruptedQuestions.add(question);return new Response("Synthetic obligation interruption",{status:503});}
      const primary=sources.find(source=>source.document_id===obligationDocument),definition=sources.find(source=>source.document_id===obligationDefinition);
      const quote=(source,text)=>({citation_id:source.citation_id,quote:text});
      const candidates=primary&&!question.includes("Synthetic empty obligation")?[{
        provision:quote(primary,"operators must retain reports for 30 days, except public summaries."),authority:quote(primary,"Synthetic Board."),
        jurisdiction:quote(primary,"Region Example"),actor:quote(primary,"operators"),action:quote(primary,"retain reports"),
        applicability:definition?quote(definition,"Applies only to listed operators."):null,deadline:quote(primary,"30 days"),valid_from:quote(primary,"2026-01-01"),valid_to:null,
        definitions:definition?[quote(definition,'"Report" means a synthetic inspection record.')]:[],exceptions:[quote(primary,"except public summaries")],
        amendments:definition?[quote(definition,"Amendment A extends the reporting requirement.")]:[],supersedes:[quote(primary,"Replaces section 2.")],
        control_candidate:"Propose retention review; confirm applicability and exceptions.",limitations:["Synthetic source wording; not legal certification."]
      }]:[];
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(obligationWire(candidates,sources))}]}}]});
    }
    if(prompt.includes("CONTRADICTION_DOCUMENTS:\n")) {
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
      const question=prompt.split("QUESTION:\n")[1].split("\nCONTRADICTION_DOCUMENTS:")[0];
      if(question.includes("Synthetic interrupted contradiction")&&!interruptedQuestions.has(question)){interruptedQuestions.add(question);return new Response("synthetic interruption",{status:503});}
      const left=sources.find(s=>s.document_id===document||s.document_id===pagelessDocument),right=sources.find(s=>s.document_id===comparisonDocument);
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({pairs:left&&right&&!question.includes("Synthetic empty contradiction")?[{
        left:{citation_id:left.citation_id,quote:"mass: 1.005 kg"},right:{citation_id:right.citation_id,quote:comparisonText},
        relationship:"INSUFFICIENT_CONTEXT",explanation:"Measurement context and equivalence have not been established."}]:[]})}]}}]});
    }
    if(prompt.includes("TIMELINE_DOCUMENTS:\n")) {
      const docs=JSON.parse(prompt.split("TIMELINE_DOCUMENTS:\n")[1].split("\nEVIDENCE:\n")[0]),sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
      const question=prompt.split("QUESTION:\n")[1].split("\nTIMELINE_DOCUMENTS:")[0];
      if(question.includes("Synthetic interrupted timeline")&&!interruptedQuestions.has(question)){interruptedQuestions.add(question);return new Response("synthetic interruption",{status:503});}
      const documents=docs.map(d=>{const source=sources.find(s=>s.document_id===d.document_id);return {document_id:d.document_id,events:!source?[]:source.content.includes("Issued")?
        [{citation_id:source.citation_id,quote:"Issued 2024-02.",date_text:"2024-02",date_role:"PUBLISHED"},{citation_id:source.citation_id,quote:"Effective 2024-02-29.",date_text:"2024-02-29",date_role:"EFFECTIVE"}]:
        source.content.includes("Reviewed")?[{citation_id:source.citation_id,quote:"Reviewed 03/04/2024.",date_text:"03/04/2024",date_role:"OBSERVED"},{citation_id:source.citation_id,quote:"Open period 2024/2025.",date_text:"2024/2025",date_role:"EVENT"}]:[]};});
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({documents})}]}}]});
    }
    if(prompt.includes("COMPARISON_DOCUMENTS:\n")) {
      const docs=JSON.parse(prompt.split("COMPARISON_DOCUMENTS:\n")[1].split("\nEVIDENCE:\n")[0]);
      const sources=JSON.parse(prompt.split("\nEVIDENCE:\n")[1]);
      const criterion=prompt.split("CRITERION:\n")[1].split("\nCOMPARISON_DOCUMENTS:")[0];
      if(criterion.includes("Synthetic interrupted comparison")&&!interruptedQuestions.has(criterion)){interruptedQuestions.add(criterion);return new Response("synthetic interruption",{status:503});}
      return result({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({cells:docs.map(d=>({document_id:d.document_id,
        answer:`The mass is ${d.document_id===document?"1.005":"2.005"} kg [${sources.find(s=>s.document_id===d.document_id).citation_id}].`}))})}]}}]});
    }
    const body=JSON.parse(init.body),question=body.contents[0].parts[0].text.split("QUESTION:\n")[1]?.split("\n\nEVIDENCE:")[0];
    if(question?.includes("Synthetic interrupted execution")&&!interruptedQuestions.has(question)){interruptedQuestions.add(question);return new Response("synthetic provider interruption",{status:503});}
    return result({candidates:[{finishReason:"STOP",content:{parts:[{text:"The mass is 1.005 kg [S1]."}]}}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:12}});
  }
  if(url.hostname==="research-qdrant.invalid") {
    if(url.pathname.endsWith("/points/query/batch"))return result({result:JSON.parse(init.body).searches.map(()=>({points:[]}))});
    const large=JSON.parse(init.body||"{}").filter?.must?.some(condition=>condition.key==="document_id"&&condition.match?.any?.includes(largeDocument));
    return result(url.pathname.endsWith("/points/query")?{result:{points:[{id:large?largeChunk:sourceChunk,score:0.9,payload:{workspace_id:workspace,document_id:large?largeDocument:document,
      version_id:large?largeVersion:sourceVersion,index_generation:"synthetic-source-generation",chunk_id:large?largeChunk:sourceChunk}}]}}:{});
  }
  if (url.hostname !== "research-peer.invalid") return ordinaryFetch(input, init);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
  if (url.pathname === "/auth/v1/user") {const actor=new Headers(init.headers).get("authorization")?.split(":").at(-1)||user;actors.add(actor);return json({id:actor});}
  if(url.pathname.startsWith("/storage/v1/object/")) {
    const key=url.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?documents\/(.+)$/)?.[1];
    const bytes=key&&fixtureOriginals.get(decodeURIComponent(key));
    if(!bytes)return json({message:"Synthetic original not found"},404);
    let cancelled=false;
    const body=init.method==="HEAD"?null:new ReadableStream({async pull(controller){
      await new Promise(resolve=>setTimeout(resolve,1500));
      if(cancelled)return;
      controller.enqueue(bytes);controller.close();
    },cancel(){cancelled=true;}});
    return new Response(body,{headers:{"content-length":String(bytes.length)}});
  }
  if (url.pathname === "/rest/v1/workspace_members") {
    if(init.method==="HEAD")return new Response(null,{headers:{"content-range":`*/${actors.size}`}});
    const filter=url.searchParams.get("user_id"),actor=filter?.startsWith("eq.")?filter.slice(3):null;
    const ids=actor?[actor]:[...actors].sort().filter(id=>!filter?.startsWith("gt.")||id>filter.slice(3));
    return json(ids.slice(0,Number(url.searchParams.get("limit")||ids.length)).map(id=>({workspace_id:workspace,user_id:id,role:reviewers.has(id)?"editor":"owner",
      profiles:{display_name:reviewers.has(id)?"Synthetic reviewer":id}})));
  }
  if(url.pathname==="/rest/v1/finding_versions")return json([{author_id:findings.get(url.searchParams.get("finding_id")?.slice(3))?.author_id}]);
  if (url.pathname === "/rest/v1/workspaces") return json([{id: workspace, name: "Synthetic research workspace", lifecycle_state: "active", capability_revision: 1}]);
  if (url.pathname === "/rest/v1/workspace_settings") return json([{active_policy_id: policy, policy_version: 1}]);
  if (url.pathname === "/rest/v1/documents") {
    const rows=scoped(fixtureDocuments,url);
    if(url.searchParams.get("order")==="id.asc")rows.sort((a,b)=>a.id.localeCompare(b.id));
    return json(rows.slice(0,Number(url.searchParams.get("limit")||rows.length)));
  }
  if (url.pathname === "/rest/v1/document_versions") return json(scoped(fixtureVersions,url));
  if (url.pathname === "/rest/v1/document_chunks") {
    const rows=scoped(fixtureChunks,url),order=url.searchParams.get("order");
    if(order==="id.asc")rows.sort((a,b)=>a.id.localeCompare(b.id));
    if(order==="chunk_index.asc")rows.sort((a,b)=>a.chunk_index-b.chunk_index);
    return json(rows.slice(0,Number(url.searchParams.get("limit")||rows.length)));
  }
  if(url.pathname==="/rest/v1/research_runs")return json([runs.get(url.searchParams.get("id")?.slice(3))].filter(Boolean));
  const data = JSON.parse(init.body);
  if(url.pathname==="/rest/v1/rpc/nexus_research_finding_contract")return json({schema_version:"research-finding/1",max_result_index:44});
  if(url.pathname==="/rest/v1/rpc/nexus_research_comparison_contract")return json({schema_version:"research-comparison/1",batch_size:8,max_steps:45});
  if(url.pathname==="/rest/v1/rpc/nexus_research_timeline_contract")return json({schema_version:"research-timeline/1",batch_size:8,max_steps:45});
  if(url.pathname==="/rest/v1/rpc/nexus_research_contradiction_contract")return json({schema_version:"research-contradiction/1",max_sources:50,max_steps:11,max_pairs:6,runtime_seconds:420});
  if(url.pathname==="/rest/v1/rpc/nexus_research_candidates_contract")return json({schema_version:"research-candidates/1",max_rows:201,max_candidates:200,max_sources:50});
  if(url.pathname==="/rest/v1/rpc/nexus_research_deep_contract")return json({schema_version:"research-deep/1",max_sources:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,max_prior_originals:144,max_synthesis_sources:156});
  if(url.pathname==="/rest/v1/rpc/nexus_research_obligation_contract")return json({schema_version:"research-obligations/1",max_sources:50,max_subquestions:10,max_steps:11,max_query_variants:8,runtime_seconds:420,max_candidates:12,max_result_bytes:1000000,max_run_bytes:11000000});
  if(url.pathname==="/rest/v1/rpc/nexus_research_entity_contract")return json({schema_version:"research-entities/1",max_sources:50,max_subquestions:10,max_steps:11,max_query_variants:8,runtime_seconds:420,max_candidates:12,max_result_bytes:1000000,max_run_bytes:11000000});
  if(url.pathname==="/rest/v1/rpc/nexus_research_diligence_contract")return json({schema_version:"research-diligence/1",max_sources:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,max_observations:12,max_result_bytes:1000000,max_run_bytes:13001000});
  if(url.pathname==="/rest/v1/rpc/nexus_research_passport_contract")return json({schema_version:"research-passport/1",max_sources:60,max_subquestions:12,max_steps:13,max_query_variants:8,runtime_seconds:600,max_claims:12,max_result_bytes:1000000,max_run_bytes:13001000});
  if(url.pathname==="/rest/v1/rpc/nexus_research_procurement_contract")return json({schema_version:"research-procurement/1",max_sources:50,max_subquestions:10,max_steps:11,max_query_variants:8,runtime_seconds:420,max_records:12,max_fields:13,max_anchors:156,max_result_bytes:1000000,max_run_bytes:11000000});
  if(url.pathname==="/rest/v1/rpc/nexus_research_deep_context") {
    const run=runs.get(data.p_id),ids=new Set(run.results.flatMap(result=>result.sources.map(source=>source.chunk_id)));
    return json({schema_version:"research-deep-context/1",run_id:run.id,generation:run.generation,position:run.position,items:fixtureChunks.filter(chunk=>ids.has(chunk.id))});
  }
  if(url.pathname==="/rest/v1/rpc/nexus_research_candidates") {
    const run=runs.get(data.p_id),selected=run.source_snapshot.filter(s=>data.p_document_ids.includes(s.document_id)),items=[];
    let count=0,limited=false;
    for(const [index,s] of selected.entries()) {
      const allowance=Math.floor(201/selected.length)+(index<201%selected.length?1:0);
      const rows=fixtureChunks.filter(c=>c.version_id===s.version_id).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,allowance);
      count+=rows.length;limited||=rows.length===allowance;items.push(...(rows.length===allowance?rows.slice(0,-1):rows));
    }
    return json({schema_version:"research-candidates/1",run_id:run.id,generation:run.generation,position:run.position,items,lexical_rows_read:count,lexical_limit_reached:limited});
  }
  if(url.pathname==="/rest/v1/rpc/nexus_management_version")return json({version:"036"});
  if(url.pathname==="/rest/v1/rpc/nexus_invitation_version")return json({version:"040",recipient_bound:true,manual_delivery:true});
  if(url.pathname==="/rest/v1/rpc/workbench_read") {
    if(data.p_resource!=="findings")throw Error("Unexpected synthetic workbench resource");
    return json({items:[...findings.values()].filter(f=>f.owner_id===data.p_context.user_id||f.participants.some(p=>p.user_id===data.p_context.user_id)),next_after:null});
  }
  if(url.pathname==="/rest/v1/rpc/nexus_finding") {
    const actor=data.p_context.user_id;
    if(data.p_operation==="create") {
      if(findingKeys.has(data.p_key))return json(findings.get(findingKeys.get(data.p_key)));
      const run=runs.get(data.p_command.research_run_id),answer=run?.results[data.p_command.result_index];
      if(!answer)throw Error("Synthetic finding needs an actual stored executor result");
      const f={id:randomUUID(),workspace_id:workspace,owner_id:actor,author_id:actor,title:data.p_command.title,revision:1,source_run_id:null,
        source_research_run_id:run.id,source_research_position:data.p_command.result_index,authored_markdown:"",generated_markdown:answer.answer,
        source_unavailable:false,evidence:answer.sources.map(s=>({id:s.chunk_id,document_id:s.document_id,version_id:s.version_id,original_text:fixtureChunks.find(c=>c.id===s.chunk_id).original_text,
          original_content_hash:s.original_content_hash,location:s.location,citation_id:s.citation_id,filename:s.filename,available:true,freshness:"current"})),
        research_origin:{run_id:run.id,result_index:data.p_command.result_index,plan_id:run.plan_id,question:answer.question,comparison:answer.comparison||null,timeline:answer.timeline||null,contradiction:answer.contradiction||null,deep:answer.deep||null,obligations:answer.obligations||null,entities:answer.entities||null,diligence:answer.diligence||null,passport:answer.passport||null,procurement:answer.procurement||null,query_retrieval:answer.query_retrieval||null,claim_state:"REVIEW_REQUIRED",source_state:"CURRENT"},
        export_state:"RIGHTS_REVIEW_REQUIRED",reviews:[],participants:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString(),permission:"owner"};
      findings.set(f.id,f);findingKeys.set(data.p_key,f.id);
      return json({code:"08006",message:"Synthetic interrupted finding response after commit"},503);
    }
    const f=findings.get(data.p_id);if(!f)throw Error("Unknown synthetic finding");
    if(data.p_operation==="edit"){f.title=data.p_command.title;f.authored_markdown=data.p_command.authored_markdown;f.revision++;f.author_id=actor;f.reviews=[];}
    if(data.p_operation==="share")f.participants=[{user_id:data.p_command.user_id,permission:data.p_command.permission}];
    if(data.p_operation==="review")f.reviews=[{reviewer_id:actor,revision:f.revision,decision:data.p_command.decision,comment:data.p_command.comment,created_at:new Date().toISOString()}];
    return json({...f,permission:f.owner_id===actor?"owner":"contribute"});
  }
  if(url.pathname==="/rest/v1/rpc/v6_reserve_many")return json({state:"READY",reservations:Object.entries(data.p_dimensions).map(([,amount])=>({id:randomUUID(),amount,replayed:false}))});
  if(url.pathname==="/rest/v1/rpc/v6_settle_many")return json({state:"SETTLED"});
  if(url.pathname==="/rest/v1/rpc/nexus_research_step") {
    fixtureEvent(`step_${data.p_operation}`,data);
    const run=runs.get(data.p_id);
    if(!run||run.position!==data.p_position||run.generation!==data.p_generation||!["queued","running"].includes(run.state))return json({claimed:false,run});
    if(data.p_operation==="claim") {
      if(run.state!=="queued")return json({claimed:false,run});
      run.state="running";run.token=randomUUID();return json({claimed:true,token:run.token,run});
    }
    if(data.p_token!==run.token)return json({claimed:false,run});
    if(data.p_operation==="commit"){run.results.push(data.p_result);run.position++;run.state=run.position===run.total_steps?"completed":"queued";}
    else {run.state="interrupted";run.error_code=data.p_error;}
    return json({claimed:false,run});
  }
  if(url.pathname==="/rest/v1/rpc/nexus_research_run") {
    fixtureEvent(`run_${data.p_operation}`,data);
    if(data.p_operation==="list")return json({items:[...runs.values()].filter(run=>run.owner_id===data.p_context.user_id&&run.plan_id===data.p_plan).reverse()
      .map(run=>["COMPARE","TIMELINE","CONTRADICTION_ANALYSIS","DEEP_RESEARCH","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","DUE_DILIGENCE","PRODUCT_PASSPORT","PROCUREMENT_RESEARCH"].includes(run.mode)?{...run,results:[],results_included:false}:run),next_after:null});
    if(data.p_operation==="create") {
      if(runKeys.has(data.p_key))return json(runs.get(runKeys.get(data.p_key)));
      const draft=records.get(data.p_plan).plan;
      const run={id:randomUUID(),plan_id:data.p_plan,workspace_id:workspace,owner_id:data.p_context.user_id,schema_version:"research-run/1",persistence_state:"PERSISTED",state:"queued",
        generation:1,position:0,questions:draft.mode==="DEEP_RESEARCH"?[...draft.subquestions,draft.question]:[draft.question,...draft.subquestions],results:[],source_state:"CURRENT",error_code:null,created_at:new Date().toISOString(),
        mode:draft.mode,...(draft.mode==="PRODUCT_PASSPORT"?{passport_subject:draft.passport_subject}:{}),...(["ENTITY_INVESTIGATION","DUE_DILIGENCE"].includes(draft.mode)?{entity_scope:draft.entity_scope}:{}),source_snapshot:fixtureVersions.filter(v=>draft.private_source_ids.includes(v.document_id)).map(v=>({document_id:v.document_id,version_id:v.id,index_generation:v.index_generation,lifecycle_epoch:1})),admission:{credential_mode:"platform_trial"}};
      run.total_steps=run.questions.length*(["COMPARE","TIMELINE"].includes(run.mode)?Math.ceil(run.source_snapshot.length/8):1);
      run.deadline=new Date(Date.now()+(["DEEP_RESEARCH","DUE_DILIGENCE","PRODUCT_PASSPORT"].includes(run.mode)?600000:["CONTRADICTION_ANALYSIS","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","PROCUREMENT_RESEARCH"].includes(run.mode)?420000:["COMPARE","TIMELINE"].includes(run.mode)?300000:run.mode==="QUICK_LOOKUP"?30000:90000)).toISOString();
      runs.set(run.id,run);runKeys.set(data.p_key,run.id);return json(run);
    }
    const run=runs.get(data.p_id);
    if(data.p_operation==="cancel")run.state="cancelled";
    if(data.p_operation==="resume"&&(!["queued","running"].includes(run.state)||Date.parse(run.deadline)<=Date.now())){
      run.state="queued";run.generation++;run.error_code=null;run.deadline=new Date(Date.now()+(["DEEP_RESEARCH","DUE_DILIGENCE","PRODUCT_PASSPORT"].includes(run.mode)?600000:["CONTRADICTION_ANALYSIS","OBLIGATION_ANALYSIS","ENTITY_INVESTIGATION","PROCUREMENT_RESEARCH"].includes(run.mode)?420000:["COMPARE","TIMELINE"].includes(run.mode)?300000:run.mode==="QUICK_LOOKUP"?30000:90000)).toISOString();
    }
    return json(run);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_quantity") {
    if(data.p_operation==="list")return json({items:[...quantities.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(quantityKeys.has(data.p_key))return json(quantities.get(quantityKeys.get(data.p_key)));
    const command=data.p_input;
    if(command.document_id!==document || command.version_id!==sourceVersion || command.original_content_hash!==sourceHash ||
      command.value_span.start!==8 || command.value_span.end!==13 || command.unit_span.start!==14 || command.unit_span.end!==16)throw new Error("Unsupported synthetic capture response");
    const id=randomUUID(),record={id,plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,document_id:document,version_id:sourceVersion,chunk_id:sourceChunk,input:command,
      quantity:{value:"1.005",unit:"kg",evidence_ids:[`urn:nexusrag:quantity:${id}`]},source:{filename:"Synthetic policy.txt",page_number:2,location:{page:2},value_context:{text:sourceText,span_start:8,span_end:13},unit_context:{text:sourceText,span_start:14,span_end:16}},
      schema_version:"research-quantity/1",state:"captured",persistence_state:"PERSISTED",source_state:"SOURCE_SPANS_MATCHED_REVIEW_REQUIRED",freshness:"current",created_at:new Date().toISOString()};
    quantities.set(id,record);quantityKeys.set(data.p_key,id);
    return json({code:"08006",message:"Synthetic interrupted capture response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_conversion") {
    if(data.p_operation==="list")return json({items:[...conversions.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(conversionKeys.has(data.p_key))return json(conversions.get(conversionKeys.get(data.p_key)));
    const command=data.p_input;
    // Fixed transport response; real conversion arithmetic/persistence is tested in SQL.
    if(command.quantity.value!=="1.005" || command.quantity.unit!=="kg" || command.factor!=="1000" || command.target_unit!=="g" ||
      command.precision!==2 || command.factor_effective_on!=="2026-10-15")throw new Error("Unsupported synthetic conversion response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:command,
      result:{operation:"CONVERT_UNIT",value:"1005.00",unit:"g",formula:"1.005*1000",evidence_ids:[...new Set([...command.quantity.evidence_ids,command.conversion_evidence_id])],precision:2,rounding:"ROUND_HALF_EVEN"},
      schema_version:"research-conversion/1",state:"calculated",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    conversions.set(record.id,record);conversionKeys.set(data.p_key,record.id);
    return json({code:"08006",message:"Synthetic interrupted conversion response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_aggregation") {
    if(data.p_operation==="list")return json({items:[...aggregations.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse(),next_after:null});
    if(aggregationKeys.has(data.p_key))return json(aggregations.get(aggregationKeys.get(data.p_key)));
    const command=data.p_input;
    // Fixed weighted-average transport fixture, not a second arithmetic engine.
    if(command.operation!=="WEIGHTED_AVERAGE" || command.precision!==2 || !command.grouped || command.missing_value_treatment!=="EXCLUDE" ||
      JSON.stringify(command.weights)!==JSON.stringify(["1","3","0"]) || JSON.stringify(command.values.map(q=>q.value))!==JSON.stringify(["0.1","0.2",null]) ||
      command.values.some(q=>q.unit!=="USD" || q.group!=="A"))throw new Error("Unsupported synthetic aggregate response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:command,
      result:{operation:command.operation,precision:2,rounding:"ROUND_HALF_EVEN",missing_value_treatment:"EXCLUDE",groups:[{
        group:"A",value:"0.18",unit:"USD",expression:"weighted_average(0.1,0.2;weights=1,3)",rows:[],
        evidence_ids:[...new Set(command.values.slice(0,2).flatMap(q=>q.evidence_ids))],total_count:3,included_count:2,excluded_count:1,excluded_input_indices:[2],value_display:"ROUND_HALF_EVEN"}]},
      state:"calculated",schema_version:"research-aggregation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    aggregations.set(record.id,record);aggregationKeys.set(data.p_key,record.id);
    return json({code:"08006",message:"Synthetic interrupted aggregate response after commit"},503);
  }
  if (url.pathname === "/rest/v1/rpc/nexus_research_calculation") {
    if(data.p_operation==="list")return json({items:[...calculations.values()].filter(item=>item.owner_id===data.p_context.user_id && item.plan_id===data.p_plan_id).reverse()});
    if(calculationKeys.has(data.p_key))return json(calculations.get(calculationKeys.get(data.p_key)));
    if(data.p_input.right.value==="0")return json({code:"P0001",message:"NR:CALCULATION_INVALID"},400);
    // Fixed transport response only. Real arithmetic/persistence has separate SQL tests.
    const captured=data.p_input.operation==="ADD" && data.p_input.left.value==="1.005" && data.p_input.right.value==="1.005" && data.p_input.precision===3;
    if(!captured && (data.p_input.operation!=="ADD" || data.p_input.left.value!=="9007199254740993.1" || data.p_input.right.value!=="0.2" || data.p_input.precision!==2))throw new Error("Unsupported synthetic calculation response");
    const record={id:randomUUID(),plan_id:data.p_plan_id,workspace_id:workspace,owner_id:data.p_context.user_id,input:data.p_input,
      result:{operation:"ADD",value:captured?"2.010":"9007199254740993.30",unit:captured?"kg":"USD",formula:captured?"1.005+1.005":"9007199254740993.1+0.2",
        evidence_ids:[...new Set([...data.p_input.left.evidence_ids,...data.p_input.right.evidence_ids])],precision:captured?3:2,rounding:"ROUND_HALF_EVEN"},
      state:"calculated",schema_version:"research-calculation/1",persistence_state:"PERSISTED",input_evidence_state:"CALLER_ASSERTED_NOT_VERIFIED",created_at:new Date().toISOString()};
    calculations.set(record.id,record);calculationKeys.set(data.p_key,record.id);
    if(data.p_input.left.evidence_ids.includes("synthetic-interrupted-calculation"))return json({code:"08006",message:"Synthetic interrupted response after commit"},503);
    return json(record);
  }
  if (url.pathname !== "/rest/v1/rpc/nexus_research_plan") throw new Error(`Unexpected synthetic peer path: ${url.pathname}`);
  if (data.p_operation === "create") {
    if (keys.has(data.p_key)) return json(records.get(keys.get(data.p_key)));
    const record = {id: randomUUID(), workspace_id: workspace, owner_id: data.p_context.user_id, plan: data.p_plan,
      limits: RESEARCH_MODE_LIMITS[data.p_plan.mode], state: "planned", persistence_state: "PERSISTED", execution_supported: false,
      schema_version: "research-plan/1", created_at: new Date().toISOString()};
    records.set(record.id, record); keys.set(data.p_key, record.id);
    if (data.p_plan.question.includes("Synthetic interrupted save")) return json({code: "08006", message: "Synthetic connection interrupted after commit"}, 503);
    return json(record);
  }
  if (data.p_operation === "read") return json(records.get(data.p_id));
  const ordered = [...records.values()].filter(item => item.owner_id===data.p_context.user_id).reverse();
  const start = data.p_after ? ordered.findIndex(item => item.id === data.p_after) + 1 : 0;
  const items = ordered.slice(start, start + data.p_limit);
  return json({items, next_after: start + items.length < ordered.length ? items.at(-1).id : null});
};
const server = await createServer({ root, configFile: false, envFile: false,
  cacheDir: process.env.NEXUSRAG_FIXTURE_CACHE_DIR,
  // The HTML is generated by middleware, so Vite cannot infer its TSX entry.
  // Discover dependencies before interaction, not by reloading a filled form.
  optimizeDeps: { entries: ["scripts/fixtures/research-plans.tsx"],
    include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react", "zustand", "clsx", "tailwind-merge", "framer-motion", "next/navigation", "next/dist/shared/lib/hooks-client-context.shared-runtime"],
    force: true, holdUntilCrawlEnd: true },
  plugins: [react(), {name: "synthetic-research-transport", configureServer(instance) {
    instance.middlewares.use((request, response, next) => { void serve(request, response, next, instance).catch(error => {
      console.error(error); response.statusCode=500; response.end("Synthetic fixture failed");
    }); });
  }}],
  resolve: {alias: [{find: "@/lib/api-context", replacement: resolve(root,"scripts/fixtures/research-context.ts")}, {find: "@", replacement: resolve(root,"src")}]},
  define: {"process.env": JSON.stringify({NODE_ENV: "development", NEXT_PUBLIC_API_URL: `http://127.0.0.1:${port}`})},
  server: {host: "127.0.0.1", port, strictPort: true, watch: {ignored: ["**/.next/**", "**/.open-next/**"]}},
});
async function serve(request, response, next, instance) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (["/","/findings","/documents"].includes(url.pathname)||/^\/documents\/[0-9a-f-]+$/i.test(url.pathname)) {
    const pairedReviewer=url.searchParams.get("reviewer");
    if(pairedReviewer&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pairedReviewer)){
      actors.add(pairedReviewer);reviewers.add(pairedReviewer);
    }
    response.setHeader("content-type","text/html");
    response.end(await instance.transformIndexHtml("/", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/research-plans.tsx"></script></body></html>'));
    return;
  }
  if (!url.pathname.startsWith("/api/")) return next();
  let body=""; for await (const fragment of request) body+=fragment;
  const result = await handle(new Request(url, {method: request.method, headers: request.headers,
    ...(["GET","HEAD"].includes(request.method) ? {} : {body})}), env);
  response.statusCode=result.status;
  result.headers.forEach((value,key) => response.setHeader(key,value));
  response.flushHeaders();
  if(!result.body){response.end();return;}
  try { await pipeline(Readable.fromWeb(result.body),response); }
  catch(error){if(response.destroyed&&error.code==="ERR_STREAM_PREMATURE_CLOSE")return;throw error;}
}
await server.listen();
console.log(`SYNTHETIC_RESEARCH_UI_GATEWAY_FIXTURE http://127.0.0.1:${port}/; no hosted credentials/provider processing`);
for (const signal of ["SIGINT","SIGTERM"]) process.on(signal, async () => { await server.close(); process.exit(0); });
