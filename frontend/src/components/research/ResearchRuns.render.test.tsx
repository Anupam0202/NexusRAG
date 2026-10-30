import type {ComponentProps} from "react";
import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanRecord} from "@/lib/research-plan";
import {researchCopyRun} from "@/test/research-copy-fixtures";
import type {ResearchRun} from "@/lib/research-run";

const api=vi.hoisted(()=>({listResearchRuns:vi.fn(),researchRunCommand:vi.fn()}));
const observed=vi.hoisted(()=>({reports:vi.fn()}));
vi.mock("@/lib/api",()=>api);
vi.mock("./ComparisonMatrix",async importOriginal=>{
  const actual=await importOriginal<typeof import("./ComparisonMatrix")>();
  return {...actual,ComparisonMatrix:(props:ComponentProps<typeof actual.ComparisonMatrix>)=>{
    observed.reports(props.matrix.criterion_index);
    return <actual.ComparisonMatrix {...props}/>;
  }};
});
import {ResearchRuns} from "./ResearchRuns";

beforeEach(()=>{vi.clearAllMocks();});
async function open(run:ResearchRun) {
  const plan:ResearchPlanRecord={id:run.plan_id,workspace_id:run.workspace_id,owner_id:run.owner_id,
    plan:{...emptyResearchPlan(),mode:"COMPARE",question:run.questions[0],completion_criteria:["Inspect exact original evidence"],
      private_source_ids:run.source_snapshot!.map(source=>source.document_id)},limits:modeLimits.COMPARE,state:"planned",created_at:run.created_at,
    schema_version:"research-plan/1",persistence_state:"PERSISTED",execution_supported:false};
  api.listResearchRuns.mockResolvedValue({items:[run],next_after:null});api.researchRunCommand.mockResolvedValue(run);
  const props={plan,workspaceId:run.workspace_id,userId:run.owner_id,canWrite:true};
  const view=render(<ResearchRuns {...props}/>);
  fireEvent.click(await screen.findByRole("button",{name:`Open execution ${run.id}`}));
  await screen.findByRole("region",{name:"Comparison evidence matrix"});
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  observed.reports.mockClear();
  return {view,props};
}

it("keeps a saved report mounted without rerendering it when ordinary attestation UI changes",async()=>{
  await open(researchCopyRun("COMPARE"));
  fireEvent.click(screen.getByRole("checkbox"));
  expect(observed.reports).not.toHaveBeenCalled();
  expect(screen.getByRole("region",{name:"Comparison evidence matrix"})).toBeVisible();
  expect(screen.getByText("SHA256 "+researchCopyRun("COMPARE").results[0].sources[0].original_content_hash)).toBeInTheDocument();
});
it("reuses exact confirmed result content after an identical refresh rather than rerendering every report",async()=>{
  const run=researchCopyRun("COMPARE");await open(run);
  api.researchRunCommand.mockResolvedValue(structuredClone(run));
  fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(observed.reports).not.toHaveBeenCalled();
});
it("also reuses saved reports when an active run is polled",async()=>{
  const run=researchCopyRun("COMPARE");run.questions.push("A pending second criterion");run.total_steps=2;run.state="running";
  await open(run);api.researchRunCommand.mockResolvedValue(structuredClone(run));
  await waitFor(()=>expect(api.researchRunCommand).toHaveBeenCalledTimes(2),{timeout:3000});
  expect(observed.reports).not.toHaveBeenCalled();
  expect(screen.getByRole("progressbar",{name:"Research progress"})).toHaveAttribute("value","1");
});
it("renders an appended criterion once without rerendering unchanged earlier reports",async()=>{
  const run=researchCopyRun("COMPARE");run.questions.push("Which second criterion needs review?");run.total_steps=2;run.state="interrupted";await open(run);
  const next=structuredClone(run);next.position=2;next.state="completed";
  next.results.push({...structuredClone(next.results[0]),question:next.questions[1],comparison:{...structuredClone(next.results[0].comparison!),criterion_index:1}});
  api.researchRunCommand.mockResolvedValue(next);
  fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  await waitFor(()=>expect(screen.getAllByRole("region",{name:"Comparison evidence matrix"})).toHaveLength(2));
  await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh executions"})).toBeEnabled());
  expect(observed.reports.mock.calls.map(call=>call[0])).toEqual([1]);
  expect(screen.getByText(next.questions[1])).toBeInTheDocument();
});
it("does render changed earlier result content and keeps all source controls available",async()=>{
  const run=researchCopyRun("COMPARE");await open(run);
  const next=structuredClone(run);next.results[0].comparison!.cells[0].answer="Updated qualification requires review.";
  api.researchRunCommand.mockResolvedValue(next);
  fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  await screen.findByText("Updated qualification requires review.");
  expect(observed.reports.mock.calls.map(call=>call[0])).toEqual([0]);
  fireEvent.click(screen.getByText("[S1] Alpha.txt / chunk 0",{exact:true}));
  expect(await screen.findByRole("link",{name:"Inspect document"})).toBeVisible();
});
it("updates ordinary read-only role controls and removes evidence that becomes unavailable",async()=>{
  const run=researchCopyRun("COMPARE"),{view,props}=await open(run);
  view.rerender(<ResearchRuns {...props} canWrite={false}/>);
  expect(screen.getByRole("button",{name:"Save as finding"})).toBeDisabled();
  expect(observed.reports.mock.calls.map(call=>call[0])).toEqual([0]);
  api.researchRunCommand.mockResolvedValue({...run,source_state:"UNAVAILABLE_OR_CHANGED",results:[]});
  fireEvent.click(screen.getByRole("button",{name:"Refresh executions"}));
  await screen.findByText(/Evidence was removed or changed/);
  expect(screen.queryByRole("region",{name:"Comparison evidence matrix"})).not.toBeInTheDocument();
});
