import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
import type {ResearchRun} from "@/lib/research-run";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {ResearchRuns} from "./ResearchRuns";
const id="11111111-1111-4111-8111-111111111111";
const texts=["Exact dormant original with every qualifying condition.","Second dormant original, not omitted from copied evidence."];
const sources=texts.map((content,index)=>({citation_id:`S${index+1}`,document_id:id,version_id:id,chunk_id:id,
  filename:`Original ${index+1}.txt`,content,original_content_hash:String(index+1).repeat(64),location:{char_start:0,char_end:content.length},page_number:null,chunk_index:index,excerpt:true}));
const run:ResearchRun={id,plan_id:id,workspace_id:id,owner_id:id,schema_version:"research-run/1",persistence_state:"PERSISTED",mode:"QUICK_LOOKUP",
  state:"completed",generation:1,position:1,questions:["Which originals need inspection?"],source_state:"CURRENT",error_code:null,created_at:"2026-10-21T18:00:00Z",
  results:[{question:"Which originals need inspection?",answer:"Review both originals [S1] [S2].",claim_state:"REVIEW_REQUIRED",abstained:false,
    sources,validated_citation_ids:["S1","S2"],model:null,coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:2},provider_cost_status:"UNKNOWN",review_state:"COMPLETION_CRITERIA_NOT_AUTOMATICALLY_VERIFIED"}]};
const plan:ResearchPlanRecord={id,workspace_id:id,owner_id:id,plan:{...emptyResearchPlan(),question:run.questions[0],private_source_ids:[id],completion_criteria:["Inspect each exact original."]},
  limits:modeLimits.QUICK_LOOKUP,state:"planned",created_at:run.created_at,schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
const writeText=vi.fn();
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[run],next_after:null});api.researchRunCommand.mockResolvedValue(run);
  writeText.mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});});
async function open(){render(<ResearchRuns plan={plan} workspaceId={id} userId={id} canWrite={false}/>);fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  return screen.findByText("[S1] Original 1.txt / chunk 0",{exact:true});}
it("preserves searchable original text and hashes while deferring unopened source controls",async()=>{
  const summary=await open();
  expect(summary.closest("details")).not.toHaveAttribute("open");
  for(const source of sources){
    expect(screen.getByText(source.content,{exact:true})).toBeInTheDocument();
    expect(screen.getByText(`SHA256 ${source.original_content_hash}`,{exact:true})).toBeInTheDocument();
  }
  expect(screen.queryByRole("link",{name:"Inspect document",hidden:true})).not.toBeInTheDocument();
  fireEvent.click(summary);
  expect(await screen.findByText(texts[0],{exact:true})).toBeVisible();
  expect(screen.getByRole("link",{name:"Inspect document"})).toHaveAttribute("href",`/documents/${id}`);
  expect(summary.closest("details")).toHaveAttribute("id",`${id}-0-S1`);
  fireEvent.click(summary);await waitFor(()=>expect(screen.queryByRole("link",{name:"Inspect document",hidden:true})).not.toBeInTheDocument());
  expect(screen.getByText(texts[0],{exact:true})).toBeInTheDocument();
});
it("preserves the saved clipboard citation contract without opening source panels",async()=>{
  await open();fireEvent.click(screen.getByRole("button",{name:"Copy results"}));
  await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));
  for(const source of sources){
    expect(writeText.mock.calls[0][0]).toContain(`[${source.citation_id}] ${source.filename}, chunk ${source.chunk_index}, ${source.original_content_hash}`);
    expect(writeText.mock.calls[0][0]).not.toContain(source.content);
  }
});
