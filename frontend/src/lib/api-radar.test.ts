import {afterEach,describe,expect,it,vi} from "vitest";
import {createHash,webcrypto} from "node:crypto";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {captureRadarSnapshot,createRadarFinding,createRadarSource,listRadarProviders,listRadarReviews,listRadarRuns,readRadarChange,readRadarChunks,readRadarSource,reviewRadarChange} from "./api";
import {confirmedRadarChangeDetail,confirmedRadarSnapshot} from "./radar";
import {afterOriginal,beforeOriginal,radarApproved,radarCapture,radarCaptureBody,radarChange,radarChunks,radarIds as ids,radarProvider,radarSource,radarSourceDetail} from "@/test/fixtures/radar";

const context={workspaceId:ids.workspace,expectedUserId:ids.reviewer};
afterEach(()=>vi.unstubAllGlobals());
function peer(value:unknown){const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(value)));vi.stubGlobal("fetch",fetch);return fetch;}
const unconfirmed={code:"PERSISTENCE_UNCONFIRMED"};

describe("Radar durable-response confirmation",()=>{
  it("keeps source identity, monitor restrictions and workspace authority in the response contract",async()=>{
    const body={provider_id:radarSource.provider_id,source_url:radarSource.source_url,title:radarSource.title,kind:radarSource.kind};
    const fetch=peer(radarSource);await expect(createRadarSource(body,"stable-source",context)).resolves.toEqual(radarSource);
    expect(fetch.mock.calls[0][1]).toMatchObject({method:"POST",headers:{"Idempotency-Key":"stable-source"}});
    peer({...radarSource,workspace_id:ids.beforeDoc});await expect(createRadarSource(body,"stable-source",context)).rejects.toMatchObject(unconfirmed);
  });
  it("pins the version when paging retained originals",async()=>{
    const fetch=peer(radarChunks);await expect(readRadarChunks(ids.afterDoc,context,ids.beforeChunk,ids.afterVersion)).resolves.toEqual(radarChunks);
    expect(fetch.mock.calls[0][0]).toContain(`after=${ids.beforeChunk}&version_id=${ids.afterVersion}`);
    peer({...radarChunks,version_id:ids.beforeVersion});await expect(readRadarChunks(ids.afterDoc,context,undefined,ids.afterVersion)).rejects.toMatchObject(unconfirmed);
  });
  it("accepts the independent latest snapshot even on older source-history pages",async()=>{
    peer({...radarSourceDetail,snapshots:{items:[radarChange.before],next_after:null}});
    await expect(readRadarSource(ids.source,context,ids.beforeSnapshot)).resolves.toMatchObject({latest_snapshot:{id:ids.afterSnapshot}});
    peer({...radarSourceDetail,latest_snapshot:radarChange.before});await expect(readRadarSource(ids.source,context)).rejects.toMatchObject(unconfirmed);
  });
  it("confirms a historical capture replay after later source revisions without creating another intent",async()=>{
    const result={...radarCapture,source:{...radarSource,revision:3,latest_snapshot_id:ids.beforeSnapshot}};
    const fetch=peer(result);await expect(captureRadarSnapshot(ids.source,radarCaptureBody,"lost-reply-intent",context)).resolves.toEqual(result);
    expect(fetch.mock.calls[0][1]).toMatchObject({headers:{"Idempotency-Key":"lost-reply-intent"},body:JSON.stringify(radarCaptureBody)});
  });
  it.each([
    {...radarCapture,snapshot:{...radarCapture.snapshot,revision:3}},
    {...radarCapture,snapshot:{...radarCapture.snapshot,version_id:ids.beforeVersion}},
    {...radarCapture,source:{...radarSource,revision:1}},
    {...radarCapture,change:{...radarChange,before_chunk_ids:[]}},
  ])("rejects a capture response that does not confirm the submitted pair",async result=>{
    peer(result);await expect(captureRadarSnapshot(ids.source,radarCaptureBody,"capture",context)).rejects.toMatchObject(unconfirmed);
  });
  it("confirms a late review replay from its exact immutable receipt rather than the current first history page",async()=>{
    const result={...radarApproved,review_revision:30,review_count:30,confirmed_review:radarApproved.reviews[0]};
    peer(result);await expect(reviewRadarChange(ids.change,{expected_review_revision:0,decision:"approved",comment:"Reviewed quota pair",affected_workflows:[]},"review-intent",context)).resolves.toEqual(result);
    peer({...result,confirmed_review:{...result.confirmed_review,comment:"Different review"}});
    await expect(reviewRadarChange(ids.change,{expected_review_revision:0,decision:"approved",comment:"Reviewed quota pair",affected_workflows:[]},"review-intent",context)).rejects.toMatchObject(unconfirmed);
  });
  it("does not call an arbitrary current review confirmation of the user's write",async()=>{
    const body={expected_review_revision:0,decision:"approved" as const,comment:"Reviewed quota pair",affected_workflows:[]};
    for(const confirmed_review of [undefined,{...radarApproved.reviews[0],reviewer_id:ids.user},{...radarApproved.reviews[0],revision:2},{...radarApproved.reviews[0],affected_workflows:["Different obligation"]}]){
      peer({...radarApproved,confirmed_review});await expect(reviewRadarChange(ids.change,body,"review-intent",context)).rejects.toMatchObject(unconfirmed);
    }
  });
  it("binds Finding confirmation to the exact saved note and actual Radar origin",async()=>{
    vi.stubGlobal("crypto",webcrypto);
    const body={title:"Quota finding",authored_markdown:"Exact qualifications 😀",expected_review_revision:1};
    const confirmed_creation={schema_version:"radar-finding-creation/1",workspace_id:ids.workspace,finding_id:ids.finding,change_id:ids.change,
      created_by:ids.reviewer,revision:1,expected_review_revision:1,title:body.title,authored_markdown_hash:createHash("sha256").update(body.authored_markdown).digest("hex"),authored_markdown_bytes:Buffer.byteLength(body.authored_markdown)};
    const result={id:ids.finding,workspace_id:ids.workspace,source_radar_change_id:ids.change,radar_origin:radarApproved,title:"Edited current Finding",authored_markdown:"Later revision note",confirmed_creation};
    peer(result);await expect(createRadarFinding(ids.change,body,"finding",context)).resolves.toEqual(result);
    for(const receipt of [undefined,{...confirmed_creation,title:"Unrelated original"},{...confirmed_creation,authored_markdown_hash:"f".repeat(64)},
      {...confirmed_creation,authored_markdown_bytes:1},{...confirmed_creation,expected_review_revision:2},{...confirmed_creation,created_by:ids.user}]){
      peer({...result,confirmed_creation:receipt});await expect(createRadarFinding(ids.change,body,"finding",context)).rejects.toMatchObject(unconfirmed);
    }
  });
  it("rejects a different change ID and unavailable-content projection",async()=>{
    peer({...radarChange,id:ids.baselineChange});await expect(readRadarChange(ids.change,context)).rejects.toMatchObject(unconfirmed);
    peer({...radarChange,source_available:false});await expect(readRadarChange(ids.change,context)).rejects.toMatchObject(unconfirmed);
    peer({...radarChange,source_available:false,before_text_preview:null,after_text_preview:null});
    await expect(readRadarChange(ids.change,context)).resolves.toMatchObject({source_available:false,selections:{before:[beforeOriginal],after:[afterOriginal]}});
  });
  it("uses bounded provider string cursors and review revision cursors",async()=>{
    let fetch=peer({schema_version:"radar-providers/1",items:[radarProvider],next_after:"synthetic-provider-2"});
    await listRadarProviders(context,"provider/id");expect(fetch.mock.calls[0][0]).toContain("limit=20&after=provider%2Fid");
    fetch=peer({schema_version:"radar-review-list/1",items:[{...radarApproved.reviews[0],revision:21}],next_after:21,review_count:30});
    await listRadarReviews(ids.change,context,20);expect(fetch.mock.calls[0][0]).toContain("limit=20&after=20");
    peer({schema_version:"radar-review-list/1",items:radarApproved.reviews,next_after:1,review_count:30});
    await expect(listRadarReviews(ids.change,context,20)).rejects.toMatchObject(unconfirmed);
  });
  it("pages durable manual failures without treating them as completed captures",async()=>{
    const run={id:ids.change,workspace_id:ids.workspace,monitor_id:ids.monitor,status:"FAILED",materiality:null,started_at:"2026-10-26T00:00:00Z",completed_at:null,
      previous_hash:null,current_hash:null,metadata:{source_mode:"SUPPLIED_DOCUMENT",reason_code:"SOURCE_UNAVAILABLE",last_confirmed_snapshot_id:ids.afterSnapshot}};
    const page={schema_version:"radar-run-list/1",items:[run],next_after:ids.change};
    const fetch=peer(page);await expect(listRadarRuns(ids.source,context,ids.baselineChange)).resolves.toEqual(page);
    expect(fetch.mock.calls[0][0]).toContain(`/sources/${ids.source}/runs?limit=20&after=${ids.baselineChange}`);
    peer({...page,items:[{...run,workspace_id:ids.afterDoc}]});await expect(listRadarRuns(ids.source,context)).rejects.toMatchObject(unconfirmed);
    peer({...radarSourceDetail,runs:{...page,items:[{...run,monitor_id:ids.beforeDoc}]}});
    await expect(readRadarSource(ids.source,context)).rejects.toMatchObject(unconfirmed);
  });
});

describe("Radar evidence integrity validation",()=>{
  it("accepts an honest selected before subset with its own comparison hash",()=>{
    const extra={...beforeOriginal,id:ids.review};
    const subset={...radarChange,before:{...radarChange.before!,chunk_ids:[ids.beforeChunk,ids.review],stored_chunk_count:2,selected_originals:[beforeOriginal,extra],normalized_hash:"3".repeat(64),selection_hash:"4".repeat(64)}};
    expect(confirmedRadarChangeDetail(subset,ids.workspace)).toBe(true);
  });
  it("rejects duplicate snapshot originals and byte lengths outside the existing source bounds",()=>{
    const snapshot={...radarCapture.snapshot,chunk_ids:[ids.afterChunk,ids.beforeChunk],stored_chunk_count:2,selected_originals:[afterOriginal,afterOriginal]};
    expect(confirmedRadarSnapshot(snapshot,ids.workspace,ids.source)).toBe(false);
    expect(confirmedRadarSnapshot({...radarCapture.snapshot,selected_originals:[{...afterOriginal,original_bytes:32769}]},ids.workspace,ids.source)).toBe(false);
    expect(confirmedRadarSnapshot({...radarCapture.snapshot,selected_utf8_bytes:156*32768+1},ids.workspace,ids.source)).toBe(false);
  });
  it("binds compared originals to the saved version and denies substituted locators",()=>{
    for(const bad of [{...afterOriginal,version_id:ids.beforeVersion},{...afterOriginal,document_id:ids.beforeDoc},
      {...afterOriginal,location:{page:99}},{...afterOriginal,original_content_hash:"9".repeat(64)}])
      expect(confirmedRadarChangeDetail({...radarChange,selections:{before:[beforeOriginal],after:[bad]}},ids.workspace)).toBe(false);
  });
});
