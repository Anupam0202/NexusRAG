import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {emptyResearchPlan,modeLimits,type ResearchPlanInput} from "@/lib/research-plan";
const api=vi.hoisted(()=>({createResearchPlan:vi.fn(),listResearchPlans:vi.fn(),readResearchPlan:vi.fn(),getCurrentWorkspace:vi.fn(),listResearchRuns:vi.fn()}));
const library=vi.hoisted(()=>({documents:[] as Array<{document_id:string;filename:string;status:string}>,loading:false,error:null as string|null}));
vi.mock("@/lib/api",()=>api);
vi.mock("@/hooks/useDocuments",()=>({useDocuments:()=>library}));
import {useStore} from "@/hooks/useStore";
import ResearchPage from "./page";
const workspace="11111111-1111-4111-8111-111111111111";
const record={id:"33333333-3333-4333-8333-333333333333",workspace_id:workspace,owner_id:"user-a",
  plan:{...emptyResearchPlan(),question:"Synthetic source scope",completion_criteria:["Inspect exact originals"]},limits:modeLimits.QUICK_LOOKUP,
  state:"planned",persistence_state:"PERSISTED",schema_version:"research-plan/1",execution_supported:false};
const doc=(n:number,filename:string,status="ready")=>({document_id:`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`,filename,status});
beforeEach(()=>{
  vi.clearAllMocks();library.documents=[doc(1,"Keep selected.txt"),doc(2,"Match alpha.txt"),doc(3,"Match beta.txt"),doc(4,"Match processing.txt","processing")];library.loading=false;library.error=null;
  useStore.setState({authMode:"authenticated",authUser:{id:"user-a",email:null},workspaceId:workspace});
  api.getCurrentWorkspace.mockResolvedValue({role:"owner"});api.listResearchPlans.mockResolvedValue({items:[],next_after:null});
  api.listResearchRuns.mockResolvedValue({items:[],next_after:null});api.readResearchPlan.mockResolvedValue(record);
  api.createResearchPlan.mockImplementation(async(plan:ResearchPlanInput)=>({...record,plan,limits:modeLimits[plan.mode]}));
});
async function ready(){render(<ResearchPage/>);await waitFor(()=>expect(screen.getByRole("button",{name:"Refresh"})).toBeEnabled());}
async function save(){fireEvent.change(screen.getByLabelText("Question"),{target:{value:record.plan.question}});fireEvent.change(screen.getByLabelText("Completion criteria"),{target:{value:"Inspect exact originals"}});
  fireEvent.click(screen.getByRole("button",{name:"Save plan"}));await waitFor(()=>expect(api.createResearchPlan).toHaveBeenCalledTimes(1));return api.createResearchPlan.mock.calls[0][0] as ResearchPlanInput;}
it("selects and clears only ready filename matches while retaining selections outside the filter",async()=>{
  await ready();fireEvent.click(screen.getByRole("checkbox",{name:"Keep selected.txt"}));
  fireEvent.change(screen.getByRole("searchbox",{name:"Find private documents"}),{target:{value:"MATCH"}});
  fireEvent.click(screen.getByRole("checkbox",{name:"Match alpha.txt"}));
  const bulk=screen.getByRole("checkbox",{name:"Select matching documents"});expect(bulk).toBePartiallyChecked();
  fireEvent.click(bulk);expect(bulk).toBeChecked();expect(screen.getByRole("checkbox",{name:"Match beta.txt"})).toBeChecked();
  expect(screen.queryByRole("checkbox",{name:"Match processing.txt"})).not.toBeInTheDocument();
  fireEvent.click(bulk);expect(screen.getByRole("checkbox",{name:"Keep selected.txt"})).toBeChecked();
  expect((await save()).private_source_ids).toEqual([library.documents[0].document_id]);
});
it("selects all sixty accepted sources in one action and persists every exact ID",async()=>{
  library.documents=[...Array.from({length:60},(_,i)=>doc(i+1,`Passport evidence ${i+1}.txt`)),doc(61,"Unrelated.txt"),doc(62,"Passport not ready.txt","processing")];
  await ready();fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"DEEP_RESEARCH"}});
  fireEvent.change(screen.getByRole("searchbox",{name:"Find private documents"}),{target:{value:"Passport"}});
  const bulk=screen.getByRole("checkbox",{name:"Select matching documents"});expect(bulk).toBeEnabled();fireEvent.click(bulk);
  expect(bulk).toBeChecked();expect((await save()).private_source_ids).toEqual(library.documents.slice(0,60).map(doc=>doc.document_id));
});
it("does not silently select an arbitrary first sixty when all matching sources exceed the mode limit",async()=>{
  library.documents=Array.from({length:61},(_,i)=>doc(i+1,`Passport evidence ${i+1}.txt`));await ready();
  fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"DEEP_RESEARCH"}});
  const bulk=screen.getByRole("checkbox",{name:"Select matching documents"});expect(bulk).toBeDisabled();
  expect(bulk).toHaveAttribute("title",expect.stringContaining("60"));fireEvent.click(bulk);
  fireEvent.click(screen.getByRole("checkbox",{name:"Passport evidence 1.txt"}));expect(bulk).toBeDisabled();
  expect((await save()).private_source_ids).toEqual([library.documents[0].document_id]);
});
it("preserves sixty existing selections after a lower-limit mode change and permits explicit clearing",async()=>{
  library.documents=Array.from({length:60},(_,i)=>doc(i+1,`Passport evidence ${i+1}.txt`));await ready();
  fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"DEEP_RESEARCH"}});const bulk=screen.getByRole("checkbox",{name:"Select matching documents"});fireEvent.click(bulk);
  fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"QUICK_LOOKUP"}});expect(bulk).toBeChecked();expect(bulk).toBeEnabled();
  expect(screen.getByText(`60 selected / ${modeLimits.QUICK_LOOKUP.max_sources} limit`)).toBeVisible();
  fireEvent.click(bulk);expect((await save()).private_source_ids).toEqual([]);
});
it("permits explicit clearing of partial matches even when selecting the whole result would exceed the cap",async()=>{
  library.documents=Array.from({length:61},(_,i)=>doc(i+1,`Passport evidence ${i+1}.txt`));await ready();
  fireEvent.change(screen.getByLabelText("Mode"),{target:{value:"DEEP_RESEARCH"}});fireEvent.click(screen.getByRole("checkbox",{name:"Passport evidence 1.txt"}));
  expect(screen.getByRole("checkbox",{name:"Select matching documents"})).toBeDisabled();
  const clear=screen.getByRole("button",{name:"Clear matching selection"});expect(clear).toBeEnabled();fireEvent.click(clear);
  expect(screen.getByRole("checkbox",{name:"Passport evidence 1.txt"})).not.toBeChecked();expect((await save()).private_source_ids).toEqual([]);
});
it("retains unavailable copied references when clearing matching ready sources",async()=>{
  const stored={...record,plan:{...record.plan,private_source_ids:["unavailable-document",library.documents[1].document_id]}};
  api.listResearchPlans.mockResolvedValue({items:[stored],next_after:null});api.readResearchPlan.mockResolvedValue(stored);await ready();
  fireEvent.click(screen.getByRole("button",{name:`Open research plan: ${record.plan.question}`}));await screen.findByRole("button",{name:"Copy to a new plan"});
  fireEvent.click(screen.getByRole("button",{name:"Copy to a new plan"}));fireEvent.change(screen.getByRole("searchbox",{name:"Find private documents"}),{target:{value:"Match alpha"}});
  fireEvent.click(screen.getByRole("checkbox",{name:"Select matching documents"}));expect(screen.getByRole("checkbox",{name:"unavailable-document (not currently available)"})).toBeChecked();
  expect((await save()).private_source_ids).toEqual(["unavailable-document"]);
});
it.each(["viewer","loading","error","no matches"])("does not bulk-mutate ordinary %s state",async state=>{
  if(state==="viewer")api.getCurrentWorkspace.mockResolvedValue({role:"viewer"});
  if(state==="loading")library.loading=true;if(state==="error")library.error="Document loading failed";
  await ready();if(state==="no matches")fireEvent.change(screen.getByRole("searchbox",{name:"Find private documents"}),{target:{value:"Nothing matches"}});
  const bulk=screen.getByRole("checkbox",{name:"Select matching documents"});expect(bulk).toBeDisabled();fireEvent.click(bulk);expect(api.createResearchPlan).not.toHaveBeenCalled();
});
it("prevents implicit submission only for Enter in document search",async()=>{
  await ready();const search=screen.getByRole("searchbox",{name:"Find private documents"});
  fireEvent.change(search,{target:{value:"Match"}});
  const enter=new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true});fireEvent(search,enter);expect(enter.defaultPrevented).toBe(true);
  const escape=new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true});fireEvent(search,escape);expect(escape.defaultPrevented).toBe(false);
  expect(search).toHaveValue("Match");expect(api.createResearchPlan).not.toHaveBeenCalled();
});
it.each(["Question","Completion criteria"])("does not re-read unchanged document labels while editing %s",async field=>{
  const reads=Array.from({length:300},(_,i)=>vi.fn(()=>`Library source ${i+1}.txt`));
  library.documents=reads.map((read,i)=>({...doc(i+1,`Library source ${i+1}.txt`),get filename(){return read();}}));
  await ready();reads.forEach(read=>read.mockClear());
  fireEvent.change(screen.getByLabelText(field),{target:{value:"A revised research question or criterion"}});
  expect(reads.reduce((total,read)=>total+read.mock.calls.length,0)).toBe(0);
});
it.each(["","Library source"])("does not re-read other document labels when one selected checkbox changes in %s search",async query=>{
  const reads=Array.from({length:300},(_,i)=>vi.fn(()=>`Library source ${i+1}.txt`));
  library.documents=reads.map((read,i)=>({...doc(i+1,`Library source ${i+1}.txt`),get filename(){return read();}}));
  await ready();if(query)fireEvent.change(screen.getByRole("searchbox",{name:"Find private documents"}),{target:{value:query}});reads.forEach(read=>read.mockClear());
  fireEvent.click(screen.getByRole("checkbox",{name:"Library source 150.txt"}));
  expect(screen.getByRole("checkbox",{name:"Library source 150.txt"})).toBeChecked();
  expect(reads[149]).toHaveBeenCalled();
  expect(reads.filter((_,i)=>i!==149).reduce((total,read)=>total+read.mock.calls.length,0)).toBe(0);
});
it("accepts updated library names and availability without losing the selected reference",async()=>{
  await ready();fireEvent.click(screen.getByRole("checkbox",{name:"Keep selected.txt"}));
  library.documents=[{...library.documents[0],filename:"Updated original.txt"},...library.documents.slice(1)];
  fireEvent.change(screen.getByLabelText("Question"),{target:{value:"Inspect updated library"}});
  expect(screen.getByRole("checkbox",{name:"Updated original.txt"})).toBeChecked();
  expect(screen.queryByRole("checkbox",{name:"Keep selected.txt"})).not.toBeInTheDocument();
  const id=library.documents[0].document_id;
  library.documents=[{...library.documents[0],status:"processing"},...library.documents.slice(1)];
  fireEvent.change(screen.getByLabelText("Question"),{target:{value:"Inspect changed availability"}});
  expect(screen.getByRole("checkbox",{name:`${id} (not currently available)`})).toBeChecked();
  expect(screen.queryByRole("checkbox",{name:"Updated original.txt"})).not.toBeInTheDocument();
});
