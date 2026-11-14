import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({createResearchAggregation:vi.fn(),listResearchAggregations:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {AggregationWorksheet} from "./AggregationWorksheet";
const props={planId:"plan-a",workspaceId:"workspace-a",userId:"user-a",canWrite:true};
const input={operation:"SUM",values:[{value:"0.1",unit:"USD",evidence_ids:["a"]},{value:"0.2",unit:"USD",evidence_ids:["b"]}],weights:[],precision:2,missing_value_treatment:"REJECT",grouped:false};
const record={id:"saved-a",input,result:{operation:"SUM",groups:[{group:null,value:"0.30",rows:[],unit:"USD",expression:"sum(0.1,0.2)",evidence_ids:["a","b"],total_count:2,included_count:2,excluded_count:0,excluded_input_indices:[]}],precision:2,missing_value_treatment:"REJECT"}};
beforeEach(()=>{vi.clearAllMocks();api.listResearchAggregations.mockResolvedValue({items:[],next_after:null});api.createResearchAggregation.mockResolvedValue(record);});
async function fill(){
  await waitFor(()=>expect(screen.getByRole("button",{name:"Calculate and save series"})).toBeEnabled());
  for(const [name,value] of [["Series value 1","0.1"],["Series value 2","0.2"],["Series unit 1","USD"],["Series unit 2","USD"],["Series evidence references 1","a"],["Series evidence references 2","b"],["Series decimal places","2"]])fireEvent.change(screen.getByLabelText(name),{target:{value}});
}
it("saves the exact dataset, focuses results and copies inputs without executing again",async()=>{
  render(<AggregationWorksheet {...props}/>);await fill();fireEvent.click(screen.getByRole("button",{name:"Calculate and save series"}));
  expect(await screen.findByLabelText("Aggregate value")).toHaveTextContent("0.30 USD");expect(api.createResearchAggregation.mock.calls[0][1]).toEqual(input);
  expect(screen.getByRole("heading",{name:"Stored series results"})).toHaveFocus();expect(screen.getByText(/caller-supplied, not verified/)).toBeVisible();
  fireEvent.click(screen.getByRole("button",{name:"Use inputs"}));expect(screen.getByLabelText("Series value 1")).toHaveFocus();expect(api.createResearchAggregation).toHaveBeenCalledTimes(1);
});
it("preserves edited values and the exact retry key across an interrupted response",async()=>{
  api.createResearchAggregation.mockRejectedValueOnce(new Error("Response unconfirmed"));render(<AggregationWorksheet {...props}/>);await fill();
  fireEvent.click(screen.getByRole("button",{name:"Calculate and save series"}));expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  expect(screen.getByLabelText("Series value 1")).toHaveValue("0.1");expect(screen.queryByLabelText("Aggregate value")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"Calculate and save series"}));await screen.findByLabelText("Aggregate value");
  expect(api.createResearchAggregation.mock.calls[0][2]).toBe(api.createResearchAggregation.mock.calls[1][2]);expect(screen.getAllByLabelText("Aggregate value")).toHaveLength(1);
});
it("preserves weights, explicit missing data and groups in the submitted worksheet",async()=>{
  render(<AggregationWorksheet {...props}/>);await fill();fireEvent.change(screen.getByLabelText("Series operation"),{target:{value:"WEIGHTED_AVERAGE"}});
  fireEvent.change(screen.getByLabelText("Missing values"),{target:{value:"EXCLUDE"}});fireEvent.click(screen.getByLabelText("Group results"));
  for(const [name,value] of [["Series value 2",""],["Series weight 1","2"],["Series weight 2","0"],["Series group 1","A"],["Series group 2","A"]])fireEvent.change(screen.getByLabelText(name),{target:{value}});
  fireEvent.click(screen.getByRole("button",{name:"Calculate and save series"}));await screen.findByLabelText("Aggregate value");
  expect(api.createResearchAggregation.mock.calls[0][1]).toMatchObject({operation:"WEIGHTED_AVERAGE",weights:["2","0"],grouped:true,missing_value_treatment:"EXCLUDE",values:[{value:"0.1",group:"A"},{value:null,group:"A"}]});
});
it("restores saved results for a read-only role and pages without losing existing records",async()=>{
  api.listResearchAggregations.mockResolvedValueOnce({items:[record],next_after:"next-a"}).mockResolvedValueOnce({items:[{...record,id:"saved-b"}],next_after:null});
  render(<AggregationWorksheet {...props} canWrite={false}/>);await screen.findByRole("button",{name:"sum; 1 group"});
  expect(screen.getByRole("button",{name:"Calculate and save series"})).toBeDisabled();fireEvent.click(screen.getByRole("button",{name:"Load more series results"}));
  await waitFor(()=>expect(screen.getAllByRole("button",{name:"sum; 1 group"})).toHaveLength(2));expect(api.listResearchAggregations.mock.calls[1][2]).toBe("next-a");expect(api.createResearchAggregation).not.toHaveBeenCalled();
});
it("restores focus after adding/removing an input and inspects unrounded rank rows",async()=>{
  api.listResearchAggregations.mockResolvedValue({items:[{...record,result:{...record.result,operation:"RANK",groups:[{...record.result.groups[0],value:null,value_display:"INPUT_VALUES_UNROUNDED",rows:[{position:1,input_index:1,value:"0.2",unit:"USD"}]}]}}],next_after:null});
  render(<AggregationWorksheet {...props}/>);await fill();fireEvent.click(screen.getByRole("button",{name:"Add value"}));expect(screen.getByLabelText("Series value 3")).toHaveFocus();
  fireEvent.click(screen.getByRole("button",{name:"Remove value 3"}));expect(screen.getByLabelText("Series value 2")).toHaveFocus();
  fireEvent.click(screen.getByRole("button",{name:"rank; 1 group"}));expect(within(screen.getByRole("table")).getByText("1 / 2")).toBeVisible();
});
