import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createHash,webcrypto} from "node:crypto";
vi.mock("@/lib/api-context",()=>({getApiHeaders:vi.fn(async()=>({Authorization:"Bearer synthetic"}))}));
vi.mock("@/lib/backend-url",()=>({buildBackendUrl:(path:string)=>`https://gateway.invalid${path}`}));
import {listObligationEvidence,readObligationEvidence,readFindingServingRights,recordFindingServingRights} from "./api";
import {confirmedObligationDetail,confirmedObligationList,confirmedServingRights} from "./obligation-evidence";
import {fixtureServingIntentHash,obligationEvidenceFixture,obligationId,withheldObligationEvidence} from "@/test/fixtures/obligation-evidence";
import {obligationCapacity} from "../../../tests/fixtures/research-obligation-capacity.mjs";
import {obligationResult,obligationWork} from "../../../apps/gateway/src/research-obligations.js";
import type {ResearchRunResult} from "./research-run";
import {servingIntentHash} from "../../../apps/gateway/src/serving-intent.js";
import intentVectors from "../../../tests/fixtures/serving-intent-vectors.json";
const original=obligationEvidenceFixture(),id=original.detail.finding_id,context={workspaceId:original.run.workspace_id,expectedUserId:original.run.owner_id};
function peer(value:unknown,status=200,headers?:Record<string,string>){const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify(value),{status,headers}));vi.stubGlobal("fetch",fetch);return fetch;}
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));afterEach(()=>vi.unstubAllGlobals());
const unconfirmed={code:"PERSISTENCE_UNCONFIRMED"};
describe("typed obligation evidence client",()=>{
  it("matches independently generated UTF8 framing vectors for emoji/nulls/newlines/orderedselections",async()=>{
    for(const vector of intentVectors.vectors)expect(await servingIntentHash(vector.intent as Parameters<typeof servingIntentHash>[0])).toBe(vector.sha256);
  });
  it("uses authenticated REST metadata cursors and the existing custom MCP envelope separately",async()=>{
    const {list}=obligationEvidenceFixture();let fetch=peer(list);await expect(listObligationEvidence("SERVE_API",context)).resolves.toEqual(list);
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v2/obligations?limit=20");
    const mcp=obligationEvidenceFixture("SERVE_MCP").list;fetch=peer({...mcp,protocol:"nexusrag-evidence-mcp/1",operation:"obligation_lookup"});await listObligationEvidence("SERVE_MCP",context,obligationId(12),50);
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.invalid/api/v2/mcp/execute");expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({operation:"obligation_lookup",limit:50,after:obligationId(12)});
    peer(mcp);await expect(listObligationEvidence("SERVE_MCP",context)).rejects.toMatchObject(unconfirmed);
  });
  it("preserves canonical nullable/Unicode fields and confirms actual full original hashes",async()=>{
    const {detail}=obligationEvidenceFixture(),fetch=peer(detail);await expect(readObligationEvidence(id,3,"SERVE_API",context)).resolves.toEqual(detail);
    expect(fetch.mock.calls[0][0]).toBe(`https://gateway.invalid/api/v2/obligations/${id}?revision=3`);expect(detail.result!.obligations!.candidates[0].jurisdiction).toBeNull();
    const changed=structuredClone(detail);changed.evidence[1].original_text+=" altered";peer(changed);await expect(readObligationEvidence(id,3,"SERVE_API",context)).rejects.toMatchObject(unconfirmed);
  });
  it("accepts withheld identities while rejecting remaining generated or source-derived fields",async()=>{
    const value=withheldObligationEvidence();peer(value);await expect(readObligationEvidence(id,3,"SERVE_API",context)).resolves.toEqual(value);
    for(const change of [{title:"Leaked title"},{result:original.detail.result},{source_snapshot:original.detail.source_snapshot},{rights:original.detail.rights}]){
      peer({...value,...change});await expect(readObligationEvidence(id,3,"SERVE_API",context)).rejects.toMatchObject(unconfirmed);}
  });
  it("rejects substituted revision/workspace/action/anchor and missing disclosed-source permission",async()=>{
    const {detail}=obligationEvidenceFixture();for(const change of [{revision:4},{workspace_id:obligationId(99)},{action:"SERVE_MCP"},{rights:detail.rights.slice(0,1)}]){
      peer({...detail,...change});await expect(readObligationEvidence(id,3,"SERVE_API",context)).rejects.toMatchObject(unconfirmed);}
    const changed=structuredClone(detail);changed.result!.obligations!.candidates[0].exceptions[0].quote="Different duty";peer(changed);await expect(readObligationEvidence(id,3,"SERVE_API",context)).rejects.toMatchObject(unconfirmed);
  });
  it("rejects source content in metadata lists, wrong cursor order and identity substitutions",()=>{
    const {list}=obligationEvidenceFixture();expect(confirmedObligationList(list,context.workspaceId,"SERVE_API",20)).toBe(true);
    expect(confirmedObligationList({...list,items:[{...list.items[0],title:"not metadata"} as never]},context.workspaceId,"SERVE_API",20)).toBe(false);
    expect(confirmedObligationList(list,context.workspaceId,"SERVE_API",20,id)).toBe(false);expect(confirmedObligationList({...list,next_after:obligationId(99)},context.workspaceId,"SERVE_API",20)).toBe(false);
  });
  it("preserves actual429status and Retry-After instead of silently retrying",async()=>{
    const fetch=peer({error:{code:"RATE_LIMITED",message:"Please wait."}},429,{"Retry-After":"61"});
    await expect(listObligationEvidence("SERVE_API",context)).rejects.toMatchObject({status:429,retryAfterSeconds:61,code:"RATE_LIMITED"});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("reads rights separately for each action and accepts unknown hashes only when unavailable",async()=>{
    const {rights}=obligationEvidenceFixture(),fetch=peer(rights);await readFindingServingRights(id,"SERVE_API",context);expect(fetch.mock.calls[0][0]).toContain("serving-rights?action=SERVE_API");
    const unavailable={...rights,source_state:"UNAVAILABLE_OR_CHANGED" as const,eligible:false,items:rights.items.map(row=>({...row,original_hash:null,review_id:null,actor_id:null,created_at:null,policy:null,allowed:false,state:"SOURCE_UNAVAILABLE" as const}))};
    expect(confirmedServingRights(unavailable,id,context.workspaceId,"SERVE_API")).toBe(true);expect(confirmedServingRights({...unavailable,items:[{...unavailable.items[0],state:"UNKNOWN"}]},id,context.workspaceId,"SERVE_API")).toBe(false);
  });
  it("preserves an opaque erased head as blocked without inventing a human policy",async()=>{
    const {rights}=obligationEvidenceFixture(),erased={...rights,eligible:false,items:rights.items.map(row=>({...row,policy:null,policy_erased_at:"2026-10-28T18:00:00Z",allowed:false,state:"REVOKED" as const}))};
    expect(confirmedServingRights(erased,id,context.workspaceId,"SERVE_API")).toBe(true);
    expect(confirmedServingRights({...erased,items:erased.items.map(row=>({...row,policy_erased_at:null}))},id,context.workspaceId,"SERVE_API")).toBe(false);
    expect(confirmedServingRights({...erased,eligible:true,items:erased.items.map(row=>({...row,allowed:true,state:"ALLOWED"}))},id,context.workspaceId,"SERVE_API")).toBe(false);
  });
  it("confirms compact immutable intent on replay while retaining current revoked rights and laterrevision",async()=>{
    const {command,confirmed}=obligationEvidenceFixture(),replay={...confirmed,revision:4,eligible:false,items:confirmed.items.map(row=>({...row,state:"REVOKED",allowed:false,policy:{...row.policy!,decision:"REVOKED"}}))};
    const fetch=peer(replay);await expect(recordFindingServingRights(id,"SERVE_API",command,"stable-serving-intent",context)).resolves.toEqual(replay);
    expect(fetch.mock.calls[0][1]).toMatchObject({method:"POST",headers:{"Idempotency-Key":"stable-serving-intent"},body:JSON.stringify(command)});
    for(const change of [{actor_id:obligationId(99)},{finding_revision:4},{intent_hash:"0".repeat(64)},{serialization:"POSTGRES_JSONB_TEXT_UTF8/1"}]){
      peer({...replay,confirmed_review:{...replay.confirmed_review,...change}});await expect(recordFindingServingRights(id,"SERVE_API",command,"intent",context)).rejects.toMatchObject(unconfirmed);}
    expect(JSON.stringify(confirmed.confirmed_review)).not.toContain(command.policy.rationale);
  });
  it("does not send an oversized policy or treat an unbound receipt as persistence",async()=>{
    const {command,confirmed}=obligationEvidenceFixture(),fetch=peer(confirmed);
    await expect(recordFindingServingRights(id,"SERVE_API",{...command,policy:{...command.policy,duties:["x".repeat(501)]}},"intent",context)).rejects.toMatchObject({code:"INVALID_SCOPE"});expect(fetch).not.toHaveBeenCalled();
    peer({...confirmed,confirmed_review:null});await expect(recordFindingServingRights(id,"SERVE_API",command,"intent",context)).rejects.toMatchObject(unconfirmed);
  });
  it("confirms the genuine custom MCP detail without inventing another run",async()=>{
    const {detail}=obligationEvidenceFixture("SERVE_MCP");peer({...detail,protocol:"nexusrag-evidence-mcp/1",operation:"obligation_lookup"});
    await expect(readObligationEvidence(id,3,"SERVE_MCP",context)).resolves.toMatchObject(detail);expect(await confirmedObligationDetail(detail,id,3,context.workspaceId,"SERVE_MCP")).toBe(true);
  });
  it("retains all50sourceversions and12completecandidates at the final11thcriterion",async()=>{
    const capacity=obligationCapacity(),fixture=obligationEvidenceFixture(),built=obligationResult(obligationWork({...capacity.run,position:10}),capacity.documents,capacity.sources,{answer:JSON.stringify({candidates:capacity.candidates})});
    const result={...fixture.result,question:capacity.run.questions[10],answer:built.checked.answer,sources:built.sources,obligations:built.analysis,validated_citation_ids:built.sources.map((row:{citation_id:string})=>row.citation_id)} as ResearchRunResult;
    for(const source of result.sources){source.original_content_hash=createHash("sha256").update(source.content).digest("hex");for(const document of result.obligations!.documents)for(const receipt of document.consulted_sources)if(receipt.chunk_id===source.chunk_id)receipt.original_content_hash=source.original_content_hash;}
    const rights=capacity.run.source_snapshot.map((source:{document_id:string;version_id:string},index:number)=>({...fixture.rights.items[0],document_id:source.document_id,version_id:source.version_id,original_hash:"a".repeat(64),review_id:obligationId(100+index)}));
    const detail={...fixture.detail,result_index:10,result,source_snapshot:capacity.run.source_snapshot,rights,evidence:result.sources.map(source=>({id:source.chunk_id,document_id:source.document_id,version_id:source.version_id,citation_id:source.citation_id,filename:source.filename,original_text:source.content,original_content_hash:source.original_content_hash,location:source.location,available:true as const,freshness:"current" as const}))};
    expect(detail.result.obligations!.candidates[11].supersedes).toHaveLength(4);expect(await confirmedObligationDetail(detail,id,3,context.workspaceId,"SERVE_API")).toBe(true);
    detail.rights.pop();expect(await confirmedObligationDetail(detail,id,3,context.workspaceId,"SERVE_API")).toBe(false);
  });
  it("confirms normalized intent and permits an expired oldALLOW replay without resurrectingeligibility",async()=>{
    const {command,confirmed}=obligationEvidenceFixture(),raw={...command,policy:{...command.policy,rationale:`  ${command.policy.rationale}  `,review_by:"2030-01-01T00:00:00Z"}};
    const fetch=peer(confirmed);await recordFindingServingRights(id,"SERVE_API",raw,"intent",context);expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command);
    const old={...command,policy:{...command.policy,review_by:"2020-01-01T00:00:00.000Z"}},replay={...confirmed,eligible:false,items:confirmed.items.map(row=>({...row,allowed:false,state:"EXPIRED",policy:old.policy})),
      confirmed_review:{...confirmed.confirmed_review!,intent_hash:fixtureServingIntentHash(id,3,"SERVE_API",context.expectedUserId,old)}};
    peer(replay);await expect(recordFindingServingRights(id,"SERVE_API",old,"old-intent",context)).resolves.toEqual(replay);
  });
  it("canonicalizes uppercase Finding ids for detail, current rights and confirmed writes",async()=>{
    const canonical="abcdef00-0000-4000-8000-00000000000a",upper=canonical.toUpperCase(),{detail,rights,confirmed,command}=obligationEvidenceFixture();
    let fetch=peer({...detail,finding_id:canonical});await expect(readObligationEvidence(upper,3,"SERVE_API",context)).resolves.toMatchObject({finding_id:canonical});expect(fetch.mock.calls[0][0]).toContain(`/obligations/${canonical}?`);
    fetch=peer({...rights,finding_id:canonical});await expect(readFindingServingRights(upper,"SERVE_API",context)).resolves.toMatchObject({finding_id:canonical});expect(fetch.mock.calls[0][0]).toContain(`/findings/${canonical}/`);
    fetch=peer({...confirmed,finding_id:canonical,confirmed_review:{...confirmed.confirmed_review!,finding_id:canonical,intent_hash:fixtureServingIntentHash(canonical,3,"SERVE_API",context.expectedUserId,command)}});
    await expect(recordFindingServingRights(upper,"SERVE_API",command,"uppercase-intent",context)).resolves.toMatchObject({finding_id:canonical});expect(fetch.mock.calls[0][0]).toContain(`/findings/${canonical}/`);
  });
});
