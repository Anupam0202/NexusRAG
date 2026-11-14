// Supplied retained originals only. This handler never fetches a source URL,
// invokes a model or schedules recurring provider work.
import {readBoundedJsonObject} from "./request-body.js";
import {workbenchContext} from "./workbench.js";
import {classifyRadarChange} from "./radar-materiality.js";

const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,hash=/^[a-f0-9]{64}$/;
const coverage="SELECTED_CHUNKS_NOT_FULL_DOCUMENT";
const materialities=["NONE","EDITORIAL","OPERATIONAL","RIGHTS_REVIEW","SECURITY_REVIEW","REVIEW_REQUIRED"];
const kinds=["TERMS","QUOTA","PRICING","SCHEMA","DEPRECATION","LICENCE","OTHER"];
const issue=(code,message,status=422)=>Object.assign(new Error(message),{code,status});
const string=(v,max,min=0)=>typeof v==="string"&&!v.includes("\0")&&Array.from(v).length<=max&&v.trim().length>=min;
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const id=v=>{if(!uuid.test(v||""))throw issue("INVALID_SCOPE","Choose a valid retained record.");return v.toLowerCase();};
const text=(v,name,max,min=0)=>{if(!string(v,max,min))throw issue("INVALID_SCOPE",`${name} is incomplete or exceeds its bound.`);return v;};
const workflows=v=>{v??=[];if(!Array.isArray(v)||v.length>50||v.some(x=>!string(x,128,1)))throw issue("INVALID_SCOPE","Choose at most fifty named affected workflows.");return v.map(x=>x.trim());};
const ids=v=>{if(!Array.isArray(v)||v.length<1||v.length>156)throw issue("INVALID_SCOPE","Choose one to156 exact retained originals.");const values=v.map(id);if(new Set(values).size!==values.length)throw issue("INVALID_SCOPE","Each selected original must be distinct.");return values.sort();};
const date=v=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const rights=v=>v&&["ALLOW","ALLOW_WITH_DUTIES","DENY","REVIEW_REQUIRED"].includes(v.decision)&&typeof v.state==="string"&&typeof v.reason_code==="string";
const ref=v=>v&&uuid.test(v.id||"")&&uuid.test(v.document_id||"")&&uuid.test(v.version_id||"")&&integer(v.chunk_index)
  &&hash.test(v.original_content_hash||"")&&integer(v.original_bytes,1)&&v.original_bytes<=32768&&Object.hasOwn(v,"location");
const source=(v,ws)=>v?.schema_version==="radar-source/1"&&uuid.test(v.id||"")&&v.workspace_id===ws&&string(v.provider_id,128,1)
  &&string(v.source_url,2000,1)&&string(v.title,160,1)&&kinds.includes(v.kind)&&integer(v.revision)
  &&(v.latest_snapshot_id===null||uuid.test(v.latest_snapshot_id||""))&&rights(v.rights)&&uuid.test(v.created_by||"")&&date(v.created_at)
  &&v.monitor&&uuid.test(v.monitor.id||"")&&v.monitor.tier==="MANUAL_REVIEW"&&v.monitor.retrieval_method==="SUPPLIED_DOCUMENT"
  &&v.monitor.enabled===false&&v.monitor.next_run_at===null;
const snapshot=(v,ws)=>v?.schema_version==="radar-snapshot/1"&&v.workspace_id===ws&&[v.id,v.source_id,v.document_id,v.version_id,v.actor_id,v.change_id].every(x=>uuid.test(x||""))
  &&integer(v.revision,1)&&hash.test(v.document_original_hash||"")&&integer(v.document_original_bytes,1)&&v.document_original_bytes<=524288000
  &&hash.test(v.selection_hash||"")&&hash.test(v.normalized_hash||"")&&Array.isArray(v.chunk_ids)&&v.chunk_ids.length>=1&&v.chunk_ids.length<=156
  &&new Set(v.chunk_ids).size===v.chunk_ids.length&&v.chunk_ids.every(x=>uuid.test(x||""))&&Array.isArray(v.selected_originals)&&v.selected_originals.length===v.chunk_ids.length
  &&v.selected_originals.every((x,i)=>ref(x)&&x.id===v.chunk_ids[i]&&x.document_id===v.document_id&&x.version_id===v.version_id)
  &&integer(v.selected_utf8_bytes,1)&&v.selected_utf8_bytes<=5111808&&integer(v.stored_chunk_count,v.chunk_ids.length)
  &&typeof v.comparison_complete==="boolean"&&v.coverage===coverage&&date(v.captured_at)&&date(v.recorded_at);
const summary=(v,ws)=>v?.schema_version==="radar-change/1"&&v.workspace_id===ws&&[v.id,v.source_id,v.after_snapshot_id].every(x=>uuid.test(x||""))
  &&(v.before_snapshot_id===null||uuid.test(v.before_snapshot_id||""))&&(v.previous_hash===null||hash.test(v.previous_hash||""))
  &&hash.test(v.current_hash||"")&&(v.previous_selection_hash===null||hash.test(v.previous_selection_hash||""))&&hash.test(v.current_selection_hash||"")
  &&["BASELINE","UNCHANGED","CHANGED"].includes(v.status)&&materialities.includes(v.materiality)&&["NOT_REQUIRED","PENDING","APPROVED","CHANGES_REQUESTED"].includes(v.review_state)
  &&integer(v.review_revision)&&(v.finding_id===null||uuid.test(v.finding_id||""))&&date(v.created_at)
  &&(v.before_snapshot_id===null?Array.isArray(v.before_chunk_ids)&&v.before_chunk_ids.length===0&&v.previous_hash===null&&v.previous_selection_hash===null:Array.isArray(v.before_chunk_ids)&&v.before_chunk_ids.length>=1&&v.before_chunk_ids.length<=156&&new Set(v.before_chunk_ids).size===v.before_chunk_ids.length&&v.before_chunk_ids.every(x=>uuid.test(x||"")));
const review=v=>v&&uuid.test(v.id||"")&&uuid.test(v.reviewer_id||"")&&integer(v.revision,1)&&["approved","changes_requested"].includes(v.decision)&&string(v.comment,4000)&&date(v.created_at)&&Array.isArray(v.affected_workflows)&&v.affected_workflows.length<=50&&v.affected_workflows.every(x=>string(x,128,1));
const change=(v,ws)=>summary(v,ws)&&snapshot(v.after,ws)&&v.after.id===v.after_snapshot_id&&(v.before===null||snapshot(v.before,ws)&&v.before.id===v.before_snapshot_id)
  &&v.after.normalized_hash===v.current_hash&&v.after.selection_hash===v.current_selection_hash
  &&(v.before_snapshot_id===null?v.before===null:v.before!==null&&v.before_chunk_ids.every(x=>v.before.chunk_ids.includes(x)))
  &&v.coverage===coverage&&typeof v.source_available==="boolean"&&rights(v.rights)&&Array.isArray(v.reviews)&&v.reviews.length<=20&&v.reviews.every(review)
  &&integer(v.review_count,v.reviews.length)&&(v.reviews_next_after===null||integer(v.reviews_next_after,1))&&hash.test(v.review_history_hash||"")
  &&(v.before_text_preview===null||string(v.before_text_preview,4096))&&(v.after_text_preview===null||string(v.after_text_preview,4096))&&typeof v.preview_truncated==="boolean"
  &&Array.isArray(v.selections?.before)&&Array.isArray(v.selections?.after)&&[...v.selections.before,...v.selections.after].every(ref)
  &&new Set([...v.selections.before,...v.selections.after].map(x=>x.id)).size<=156
  &&v.selections.after.length===v.after.chunk_ids.length&&v.selections.after.every((x,i)=>x.id===v.after.chunk_ids[i])
  &&v.selections.before.length===(v.before_chunk_ids?.length??0)&&v.selections.before.every((x,i)=>x.id===v.before_chunk_ids[i]);
const page=(v,check,max)=>v&&Array.isArray(v.items)&&v.items.length<=max&&v.items.every(check)&&new Set(v.items.map(x=>x.id)).size===v.items.length
  &&(v.next_after===null||uuid.test(v.next_after||"")&&v.items.at(-1)?.id===v.next_after);
function confirmed(ok){if(!ok)throw issue("PERSISTENCE_UNCONFIRMED","Radar storage did not confirm the requested durable state. Refresh before retrying.",503);}
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,"0")).join("");
const rpc=(a,name,values)=>a.serviceRequest(a.env,`rpc/${name}`,{method:"POST",body:JSON.stringify(values)});

export async function handleRadar(args){
  const {request,env,user,workspace,member,json}=args,url=new URL(request.url);
  if(!/^\/api\/v2\/radar(?:\/|$)/.test(url.pathname))return null;
  const method=request.method,read=["GET","HEAD"].includes(method),key=request.headers.get("idempotency-key");
  const route=url.pathname.replace(/^\/api\/v2\/radar\/?/,"").split("/").filter(Boolean);
  let context,sourceId=null,captureCommand=null;
  try{
    const contract=await rpc(args,"nexus_radar_contract",{});
    if(contract?.schema_version!=="radar/1"||contract.source_mode!=="SUPPLIED_DOCUMENT"||contract.max_selected_originals!==156||contract.fetch!==false||contract.recurring!==false||contract.ai!==false)
      throw issue("MIGRATION_REQUIRED","Radar needs the reviewed supplied-snapshot storage contract.",503);
    context=await workbenchContext(args);
    const call=(operation,values={})=>rpc(args,"nexus_radar",{p_context:context,p_operation:operation,p_source:null,p_id:null,p_command:{},p_key:null,p_limit:20,p_after:null,...values});
    const limit=Number(url.searchParams.get("limit")||20),after=url.searchParams.get("after");
    if(!integer(limit,1)||limit>50)throw issue("INVALID_SCOPE","Choose a page of one to fifty records.");
    if(!read&&method!=="POST")throw issue("METHOD_NOT_ALLOWED","Use GET or the explicit POST action.",405);
    if(!read){if(!["owner","admin","editor"].includes(member.role))throw issue("FORBIDDEN","Radar write capability is required.",403);text(key,"Stable Idempotency-Key",128,1);}
    let result;
    if(route.length===1&&route[0]==="providers"&&read){
      if(after!==null)text(after,"Provider cursor",128,1);
      result=await call("providers",{p_limit:limit,p_command:after?{after}:{}});
      confirmed(result?.schema_version==="radar-providers/1"&&Array.isArray(result.items)&&result.items.length<=limit&&result.items.every(x=>string(x.id,128,1)&&string(x.display_name,500,1)&&integer(x.revision,1)&&rights(x.rights))
        &&(result.next_after===null||result.items.at(-1)?.id===result.next_after));
    }else if(route.length===1&&route[0]==="sources"){
      if(read){result=await call("sources_list",{p_limit:limit,p_after:after?id(after):null});confirmed(result?.schema_version==="radar-source-list/1"&&page(result,x=>source(x,workspace),limit));}
      else{
        const data=await readBoundedJsonObject(request);let sourceUrl;
        try{sourceUrl=new URL(text(data.source_url,"Declared source URL",2000,1).trim());}catch{throw issue("INVALID_SCOPE","Supply the declared HTTPS source URL; this action does not fetch it.");}
        if(sourceUrl.protocol!=="https:"||sourceUrl.username||sourceUrl.password)throw issue("INVALID_SCOPE","The declared source must be HTTPS without embedded credentials.");
        const command={provider_id:text(data.provider_id,"Provider identity",128,1).trim(),source_url:sourceUrl.href,title:text(data.title,"Source title",160,1).trim(),kind:data.kind,affected_workflows:workflows(data.affected_workflows)};
        if(!kinds.includes(command.kind)||!string(command.source_url,2000,1))throw issue("INVALID_SCOPE","Choose a supported snapshot kind and bounded source URL.");
        result=await call("source_create",{p_command:command,p_key:key});confirmed(source(result,workspace)&&result.provider_id===command.provider_id&&result.source_url===command.source_url&&result.title===command.title&&result.kind===command.kind);
      }
    }else if(route[0]==="documents"&&route.length===3&&route[2]==="chunks"&&read){
      const document=id(route[1]),version=url.searchParams.get("version_id");result=await call("chunks",{p_id:document,p_command:version?{version_id:id(version)}:{},p_limit:limit,p_after:after?id(after):null});
      confirmed(result?.schema_version==="radar-chunks/1"&&result.document_id===document&&uuid.test(result.version_id||"")&&hash.test(result.document_original_hash||"")&&integer(result.document_original_bytes,1)
        &&page(result,x=>ref(x)&&x.document_id===document&&x.version_id===result.version_id&&string(x.preview,200)&&typeof x.preview_truncated==="boolean",limit));
    }else if(route[0]==="sources"&&route.length>=2){
      sourceId=id(route[1]);
      if(route.length===2&&read){
        result=await call("source_read",{p_source:sourceId,p_limit:limit,p_after:after?id(after):null});
        confirmed(result?.schema_version==="radar-source-detail/1"&&source(result.source,workspace)&&result.source.id===sourceId&&page(result.snapshots,x=>snapshot(x,workspace)&&x.source_id===sourceId,limit)
          &&(result.latest_snapshot===null||snapshot(result.latest_snapshot,workspace)&&result.latest_snapshot.id===result.source.latest_snapshot_id)
          &&result.changes&&Array.isArray(result.changes.items)&&result.changes.items.length===result.snapshots.items.length&&result.changes.items.every(x=>summary(x,workspace)&&x.source_id===sourceId)
          &&result.changes.next_after===result.snapshots.next_after);
      }else if(route.length===3&&route[2]==="runs"&&read){result=await call("runs_read",{p_source:sourceId,p_limit:limit,p_after:after?id(after):null});confirmed(result?.schema_version==="radar-run-list/1"&&page(result,x=>x.workspace_id===workspace&&uuid.test(x.monitor_id||"")&&["BASELINE","UNCHANGED","CHANGED","FAILED","RIGHTS_BLOCKED","QUOTA_EXHAUSTED","REVIEW_REQUIRED"].includes(x.status),limit));}
      else if(route.length===3&&route[2]==="snapshots"&&method==="POST"){
        const data=await readBoundedJsonObject(request);
        if(!integer(data.expected_revision)||!date(data.captured_at)||Date.parse(data.captured_at)>Date.now()+300000)throw issue("INVALID_SCOPE","Choose the expected source revision and a valid captured time.");
        captureCommand={expected_revision:data.expected_revision,document_id:id(data.document_id),version_id:id(data.version_id),chunk_ids:ids(data.chunk_ids),captured_at:new Date(data.captured_at).toISOString(),rights_rationale:text(data.rights_rationale,"Supplied-copy rights rationale",2000,1).trim()};
        if(data.before_chunk_ids!==undefined)captureCommand.before_chunk_ids=ids(data.before_chunk_ids);
        const prepared=await call("prepare_snapshot",{p_source:sourceId,p_command:captureCommand,p_key:key});
        confirmed(prepared?.schema_version==="radar-prepare/1"&&typeof prepared.replayed==="boolean");
        if(prepared.replayed)result=prepared.result;
        else{
          const prior=prepared.previous,current=prepared.current;
          const preparedSelection=v=>v&&hash.test(v.normalized_hash||"")&&hash.test(v.selection_hash||"")&&string(v.normalized_text,65536)&&typeof v.comparison_complete==="boolean"&&Array.isArray(v.chunk_ids)&&v.chunk_ids.every(x=>uuid.test(x||""));
          confirmed(source(prepared.source,workspace)&&prepared.source.id===sourceId&&prepared.source.revision===captureCommand.expected_revision&&preparedSelection(current)&&(!prior||preparedSelection(prior))
            &&current.document_id===captureCommand.document_id&&current.version_id===captureCommand.version_id&&new Set(current.chunk_ids).size===captureCommand.chunk_ids.length
            &&captureCommand.chunk_ids.every(x=>current.chunk_ids.includes(x)));
          let classification={materiality:"NONE",matched_signals:[]};
          if(prior&&prior.normalized_hash!==current.normalized_hash){
            classification=classifyRadarChange(prior.normalized_text,current.normalized_text);
            if(!prior.comparison_complete||!current.comparison_complete||!classification.changed)classification={materiality:"REVIEW_REQUIRED",matched_signals:["COMPLETE_SELECTED_EVIDENCE_REQUIRES_REVIEW"]};
          }
          const command={...captureCommand,classification:{previous_hash:prior?.normalized_hash??null,current_hash:current.normalized_hash,
            previous_selection_hash:prior?.selection_hash??null,current_selection_hash:current.selection_hash,materiality:classification.materiality,matched_signals:classification.matched_signals}};
          result=await call("capture",{p_source:sourceId,p_command:command,p_key:key});
        }
        confirmed(result?.schema_version==="radar-capture/1"&&source(result.source,workspace)&&snapshot(result.snapshot,workspace)&&result.snapshot.source_id===sourceId
          &&change(result.change,workspace)&&result.change.id===result.snapshot.change_id&&result.change.after_snapshot_id===result.snapshot.id
          &&result.snapshot.revision===captureCommand.expected_revision+1&&result.snapshot.document_id===captureCommand.document_id&&result.snapshot.version_id===captureCommand.version_id
          &&result.snapshot.actor_id===user.id&&result.snapshot.chunk_ids.length===captureCommand.chunk_ids.length&&captureCommand.chunk_ids.every(x=>result.snapshot.chunk_ids.includes(x))
          &&result.source.revision>=result.snapshot.revision&&(result.source.revision!==result.snapshot.revision||result.source.latest_snapshot_id===result.snapshot.id));
      }else throw issue("METHOD_NOT_ALLOWED","Use the explicit source inspection or supplied-snapshot action.",405);
    }else if(route[0]==="changes"&&route.length>=2){
      const changeId=id(route[1]);
      if(route.length===2&&read){result=await call("change_read",{p_id:changeId});confirmed(change(result,workspace)&&result.id===changeId);}
      else if(route.length===3&&route[2]==="reviews"&&read){
        const revision=Number(after||0);if(!integer(revision))throw issue("INVALID_SCOPE","Choose a non-negative review revision cursor.");
        result=await call("reviews_read",{p_id:changeId,p_command:{after:revision},p_limit:limit});confirmed(result?.schema_version==="radar-review-list/1"&&Array.isArray(result.items)&&result.items.length<=limit&&result.items.every(review)
          &&integer(result.review_count,result.items.length)&&(result.next_after===null||integer(result.next_after,1)&&result.items.at(-1)?.revision===result.next_after));
      }else if(route.length===3&&["review","finding"].includes(route[2])&&method==="POST"){
        const data=await readBoundedJsonObject(request);if(!integer(data.expected_review_revision))throw issue("INVALID_SCOPE","The exact current review revision is required.");
        const command={expected_review_revision:data.expected_review_revision};
        if(route[2]==="review"){
          if(!["approved","changes_requested"].includes(data.decision))throw issue("INVALID_SCOPE","Choose an explicit change review decision.");
          Object.assign(command,{decision:data.decision,comment:text(data.comment??"","Review comment",4000)});if(data.affected_workflows!==undefined)command.affected_workflows=workflows(data.affected_workflows);
          result=await call("review",{p_id:changeId,p_command:command,p_key:key});confirmed(change(result,workspace)&&result.id===changeId
            &&review(result.confirmed_review)&&result.confirmed_review.revision===command.expected_review_revision+1&&result.confirmed_review.reviewer_id===user.id
            &&result.confirmed_review.decision===command.decision&&result.confirmed_review.comment===command.comment&&result.review_revision>=result.confirmed_review.revision
            &&(command.affected_workflows===undefined||JSON.stringify(result.confirmed_review.affected_workflows)===JSON.stringify(command.affected_workflows)));
        }else{
          Object.assign(command,{title:text(data.title,"Finding title",160,1).trim(),authored_markdown:text(data.authored_markdown??"","Finding qualification",50000)});
          result=await call("finding",{p_id:changeId,p_command:command,p_key:key});confirmed(uuid.test(result?.id||"")&&result.workspace_id===workspace&&result.source_radar_change_id===changeId
            &&result.radar_origin?.id===changeId&&typeof result.source_unavailable==="boolean"&&Array.isArray(result.evidence)&&integer(result.revision,1)
            &&result.confirmed_creation?.schema_version==="radar-finding-creation/1"&&result.confirmed_creation.workspace_id===workspace
            &&result.confirmed_creation.finding_id===result.id&&result.confirmed_creation.change_id===changeId&&result.confirmed_creation.created_by===user.id
            &&result.confirmed_creation.revision===1&&result.confirmed_creation.expected_review_revision===command.expected_review_revision
            &&result.confirmed_creation.title===command.title&&result.confirmed_creation.authored_markdown_hash===await sha256(command.authored_markdown)
            &&result.confirmed_creation.authored_markdown_bytes===new TextEncoder().encode(command.authored_markdown).byteLength);
        }
      }else throw issue("METHOD_NOT_ALLOWED","Use the explicit change review or Finding action.",405);
    }else throw issue("NOT_FOUND","This Radar route is unavailable.",404);
    return json(request,env,result,read?200:201);
  }catch(error){
    if(context&&sourceId&&captureCommand&&key&&["RIGHTS_BLOCKED","SOURCE_UNAVAILABLE","RESOURCE_LIMIT_EXCEEDED","VERSION_CONFLICT","PERSISTENCE_UNCONFIRMED"].includes(error.code)){
      try{await rpc(args,"nexus_radar",{p_context:context,p_operation:"record_failure",p_source:sourceId,p_id:null,p_command:{reason_code:error.code,attempt:captureCommand},p_key:key,p_limit:20,p_after:null});}
      catch{/* A failed attempt cannot be declared durably recorded when its authority is unavailable. The original operation still fails. */}
    }
    if(["PGRST202","42883","42P01"].includes(error.storageCode))throw issue("MIGRATION_REQUIRED","Radar needs the reviewed supplied-snapshot migration.",503);
    const mapped={RIGHTS_BLOCKED:[403,"Current provider/workspace rights withhold this operation. Supplied copies do not activate provider rights."],SOURCE_UNAVAILABLE:[409,"Selected original evidence changed or is unavailable. Its retained history is preserved."],REVIEW_REQUIRED:[409,"This exact source pair needs independent review."],RESOURCE_LIMIT_EXCEEDED:[413,"The selected comparison or new metadata exceeds its documented bound. History and existing exports remain available."],VERSION_CONFLICT:[409,"The source or review revision changed. Refresh before retrying."],FORBIDDEN:[403,"This operation needs the appropriate independent workspace contributor."]};
    if(mapped[error.code])throw issue(error.code,mapped[error.code][1],mapped[error.code][0]);throw error;
  }
}
