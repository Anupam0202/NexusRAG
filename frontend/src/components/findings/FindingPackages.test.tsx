import {act,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({createFindingPackage:vi.fn(),listFindingPackages:vi.fn(),readFindingExportRights:vi.fn(),readFindingPackage:vi.fn(),recordFindingExportRights:vi.fn()}));
vi.mock("@/lib/api",()=>api);
import {FindingPackages} from "./FindingPackages";
import type {FindingDetail} from "@/lib/api";
const id="33333333-3333-4333-8333-333333333333",version="44444444-4444-4444-8444-444444444444",ws="11111111-1111-4111-8111-111111111111";
const finding={id,workspace_id:ws,revision:3,author_id:"author",source_unavailable:false,reviews:[{decision:"approved",reviewer_id:"reviewer",revision:3}]} as FindingDetail;
const rights={schema_version:"finding-export-rights/1",finding_id:id,revision:3,can_review:true,eligible:false,items:[{version_id:version,document_id:ws,filename:"Owned source.txt",
  original_hash:"a".repeat(64),review_id:null,policy:null,allowed:false}],reason:"RIGHTS_REVIEW_REQUIRED"};
describe("source-linked package controls",()=>{
  beforeEach(()=>{Object.values(api).forEach(mock=>mock.mockReset());api.readFindingExportRights.mockResolvedValue(rights);api.listFindingPackages.mockResolvedValue({items:[],next_after:null});});
  function open(){return render(<FindingPackages finding={finding} context={{workspaceId:ws,expectedUserId:"author"}} canExport parentBusy={false}/>);}
  it("keeps export disabled until actual rights readback and exact-revision approval",async()=>{
    open();expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    expect(await screen.findByText("Source-version rights are unknown, denied, expired or revoked.")).toBeVisible();
    expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeDisabled();
    expect(api.readFindingExportRights).toHaveBeenCalledWith(id,{workspaceId:ws,expectedUserId:"author"});
  });
  it("uses exact selected version/review and a stable intent after interrupted save",async()=>{
    api.recordFindingExportRights.mockRejectedValueOnce(new Error("Saved review not confirmed")).mockResolvedValueOnce({...rights,eligible:true});
    open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));await screen.findByText("Owned source.txt");
    fireEvent.click(screen.getByRole("checkbox",{name:"Owned source.txt"}));
    fireEvent.change(screen.getByLabelText("Review rationale"),{target:{value:"Rights remain unknown."}});
    fireEvent.submit(screen.getByRole("form",{name:"Version export rights review"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    fireEvent.submit(screen.getByRole("form",{name:"Version export rights review"}));
    await waitFor(()=>expect(api.recordFindingExportRights).toHaveBeenCalledTimes(2));
    expect(api.recordFindingExportRights.mock.calls[0][2]).toBe(api.recordFindingExportRights.mock.calls[1][2]);
    expect(api.recordFindingExportRights.mock.calls[0][1]).toMatchObject({revision:3,selections:[{version_id:version,expected_review_id:null}],policy:{decision:"REVIEW_REQUIRED",basis:"UNKNOWN"}});
    await screen.findByText("Export rights review saved for the selected source versions.");
  });
  it("does not show late private results after unmount",async()=>{
    let finish!:(value:unknown)=>void;api.readFindingExportRights.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const rendered=open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));rendered.unmount();
    await act(async()=>finish(rights));expect(screen.queryByText("Owned source.txt")).not.toBeInTheDocument();
  });
});
