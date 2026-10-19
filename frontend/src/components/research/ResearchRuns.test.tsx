import { fireEvent,render,screen,waitFor } from "@testing-library/react";
import { beforeEach,expect,it,vi } from "vitest";
import { emptyResearchPlan,modeLimits,type ResearchPlanRecord } from "@/lib/research-plan";
const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import { ResearchRuns } from "./ResearchRuns";
const id="11111111-1111-4111-8111-111111111111";
const plan={id,workspace_id:id,owner_id:id,plan:{...emptyResearchPlan(),question:"Synthetic mass?",private_source_ids:[id],completion_criteria:["Inspect source."]},limits:modeLimits.QUICK_LOOKUP,
  state:"planned",schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false} as ResearchPlanRecord;
const run={id,plan_id:id,workspace_id:id,owner_id:id,state:"queued",generation:1,position:0,questions:[plan.plan.question],results:[],source_state:"CURRENT",error_code:null,
  created_at:"2026-10-15T00:00:00Z",dispatch_state:"PENDING_RECOVERY"};
beforeEach(()=>{vi.clearAllMocks();api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.researchRunCommand.mockResolvedValue(run);});
const props={plan,workspaceId:id,userId:id,canWrite:true};
it("requires confirmation and reuses a start key after an interrupted response",async()=>{
  api.researchRunCommand.mockRejectedValueOnce(new Error("Start unconfirmed")).mockResolvedValue(run);
  render(<ResearchRuns {...props}/>);
  const start=await screen.findByRole("button",{name:"Start research"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(start).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
  expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  fireEvent.click(start);await screen.findByText(/queue dispatch was not confirmed/);
  expect(api.researchRunCommand.mock.calls[0][4]).toBe(api.researchRunCommand.mock.calls[1][4]);
  expect(start).toBeDisabled();
  fireEvent.click(screen.getByRole("button",{name:"Retry queued dispatch"}));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(3));
  expect(api.researchRunCommand.mock.calls[2][2]).toBe("resume");expect(api.researchRunCommand.mock.calls[2][3]).toBe(run.id);
});
it("refreshes a failed execution list without losing the stored plan",async()=>{
  api.listResearchRuns.mockRejectedValueOnce(new Error("List unavailable")).mockResolvedValue({items:[run],next_after:null});
  render(<ResearchRuns {...props}/>);
  await screen.findByRole("alert");fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  expect(await screen.findByRole("button",{name:`Open execution ${id}`})).toBeVisible();
});
it("offers confirmed execution for a saved Deep Research plan instead of a plan-only shell",async()=>{
  render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,mode:"DEEP_RESEARCH"},limits:modeLimits.DEEP_RESEARCH}}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  const start=screen.getByRole("button",{name:"Start research"});
  expect(start).toBeDisabled();fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(start);
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("DEEP_RESEARCH");
});
it("ordinary viewer inspection never enables run mutations",async()=>{
  api.listResearchRuns.mockResolvedValue({items:[run],next_after:null});render(<ResearchRuns {...props} canWrite={false}/>);
  await screen.findByRole("button",{name:`Open execution ${id}`});
  expect(screen.getByRole("checkbox")).toBeDisabled();expect(screen.getByRole("button",{name:"Start research"})).toBeDisabled();
  expect(api.researchRunCommand).not.toHaveBeenCalled();
});
it("does not silently ignore date-constrained or unimplemented mode plans",async()=>{
  const view=render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,date_from:"2026-10-15"}}}/>);
  await screen.findByText(/constraints that execution cannot yet honor/);
  fireEvent.click(screen.getByRole("checkbox"));expect(screen.getByRole("button",{name:"Start research"})).toBeDisabled();
  view.unmount();render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,mode:"ENTITY_INVESTIGATION"},limits:modeLimits.ENTITY_INVESTIGATION}}/>);
  expect(await screen.findByText(/Execution is not implemented for this mode/)).toBeVisible();
  expect(screen.queryByRole("button",{name:"Start research"})).not.toBeInTheDocument();
});
it("starts an explicitly confirmed selected-source Timeline using its typed mode",async()=>{
  render(<ResearchRuns {...props} plan={{...plan,plan:{...plan.plan,mode:"TIMELINE"}}}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Start research"}));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(1));
  expect(api.researchRunCommand.mock.calls[0][5]).toBe("TIMELINE");
});
it("retains the bounded lexical-coverage warning when a completed result is reopened",async()=>{
  const result={question:plan.plan.question,answer:"No supported answer.",claim_state:"UNSUPPORTED",abstained:true,sources:[],validated_citation_ids:[],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:200,lexical_limit_reached:true},provider_cost_status:"NOT_CALLED"};
  const completed={...run,state:"completed",position:1,results:[result]};
  api.listResearchRuns.mockResolvedValue({items:[completed],next_after:null});api.researchRunCommand.mockResolvedValue(completed);
  render(<ResearchRuns {...props}/>);fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  expect(await screen.findByText(/Lexical candidate limit reached/)).toBeVisible();
  expect(screen.getByText(/200 candidate chunks considered/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(2));
  expect(screen.getByText(/Additional chunks were not lexically ranked/)).toBeVisible();
});
it("copies saved query methodology as queries, never as additional evidence",async()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText}});
  const result={question:plan.plan.question,answer:"No supported answer.",claim_state:"UNSUPPORTED",abstained:true,sources:[],validated_citation_ids:[],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"UNKNOWN",
    query_retrieval:{schema_version:"research-query-retrieval/1",queries:[plan.plan.question,"Synthetic mass wording"],completed_queries:2,max_queries:2,
      expansion_status:"EXPANDED",rejected_queries:0,expansion_model:"synthetic",expansion_usage:{},evidence_interpretation:"SEARCH_QUERIES_NOT_EVIDENCE",paid_fallback:false}};
  const completed={...run,state:"completed",position:1,results:[result]};api.listResearchRuns.mockResolvedValue({items:[completed],next_after:null});api.researchRunCommand.mockResolvedValue(completed);
  render(<ResearchRuns {...props}/>);fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  fireEvent.click(await screen.findByRole("button",{name:/^Copy results$/}));
  await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1));expect(writeText.mock.calls[0][0]).toContain("Search queries (not evidence):");
  expect(writeText.mock.calls[0][0]).toContain("Synthetic mass wording");
});

for(const pageNumber of [null,0,2])it(`shows the original source locator without inventing a page for ${pageNumber}`,async()=>{
  const source={citation_id:"S1",document_id:id,version_id:id,chunk_id:id,filename:"Synthetic original.txt",content:"Original retained evidence.",
    original_content_hash:"a".repeat(64),location:pageNumber?{page:pageNumber}:{char_start:0,char_end:27},page_number:pageNumber,chunk_index:0,excerpt:false};
  const result={question:plan.plan.question,answer:"Review the original [S1].",claim_state:"REVIEW_REQUIRED",abstained:false,sources:[source],validated_citation_ids:["S1"],
    coverage:{completeness:"NOT_EXHAUSTIVE",chunks_considered:1},provider_cost_status:"UNKNOWN"};
  const completed={...run,state:"completed",position:1,results:[result]};
  api.listResearchRuns.mockResolvedValue({items:[completed],next_after:null});api.researchRunCommand.mockResolvedValue(completed);
  render(<ResearchRuns {...props}/>);fireEvent.click(await screen.findByRole("button",{name:`Open execution ${id}`}));
  expect(await screen.findByText(`[S1] Synthetic original.txt / chunk 0${pageNumber?` / page ${pageNumber}`:""}`,{exact:true})).toBeVisible();
  expect(screen.queryByText(/\/ page 0/)).not.toBeInTheDocument();
  expect(screen.getByRole("link",{name:/^Inspect document$/})).toHaveAttribute("href",`/documents/${id}`);
});
