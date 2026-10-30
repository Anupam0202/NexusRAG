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
const allowedRights={...rights,eligible:true,reason:"ALLOW",items:[{...rights.items[0],review_id:ws,allowed:true,
  policy:{decision:"ALLOW",basis:"OWNED_CONTENT",rationale:"Synthetic fixture ownership.",evidence_reference:"urn:fixture:ownership",attribution:"Synthetic author",duties:[],review_by:"2027-01-01T12:00:00Z"}}]};
const saved={id:version,finding_revision:3,state:"expired",reason:"SOURCE_UNAVAILABLE",manifest_hash:"b".repeat(64)};
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
  it("keeps saved package receipts inspectable when removed sources prevent rights loading",async()=>{
    api.readFindingExportRights.mockRejectedValue(new Error("Original evidence changed or is unavailable. No package is confirmed."));
    api.listFindingPackages.mockResolvedValue({items:[saved],next_after:null});
    open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    expect(await screen.findByText("Revision 3 · expired · SOURCE_UNAVAILABLE")).toBeVisible();
    expect(screen.getByText(`SHA256 ${saved.manifest_hash}`)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Original evidence changed or is unavailable.");
    expect(screen.getByRole("button",{name:"Download revision 3 package"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeDisabled();
    expect(screen.queryByRole("form",{name:"Version export rights review"})).not.toBeInTheDocument();
  });
  it("clears earlier rights when a later refresh cannot confirm them while preserving returned receipts",async()=>{
    api.readFindingExportRights.mockResolvedValueOnce(allowedRights)
      .mockRejectedValueOnce(new Error("Export rights are unavailable. Refresh before retrying."));
    api.listFindingPackages.mockResolvedValueOnce({items:[],next_after:null}).mockResolvedValueOnce({items:[saved],next_after:null});
    open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    await waitFor(()=>expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox",{name:"Owned source.txt"}));
    fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Export rights are unavailable.");
    expect(screen.getByText("Revision 3 · expired · SOURCE_UNAVAILABLE")).toBeVisible();
    expect(screen.getByRole("button",{name:"Export JSON-LD & receipt"})).toBeDisabled();
    expect(screen.queryByRole("checkbox",{name:"Owned source.txt"})).not.toBeInTheDocument();
  });
  it("retains confirmed rights and reports a separate package-list failure without stale list entries",async()=>{
    api.listFindingPackages.mockResolvedValueOnce({items:[saved],next_after:version})
      .mockRejectedValueOnce(new Error("Saved package history is unavailable."));
    open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    expect(await screen.findByText("Revision 3 · expired · SOURCE_UNAVAILABLE")).toBeVisible();
    fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved package history is unavailable.");
    expect(screen.getByRole("checkbox",{name:"Owned source.txt"})).toBeVisible();
    expect(screen.queryByRole("list",{name:"Saved evidence packages"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Load more packages"})).not.toBeInTheDocument();
  });
  it("does not show late private results after unmount",async()=>{
    let finish!:(value:unknown)=>void;api.readFindingExportRights.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const rendered=open();fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));rendered.unmount();
    await act(async()=>finish(rights));expect(screen.queryByText("Owned source.txt")).not.toBeInTheDocument();
  });
  it.each(["Finding","workspace"])("ignores late package history and errors after the %s changes",async target=>{
    let finish!:(value:unknown)=>void;
    const nextFinding=target==="Finding"?{...finding,id:ws}:finding,nextWorkspace=target==="workspace"?version:ws;
    api.listFindingPackages.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}))
      .mockResolvedValueOnce({items:[],next_after:null});
    api.readFindingExportRights.mockRejectedValueOnce(new Error("Earlier Finding sources are unavailable."))
      .mockResolvedValueOnce({...rights,finding_id:nextFinding.id});
    const rendered=render(<FindingPackages key={`${id}:${ws}`} finding={finding} context={{workspaceId:ws}} canExport parentBusy={false}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    rendered.rerender(<FindingPackages key={`${nextFinding.id}:${nextWorkspace}`} finding={nextFinding} context={{workspaceId:nextWorkspace}} canExport parentBusy={false}/>);
    fireEvent.click(screen.getByRole("button",{name:"Load export rights & packages"}));
    await screen.findByRole("checkbox",{name:"Owned source.txt"});
    await act(async()=>finish({items:[saved],next_after:version}));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("list",{name:"Saved evidence packages"})).not.toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Load more packages"})).not.toBeInTheDocument();
  });
});
