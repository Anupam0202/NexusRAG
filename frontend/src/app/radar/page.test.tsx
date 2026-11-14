import {act,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({captureRadarSnapshot:vi.fn(),createRadarFinding:vi.fn(),createRadarSource:vi.fn(),getCurrentWorkspace:vi.fn(),
  listRadarProviders:vi.fn(),listRadarReviews:vi.fn(),listRadarRuns:vi.fn(),listRadarSources:vi.fn(),readRadarChange:vi.fn(),readRadarChunks:vi.fn(),readRadarSource:vi.fn(),reviewRadarChange:vi.fn()}));
vi.mock("@/lib/api",()=>api);
vi.mock("@/hooks/useDocuments",()=>({useDocuments:()=>({documents:[{document_id:"77777777-7777-4777-8777-777777777777",filename:"Synthetic after.txt",status:"ready"}],loading:false,error:null})}));
import {useStore} from "@/hooks/useStore";
import {radarApproved,radarCapture,radarChange,radarChunks,radarIds as ids,radarProvider,radarSource,radarSourceDetail,radarTime} from "@/test/fixtures/radar";
import RadarPage from "./page";

describe("Supplied Radar workspace",()=>{
  beforeEach(()=>{
    Object.values(api).forEach(mock=>mock.mockReset());
    window.history.replaceState({},"","/radar");
    useStore.setState({authMode:"authenticated",authUser:{id:ids.user,email:null},workspaceId:ids.workspace});
    api.listRadarSources.mockResolvedValue({schema_version:"radar-source-list/1",items:[radarSource],next_after:null});
    api.listRadarProviders.mockResolvedValue({schema_version:"radar-providers/1",items:[radarProvider],next_after:null});
    api.getCurrentWorkspace.mockImplementation(async context=>({workspace_id:context.workspaceId,user_id:context.expectedUserId,role:"owner"}));
    api.readRadarSource.mockResolvedValue(radarSourceDetail);
    api.readRadarChange.mockResolvedValue(radarChange);
    api.readRadarChunks.mockResolvedValue(radarChunks);
  });
  async function open(){fireEvent.click(await screen.findByRole("button",{name:/Synthetic quota source/}));await screen.findByRole("region",{name:"Stored Radar source"});}
  async function selectAfter(){
    fireEvent.change(screen.getByLabelText("Retained document"),{target:{value:ids.afterDoc}});
    const original=await screen.findByText("Original 0 · 36 UTF-8 bytes");fireEvent.click(original.closest("label")!.querySelector("input")!);
    fireEvent.change(screen.getByLabelText("Permission for supplied evidence"),{target:{value:"Permitted retained copy"}});
  }
  it("does not request workspace data while signed out or without a selected workspace",()=>{
    useStore.setState({authMode:"signed_out",authUser:null,workspaceId:null});const view=render(<RadarPage/>);
    expect(screen.getByRole("heading",{name:"Sign in to your terms and quota workspace"})).toBeVisible();
    expect(api.listRadarSources).not.toHaveBeenCalled();
    act(()=>useStore.setState({authMode:"authenticated",authUser:{id:ids.user,email:null},workspaceId:null}));
    expect(screen.getByRole("status")).toHaveTextContent("Choose a workspace");view.unmount();
  });
  it("preserves inspectable source history when provider discovery or edit authority fails",async()=>{
    api.listRadarProviders.mockRejectedValue(new Error("Provider listing unavailable"));api.getCurrentWorkspace.mockRejectedValue(new Error("Edit authority unavailable"));
    render(<RadarPage/>);expect(await screen.findByRole("alert")).toHaveTextContent("Edit authority unavailable");await open();
    expect(screen.getByRole("button",{name:"Save selected snapshot"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Inspect snapshot revision 2"})).toBeEnabled();
    expect(screen.getByText(/Manual monitor · Automatic retrieval disabled/)).toBeVisible();
  });
  it("does not grant editing from an authority response for another account or workspace",async()=>{
    api.getCurrentWorkspace.mockResolvedValue({workspace_id:ids.afterDoc,user_id:ids.reviewer,role:"owner"});
    render(<RadarPage/>);expect(await screen.findByRole("alert")).toHaveTextContent("Edit authority could not be verified");
    expect(screen.getByRole("button",{name:"New source"})).toBeDisabled();await open();
    expect(screen.getByRole("button",{name:"Save selected snapshot"})).toBeDisabled();
  });
  it("saves a declared source with its stable intent after an ambiguous failure",async()=>{
    api.createRadarSource.mockRejectedValueOnce(new Error("Source response lost")).mockResolvedValueOnce(radarSource);
    render(<RadarPage/>);await waitFor(()=>expect(screen.getByLabelText("Provider")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Provider"),{target:{value:radarProvider.id}});
    fireEvent.change(screen.getByLabelText("Source title"),{target:{value:radarSource.title}});
    fireEvent.change(screen.getByLabelText("Declared source URL"),{target:{value:radarSource.source_url}});
    fireEvent.click(screen.getByRole("button",{name:"Save source"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Source response lost");
    expect(screen.queryByText(/Source and manual monitor saved/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Save source"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Source and manual monitor saved");
    expect(api.createRadarSource.mock.calls[0][1]).toBe(api.createRadarSource.mock.calls[1][1]);
    expect(api.createRadarSource.mock.calls[1][2]).toEqual({workspaceId:ids.workspace,expectedUserId:ids.user});
  });
  it("retries the exact selected capture after a lost response and confirms only persisted results",async()=>{
    const beforeDetail={...radarSourceDetail,source:{...radarSource,revision:1,latest_snapshot_id:ids.beforeSnapshot},latest_snapshot:radarChange.before,
      snapshots:{items:[radarChange.before!],next_after:null}};
    api.readRadarSource.mockResolvedValueOnce(beforeDetail).mockResolvedValue(radarSourceDetail);
    api.captureRadarSnapshot.mockRejectedValueOnce(new Error("Commit response lost")).mockResolvedValueOnce(radarCapture);
    render(<RadarPage/>);await open();await selectAfter();
    fireEvent.click(screen.getByRole("button",{name:"Save selected snapshot"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Commit response lost");
    expect(screen.queryByText(/Snapshot revision 2 saved/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Save selected snapshot"}));
    expect(await screen.findByRole("status")).toHaveTextContent("Snapshot revision 2 saved");
    const [first,second]=api.captureRadarSnapshot.mock.calls;expect(first.slice(0,3)).toEqual(second.slice(0,3));
    expect(second[1]).toMatchObject({expected_revision:1,document_id:ids.afterDoc,version_id:ids.afterVersion,chunk_ids:[ids.afterChunk],before_chunk_ids:[ids.beforeChunk]});
    const pair=screen.getByRole("region",{name:"Selected Radar change"});
    expect(within(pair).getByText("Daily quota: 100 requests per account.")).toBeVisible();
    expect(within(pair).getByText("Daily quota: 10 requests per account.")).toBeVisible();
    expect(screen.getByRole("button",{name:"Save exact-pair review"})).toBeDisabled();
    expect(screen.getByText(/Comparisons cover selected originals, not an entire file/)).toBeVisible();
  });
  it("keeps the capture intent if post-commit history reload fails",async()=>{
    api.captureRadarSnapshot.mockResolvedValue(radarCapture);
    api.readRadarSource.mockResolvedValueOnce({...radarSourceDetail,source:{...radarSource,revision:1},latest_snapshot:radarChange.before})
      .mockRejectedValueOnce(new Error("History temporarily unavailable")).mockResolvedValue(radarSourceDetail);
    render(<RadarPage/>);await open();await selectAfter();fireEvent.click(screen.getByRole("button",{name:"Save selected snapshot"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("History temporarily unavailable");
    fireEvent.click(screen.getByRole("button",{name:"Save selected snapshot"}));await screen.findByRole("region",{name:"Selected Radar change"});
    expect(api.captureRadarSnapshot.mock.calls[0][2]).toBe(api.captureRadarSnapshot.mock.calls[1][2]);
  });
  it("reloads an exact pair deep link and saves an independent review before opening a real Finding",async()=>{
    useStore.setState({authUser:{id:ids.reviewer,email:null}});
    window.history.replaceState({},"",`/radar?source=${ids.source}&change=${ids.change}`);
    api.reviewRadarChange.mockRejectedValueOnce(new Error("Review response lost")).mockResolvedValueOnce(radarApproved);
    api.createRadarFinding.mockResolvedValue({id:ids.finding});
    render(<RadarPage/>);await screen.findByRole("region",{name:"Selected Radar change"});
    fireEvent.change(screen.getByLabelText("Review comment"),{target:{value:"Reviewed exact quota pair"}});
    fireEvent.change(screen.getByLabelText("Affected workflows (one per line)"),{target:{value:"Trial admission\nQuota accounting"}});
    fireEvent.click(screen.getByRole("button",{name:"Save exact-pair review"}));expect(await screen.findByRole("alert")).toHaveTextContent("Review response lost");
    fireEvent.click(screen.getByRole("button",{name:"Save exact-pair review"}));expect(await screen.findByRole("status")).toHaveTextContent("Review saved for this exact snapshot pair");
    expect(api.reviewRadarChange.mock.calls[0][2]).toBe(api.reviewRadarChange.mock.calls[1][2]);
    expect(api.reviewRadarChange.mock.calls[1][1]).toEqual({expected_review_revision:0,decision:"approved",comment:"Reviewed exact quota pair",affected_workflows:["Trial admission","Quota accounting"]});
    fireEvent.change(screen.getByLabelText("Finding title"),{target:{value:"Quota follow-up"}});
    fireEvent.change(screen.getByLabelText("Finding qualifications"),{target:{value:"Selected excerpts; independent operational follow-up required."}});
    fireEvent.click(screen.getByRole("button",{name:"Create reviewed-change Finding"}));
    expect(await screen.findByRole("link",{name:"Open source-linked Finding"})).toHaveAttribute("href",`/findings?finding=${ids.finding}`);
    expect(api.createRadarFinding.mock.calls[0][1]).toMatchObject({title:"Quota follow-up",expected_review_revision:1});
  });
  it("keeps history metadata when evidence is withdrawn and disables new actions",async()=>{
    useStore.setState({authUser:{id:ids.reviewer,email:null}});
    api.readRadarChange.mockResolvedValue({...radarApproved,source_available:false,before_text_preview:null,after_text_preview:null});
    window.history.replaceState({},"",`/radar?source=${ids.source}&change=${ids.change}`);render(<RadarPage/>);
    const region=await screen.findByRole("region",{name:"Selected Radar change"});
    expect(within(region).getByRole("status")).toHaveTextContent("Source evidence is unavailable");
    expect(within(region).getAllByText("Content withheld")).toHaveLength(2);
    expect(within(region).getByRole("button",{name:"Save exact-pair review"})).toBeDisabled();
    expect(within(region).getByRole("button",{name:"Create reviewed-change Finding"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Inspect snapshot revision 1"})).toBeEnabled();
  });
  it("pages providers and history without discarding already loaded rows",async()=>{
    api.listRadarProviders.mockResolvedValueOnce({items:[radarProvider],next_after:"synthetic-provider"}).mockResolvedValueOnce({items:[{...radarProvider,id:"later-provider",display_name:"Later Provider"}],next_after:null});
    api.readRadarSource.mockResolvedValueOnce({...radarSourceDetail,snapshots:{items:[radarChange.after],next_after:ids.afterSnapshot}})
      .mockResolvedValueOnce({...radarSourceDetail,snapshots:{items:[radarChange.before],next_after:null}});
    render(<RadarPage/>);fireEvent.click(await screen.findByRole("button",{name:"Load more providers"}));
    expect(await screen.findByRole("option",{name:/Later Provider/})).toBeVisible();await open();
    fireEvent.click(screen.getByRole("button",{name:"Load more snapshots"}));
    await screen.findByRole("button",{name:"Inspect snapshot revision 1"});expect(screen.getByRole("button",{name:"Inspect snapshot revision 2"})).toBeVisible();
    expect(api.readRadarSource).toHaveBeenLastCalledWith(ids.source,{workspaceId:ids.workspace,expectedUserId:ids.user},ids.afterSnapshot);
  });
  it("does not expose a late response after the account and workspace change",async()=>{
    let finish!:(value:unknown)=>void;api.readRadarSource.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<RadarPage/>);fireEvent.click(await screen.findByRole("button",{name:/Synthetic quota source/}));
    api.listRadarSources.mockResolvedValue({items:[],next_after:null});api.listRadarProviders.mockResolvedValue({items:[],next_after:null});
    act(()=>useStore.setState({authUser:{id:ids.reviewer,email:null},workspaceId:ids.afterDoc}));
    await act(async()=>finish(radarSourceDetail));
    await waitFor(()=>expect(screen.queryByRole("region",{name:"Stored Radar source"})).not.toBeInTheDocument());
    expect(screen.queryByText(radarSource.title)).not.toBeInTheDocument();
  });
  it("blocks an all-156 before selection until an explicit smaller subset frees comparison capacity",async()=>{
    const originals=Array.from({length:156},(_,index)=>({...radarChange.before!.selected_originals[0],id:`${index.toString(16).padStart(8,"0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,chunk_index:index}));
    api.readRadarSource.mockResolvedValue({...radarSourceDetail,latest_snapshot:{...radarChange.before!,selected_originals:originals,chunk_ids:originals.map(row=>row.id),stored_chunk_count:156}});
    render(<RadarPage/>);await open();fireEvent.change(screen.getByLabelText("Retained document"),{target:{value:ids.afterDoc}});
    const after=await screen.findByText("Original 0 · 36 UTF-8 bytes");const checkbox=after.closest("label")!.querySelector("input")!;
    expect(checkbox).toBeDisabled();
    const beforeGroup=screen.getByRole("group",{name:/Before evidence from snapshot revision/});fireEvent.click(within(beforeGroup).getAllByRole("checkbox")[0]);
    expect(checkbox).toBeEnabled();fireEvent.click(checkbox);expect(screen.getByText(/156 unique originals across both sides/)).toBeVisible();
    expect(within(beforeGroup).getAllByRole("checkbox",{checked:true})).toHaveLength(155);
  });
  it("keeps later review history distinct from the exact pair review revision",async()=>{
    window.history.replaceState({},"",`/radar?source=${ids.source}&change=${ids.change}`);
    api.readRadarChange.mockResolvedValue({...radarApproved,review_count:21,reviews_next_after:1});
    api.listRadarReviews.mockResolvedValue({items:[{id:ids.beforeDoc,reviewer_id:ids.reviewer,decision:"changes_requested",comment:"Later historical receipt",created_at:radarTime,revision:21}],next_after:null,review_count:21});
    render(<RadarPage/>);fireEvent.click(await screen.findByRole("button",{name:"Load more review history"}));
    expect(await screen.findByText("Later historical receipt")).toBeVisible();expect(screen.getByText("Reviewed quota pair")).toBeVisible();
    expect(api.listRadarReviews).toHaveBeenCalledWith(ids.change,{workspaceId:ids.workspace,expectedUserId:ids.user},1);
  });
  it.each(["BASELINE","UNCHANGED"])("does not offer exact-pair review for %s records",async status=>{
    useStore.setState({authUser:{id:ids.reviewer,email:null}});
    api.readRadarChange.mockResolvedValue({...radarChange,status});window.history.replaceState({},"",`/radar?source=${ids.source}&change=${ids.change}`);
    render(<RadarPage/>);await screen.findByRole("region",{name:"Selected Radar change"});
    expect(screen.getByRole("button",{name:"Save exact-pair review"})).toBeDisabled();
  });
  it("requires a reviewer independent from both before and after capturers",async()=>{
    useStore.setState({authUser:{id:ids.reviewer,email:null}});
    api.readRadarChange.mockResolvedValue({...radarChange,before:{...radarChange.before!,actor_id:ids.reviewer}});
    window.history.replaceState({},"",`/radar?source=${ids.source}&change=${ids.change}`);render(<RadarPage/>);
    await screen.findByRole("region",{name:"Selected Radar change"});expect(screen.getByRole("button",{name:"Save exact-pair review"})).toBeDisabled();
  });
  it("shows durable failures, their reason and later run pages without replacing confirmed snapshots",async()=>{
    const run={id:ids.change,workspace_id:ids.workspace,monitor_id:ids.monitor,status:"RIGHTS_BLOCKED",materiality:null,started_at:radarTime,completed_at:radarTime,
      previous_hash:null,current_hash:null,metadata:{source_mode:"SUPPLIED_DOCUMENT",reason_code:"RIGHTS_BLOCKED",last_confirmed_snapshot_id:ids.afterSnapshot}};
    api.readRadarSource.mockResolvedValue({...radarSourceDetail,runs:{schema_version:"radar-run-list/1",items:[run],next_after:ids.change}});
    api.listRadarRuns.mockResolvedValue({schema_version:"radar-run-list/1",items:[{...run,id:ids.baselineChange,status:"FAILED",metadata:{...run.metadata,reason_code:"SOURCE_UNAVAILABLE"}}],next_after:null});
    render(<RadarPage/>);await open();const history=screen.getByRole("region",{name:"Manual snapshot run history"});
    expect(within(history).getByText("Reason: RIGHTS BLOCKED")).toBeVisible();
    expect(within(history).getByText(`Last confirmed snapshot: ${ids.afterSnapshot}`)).toBeVisible();
    fireEvent.click(within(history).getByRole("button",{name:"Load more manual runs"}));
    expect(await within(history).findByText("Reason: SOURCE UNAVAILABLE")).toBeVisible();
    expect(within(history).getByText("Reason: RIGHTS BLOCKED")).toBeVisible();
    expect(api.listRadarRuns).toHaveBeenCalledWith(ids.source,{workspaceId:ids.workspace,expectedUserId:ids.user},ids.change);
    expect(screen.getByRole("button",{name:"Inspect snapshot revision 2"})).toBeVisible();
  });
});
