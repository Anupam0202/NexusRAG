import {readBoundedJsonObject} from "./request-body.js";
import limits from "../../../frontend/src/lib/finding-package-limits.json" with {type:"json"};

const uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const problem=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const text=(value,max,min=0)=>typeof value==="string"&&!value.includes("\0")&&value.trim().length>=min&&Array.from(value).length<=max;
const revision=value=>Number.isSafeInteger(value)&&value>=1;
export const packageLimits=limits;
const rpc=(args,name,values)=>args.serviceRequest(args.env,`rpc/${name}`,{method:"POST",body:JSON.stringify(values)});
const packageMetadata=(value,args,findingId)=>value&&uuid.test(value.id||"")&&value.workspace_id===args.workspace&&value.finding_id===findingId
  &&revision(value.finding_revision)&&["ready","expired"].includes(value.state)&&/^[a-f0-9]{64}$/.test(value.manifest_hash||"")
  &&value.serialization==="POSTGRES_JSONB_TEXT_UTF8/1"&&Number.isSafeInteger(value.manifest_bytes)&&value.manifest_bytes>0
  &&value.manifest_bytes<=packageLimits.max_manifest_bytes&&uuid.test(value.requested_by||"")&&typeof value.created_at==="string"&&Number.isFinite(Date.parse(value.created_at))
  &&(value.state==="ready"?value.reason===null:typeof value.reason==="string"&&value.reason.length>0);
const confirmedReceipt=(value,args,findingId,expectedRevision)=>value?.schema_version==="finding-package-receipt/1"
  &&packageMetadata(value,args,findingId)&&value.finding_revision===expectedRevision&&!Object.hasOwn(value,"manifest_text");
const policyShape=value=>value&&["ALLOW","DENY","REVIEW_REQUIRED","REVOKED"].includes(value.decision)
  &&["OWNED_CONTENT","LICENSE","PERMISSION","PUBLIC_DOMAIN","UNKNOWN"].includes(value.basis)
  &&text(value.rationale,2000,1)&&text(value.evidence_reference,2000)&&text(value.attribution,4000)
  &&Array.isArray(value.duties)&&value.duties.length<=10&&value.duties.every(duty=>text(duty,500,1))
  &&(value.review_by===null||typeof value.review_by==="string"&&Number.isFinite(Date.parse(value.review_by)))
  &&(value.decision!=="ALLOW"||value.basis!=="UNKNOWN"&&text(value.evidence_reference,2000,1)&&text(value.attribution,4000,1)&&value.review_by!==null);
export async function handleFindingPackages(args,route,context) {
  const {request,member}=args,{findingId,resource,packageId}=route,url=new URL(request.url);
  try {
    if(resource==="export-rights"){
      if(packageId)throw problem("NOT_FOUND","This export review route is unavailable.",404);
      let operation="read",command={},expectedRevision=null,key=null;
      if(request.method==="POST"){
        if(!["owner","admin"].includes(member.role))throw problem("FORBIDDEN","Workspace owner or administrator review is required.",403);
        const data=await readBoundedJsonObject(request);key=request.headers.get("idempotency-key");expectedRevision=data.revision;
        if(!text(key,128,1)||!revision(expectedRevision)||!Array.isArray(data.selections)||data.selections.length<1||data.selections.length>60
          ||new Set(data.selections.map(row=>row?.version_id?.toLowerCase())).size!==data.selections.length
          ||data.selections.some(row=>!row||!uuid.test(row.version_id||"")||row.expected_review_id!==null&&!uuid.test(row.expected_review_id||"")))
          throw problem("INVALID_SCOPE","Choose the exact source versions and current review revision.");
        const value=data.policy;
        if(!value||!["ALLOW","DENY","REVIEW_REQUIRED","REVOKED"].includes(value.decision)
          ||!["OWNED_CONTENT","LICENSE","PERMISSION","PUBLIC_DOMAIN","UNKNOWN"].includes(value.basis)
          ||!text(value.rationale,2000,1)||!text(value.evidence_reference,2000)||!text(value.attribution,4000)
          ||!Array.isArray(value.duties)||value.duties.length>10||value.duties.some(duty=>!text(duty,500,1))
          ||value.review_by!=null&&(typeof value.review_by!=="string"||!Number.isFinite(Date.parse(value.review_by)))
          ||new TextEncoder().encode(JSON.stringify(value)).length>packageLimits.max_review_bytes)
          throw problem("INVALID_SCOPE","The bounded export review is incomplete.");
        if(value.decision==="ALLOW"&&(value.basis==="UNKNOWN"||!text(value.evidence_reference,2000,1)||!text(value.attribution,4000,1)
          ||typeof value.review_by!=="string"||!Number.isFinite(Date.parse(value.review_by))||Date.parse(value.review_by)<=Date.now()))
          throw problem("INVALID_SCOPE","An allow decision needs explicit rights evidence,attribution and a future review date.");
        command={selections:data.selections.map(row=>({version_id:row.version_id.toLowerCase(),expected_review_id:row.expected_review_id?.toLowerCase()??null})),
          policy:{decision:value.decision,basis:value.basis,rationale:value.rationale.trim(),evidence_reference:value.evidence_reference.trim(),
            attribution:value.attribution.trim(),duties:value.duties.map(duty=>duty.trim()),review_by:value.review_by??null}};
        operation="record";
      }else if(!["GET","HEAD"].includes(request.method))throw problem("METHOD_NOT_ALLOWED","Use GET or POST for export review.",405);
      const result=await rpc(args,"nexus_finding_export_rights",{p_context:context,p_operation:operation,p_finding:findingId,p_command:command,p_revision:expectedRevision,p_key:key});
      if(result?.schema_version!=="finding-export-rights/1"||result.finding_id!==findingId||!revision(result.revision)||!Array.isArray(result.items)
        ||result.items.length<1||result.items.length>60||typeof result.eligible!=="boolean"||typeof result.can_review!=="boolean"||expectedRevision&&result.revision!==expectedRevision
        ||result.items.some(row=>!uuid.test(row?.version_id||"")||!uuid.test(row.document_id||"")||!/^[a-f0-9]{64}$/.test(row.original_hash||"")
          ||typeof row.allowed!=="boolean"||typeof row.filename!=="string"||row.review_id!==null&&!uuid.test(row.review_id||"")
          ||(row.review_id===null?row.policy!==null||row.allowed:!policyShape(row.policy)||!uuid.test(row.actor_id||"")||!Number.isFinite(Date.parse(row.created_at)))
          ||row.allowed&&row.policy?.decision!=="ALLOW")
        ||result.eligible!==result.items.every(row=>row.allowed))
        throw problem("PERSISTENCE_UNCONFIRMED","The export review was not confirmed. Refresh before retrying.",503);
      return args.json(request,args.env,result,operation==="record"?201:200);
    }
    let operation=packageId?"read":"list",expectedRevision=null,key=null,limit=20,after=null;
    if(request.method==="POST"&&!packageId){
      if(!["owner","admin","editor"].includes(member.role))throw problem("FORBIDDEN","Export capability is required.",403);
      const data=await readBoundedJsonObject(request);expectedRevision=data.revision;key=request.headers.get("idempotency-key");
      if(!revision(expectedRevision)||!text(key,128,1))throw problem("INVALID_SCOPE","The expected Finding revision and stable export intent are required.");
      operation="create_receipt";
    }else if(["GET","HEAD"].includes(request.method)){
      limit=Number(url.searchParams.get("limit")||20);after=url.searchParams.get("after");
      if(!Number.isInteger(limit)||limit<1||limit>50||after&&!uuid.test(after))throw problem("INVALID_SCOPE","Choose a valid package page.");
    }else throw problem("METHOD_NOT_ALLOWED","Use GET to inspect packages or POST to create one.",405);
    const values={p_context:context,p_operation:operation,p_finding:findingId,p_id:packageId||null,
      p_revision:expectedRevision,p_key:key,p_limit:limit,p_after:after};
    if(operation==="read"){
      // SQL rehydrates and verifies the exact manifest. Stream its response: never
      // buffer/parse the large artifact in this bounded coordination Worker.
      const response=await args.serviceResponse(args.env,"rpc/nexus_finding_package",{method:"POST",body:JSON.stringify(values)});
      const headers=new Headers(args.json(request,args.env,null).headers);headers.set("cache-control","private,no-store");
      if(request.method==="HEAD"){await response.body?.cancel();return new Response(null,{status:200,headers});}
      return new Response(response.body,{status:200,headers});
    }
    const result=await rpc(args,"nexus_finding_package",values);
    if(operation==="list"){
      if(result?.schema_version!=="finding-package-list/1"||!Array.isArray(result.items)||result.items.length>limit
        ||result.items.some(row=>!packageMetadata(row,args,findingId)||Object.hasOwn(row,"manifest_text"))
        ||new Set(result.items.map(row=>row.id)).size!==result.items.length
        ||result.next_after!==null&&(!uuid.test(result.next_after||"")||result.items.at(-1)?.id!==result.next_after))throw problem("PERSISTENCE_UNCONFIRMED","The saved package list was not confirmed.",503);
    }else if(!confirmedReceipt(result,args,findingId,expectedRevision))throw problem("PERSISTENCE_UNCONFIRMED","The saved package receipt was not confirmed. Refresh before retrying.",503);
    return args.json(request,args.env,result,operation==="create_receipt"?201:200);
  }catch(error){
    if(["PGRST202","42883","42P01"].includes(error.storageCode))throw problem("MIGRATION_REQUIRED","Evidence packages require the reviewed finding_evidence_packages migration.",503);
    const messages={RIGHTS_BLOCKED:[403,"Export rights are unknown,denied,expired or revoked for a source version."],REVIEW_REQUIRED:[409,"This exact Finding revision needs independent approval before export."],
      SOURCE_UNAVAILABLE:[409,"Original evidence changed or is unavailable. No package is confirmed."],RESOURCE_LIMIT_EXCEEDED:[413,"The evidence package exceeds its bounded size or storage allowance."],
      VERSION_CONFLICT:[409,"The Finding or export review changed. Refresh before retrying."]};
    if(messages[error.code])throw problem(error.code,messages[error.code][1],messages[error.code][0]);
    throw error;
  }
}
