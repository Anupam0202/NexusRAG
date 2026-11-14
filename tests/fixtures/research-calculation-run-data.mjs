import {createHash} from "node:crypto";

// Two synthetic documents with figures, and what Gemini would answer for them: figures by quotation, operations by
// name. Shared by the frontend tests, which build the stored step with the gateway's own calculationRunResult.
export function calculationRunFixture() {
  const documents=[{id:"ca1c0000-0000-4000-8100-000000000001",filename:"Synthetic annual report.txt"},
    {id:"ca1c0000-0000-4000-8100-000000000002",filename:"Synthetic headcount.txt"}];
  const texts=["\u{1f4c8} Revenue in fiscal 2023 was EUR 1,234.5 million, up from EUR 1,100.0 million in fiscal 2022.",
    "Headcount at year end: 120 people (2023)."];
  const sources=texts.map((content,i)=>({citation_id:`S${i+1}`,document_id:documents[i].id,version_id:`ca1c0200-0000-4000-8100-00000000000${i+1}`,
    chunk_id:`ca1c0100-0000-4000-8100-00000000000${i+1}`,filename:documents[i].filename,content,
    original_content_hash:createHash("sha256").update(content).digest("hex"),location:null,page_number:i?null:3,chunk_index:0,excerpt:false}));
  const run={id:"ca1c0300-0000-4000-8100-000000000001",plan_id:"ca1c0400-0000-4000-8100-000000000001",workspace_id:"11111111-1111-4111-8111-111111111111",
    owner_id:"22222222-2222-4222-8222-222222222222",schema_version:"research-run/1",persistence_state:"PERSISTED",mode:"CALCULATION",
    state:"completed",generation:1,position:1,total_steps:1,questions:["How much did revenue grow, and what was revenue per person?"],results:[],
    source_state:"CURRENT",error_code:null,created_at:"2026-11-14T00:00:00Z",requested_calculations:["Percent change in revenue from fiscal 2022 to fiscal 2023"],
    source_snapshot:documents.map((document,i)=>({document_id:document.id,version_id:sources[i].version_id,index_generation:"synthetic",lifecycle_epoch:1}))};
  const wire={schema_version:"research-calculation-wire/1",quantities:[
    {label:"Revenue, fiscal 2023",anchor:{citation_id:"S1",quote:"Revenue in fiscal 2023 was EUR 1,234.5 million"},value:"1,234.5",unit:["EUR","million"],period:"fiscal 2023"},
    {label:"Revenue, fiscal 2022",anchor:{citation_id:"S1",quote:"up from EUR 1,100.0 million in fiscal 2022"},value:"1,100.0",unit:["EUR","million"],period:"fiscal 2022"},
    {label:"Year-end headcount",anchor:{citation_id:"S2",quote:"Headcount at year end: 120 people"},value:"120",unit:"people",period:null},
    {label:"A misread figure",anchor:{citation_id:"S1",quote:"Revenue in fiscal 2023"},value:"3",unit:"fiscal"}],
  calculations:[{label:"Revenue growth",operation:"PERCENT_CHANGE",left:1,right:0,precision:2},
    {label:"Revenue per person",operation:"DIVIDE",left:0,right:2,precision:3},
    {label:"Revenue plus headcount",operation:"ADD",left:0,right:2,precision:0}]};
  return {documents,sources,run,wire};
}
