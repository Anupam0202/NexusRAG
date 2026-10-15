import {fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({createResearchQuantity:vi.fn(),listResearchQuantities:vi.fn(),getDocumentChunks:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {SourceQuantities,SourceQuantitySelect} from "./SourceQuantities";
import {input,record,sourceText} from "@/test/fixtures/research-quantity";
const props={planId:"plan-a",workspaceId:"workspace-a",userId:"user-a",canWrite:true,privateSourceIds:[input.document_id],onRecords:vi.fn(),
  documents:[{document_id:input.document_id,filename:"quantity.txt",status:"ready" as const,file_type:"txt",file_size_bytes:40,page_count:2,chunk_count:1,created_at:"",processing_time_seconds:0,extraction_method:"text",extra:{}}]};
beforeEach(()=>{vi.clearAllMocks();api.listResearchQuantities.mockResolvedValue({items:[],next_after:null});api.createResearchQuantity.mockResolvedValue(record);
  api.getDocumentChunks.mockResolvedValue({document_id:input.document_id,version_id:input.version_id,authority:"SUPABASE_HASH_VERIFIED",coverage:{state:"COMPLETE_BOUNDED_DOCUMENT"},
    chunks:[{chunk_index:0,content:sourceText,page_number:2,metadata:{},original_content_hash:input.original_content_hash}],next_after:null});});
async function choose(){
  await waitFor(()=>expect(screen.getByLabelText("Quantity source document")).toBeEnabled());fireEvent.change(screen.getByLabelText("Quantity source document"),{target:{value:input.document_id}});
  await screen.findByRole("option",{name:"Chunk 1 - page 2"});fireEvent.change(screen.getByLabelText("Quantity source chunk"),{target:{value:"0"}});
  fireEvent.change(screen.getByLabelText("Quantity numeric selection"),{target:{value:"8:13"}});fireEvent.change(screen.getByLabelText("Quantity unit text"),{target:{value:"kg"}});
  fireEvent.change(screen.getByLabelText("Quantity unit selection"),{target:{value:"14:16"}});
}
it("captures actual selected source spans and inspects the durable numeric and unit contexts",async()=>{
  render(<SourceQuantities {...props}/>);await choose();fireEvent.click(screen.getByRole("button",{name:"Capture source quantity"}));
  expect(await screen.findByLabelText("Captured quantity")).toHaveTextContent("1.005 kg");expect(api.createResearchQuantity.mock.calls[0][1]).toEqual(input);
  expect(screen.getByRole("heading",{name:"Stored source quantities"})).toHaveFocus();expect(screen.getByLabelText("Captured unit context")).toHaveTextContent("kg");
  expect(props.onRecords).toHaveBeenLastCalledWith([record]);
});
it("keeps selection and retry key after an unconfirmed capture response",async()=>{
  api.createResearchQuantity.mockRejectedValueOnce(new Error("Capture unconfirmed"));render(<SourceQuantities {...props}/>);await choose();
  fireEvent.click(screen.getByRole("button",{name:"Capture source quantity"}));expect(await screen.findByRole("alert")).toHaveTextContent("unconfirmed");
  expect(screen.getByLabelText("Quantity numeric selection")).toHaveValue("8:13");fireEvent.click(screen.getByRole("button",{name:"Capture source quantity"}));await screen.findByLabelText("Captured quantity");
  expect(api.createResearchQuantity.mock.calls[0][2]).toBe(api.createResearchQuantity.mock.calls[1][2]);
});
it("lists unavailable source honestly and prevents ordinary read-only capture",async()=>{
  api.listResearchQuantities.mockResolvedValue({items:[{...record,source_state:"SOURCE_UNAVAILABLE",freshness:"unavailable",quantity:null,source:null}],next_after:null});
  render(<SourceQuantities {...props} canWrite={false}/>);await screen.findByText("Captured source unavailable. Numeric input withheld.");expect(screen.getByLabelText("Quantity source document")).toBeDisabled();expect(api.createResearchQuantity).not.toHaveBeenCalled();
});
it("copies only current source captures without executing a calculation",()=>{
  const select=vi.fn();render(<SourceQuantitySelect records={[record,{...record,id:"stale",freshness:"stale"}]} label="Captured input" disabled={false} onSelect={select}/>);
  expect(screen.getAllByRole("option")).toHaveLength(2);fireEvent.change(screen.getByLabelText("Captured input"),{target:{value:record.id}});expect(select).toHaveBeenCalledWith(record.quantity);
});
it("refreshes source text and clears the old numeric selection without discarding stored captures",async()=>{
  api.listResearchQuantities.mockResolvedValue({items:[record],next_after:null});render(<SourceQuantities {...props}/>);await choose();
  expect(screen.getByRole("button",{name:"Capture source quantity"})).toBeEnabled();
  fireEvent.click(screen.getByRole("button",{name:"Refresh quantity source text"}));
  await waitFor(()=>expect(api.getDocumentChunks).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByLabelText("Quantity source chunk")).toBeEnabled());
  expect(screen.queryByLabelText("Quantity numeric selection")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Captured quantity",{exact:true})).toHaveTextContent("1.005 kg");expect(api.createResearchQuantity).not.toHaveBeenCalled();
});
it("loads the next stored-capture page without losing previous records",async()=>{
  const second={...record,id:"88888888-8888-4888-8888-888888888888"};
  api.listResearchQuantities.mockResolvedValueOnce({items:[record],next_after:record.id}).mockResolvedValueOnce({items:[second],next_after:null});
  render(<SourceQuantities {...props}/>);fireEvent.click(await screen.findByRole("button",{name:"Load more captures"}));
  await waitFor(()=>expect(screen.getAllByLabelText("Captured quantity",{exact:true})).toHaveLength(2));
  expect(api.listResearchQuantities).toHaveBeenLastCalledWith(props.planId,{workspaceId:props.workspaceId,expectedUserId:props.userId},record.id);
  expect(props.onRecords).toHaveBeenLastCalledWith([record,second]);expect(screen.queryByRole("button",{name:"Load more captures"})).not.toBeInTheDocument();
});
