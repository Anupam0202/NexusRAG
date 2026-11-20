import originalPolicy from "./document-original-policy.json";

export const radarKinds=["TERMS","QUOTA","PRICING","SCHEMA","DEPRECATION","LICENCE","OTHER"] as const;
export type RadarKind=typeof radarKinds[number];
export type RadarMateriality="NONE"|"EDITORIAL"|"OPERATIONAL"|"RIGHTS_REVIEW"|"SECURITY_REVIEW"|"REVIEW_REQUIRED";
export interface RadarRights {decision:string;state:string;reason_code:string;duties?:string[];provider_revision?:number;workspace_policy_version?:number;rights_hash?:string}
export interface RadarProvider {id:string;display_name:string;status:string;revision:number;rights:RadarRights}
export interface RadarSource {
  schema_version:"radar-source/1";id:string;workspace_id:string;provider_id:string;source_url:string;title:string;kind:RadarKind;
  revision:number;latest_snapshot_id:string|null;created_at:string;created_by:string;affected_workflows:string[];rights:RadarRights;
  monitor:{id:string;tier:"MANUAL_REVIEW";retrieval_method:"SUPPLIED_DOCUMENT";enabled:false;next_run_at:null;
    latest_run?:{id:string;status:string;materiality:RadarMateriality|null;created_at:string;reason_code?:string|null}|null};
}
export interface RadarSnapshot {
  schema_version:"radar-snapshot/1";id:string;workspace_id:string;source_id:string;revision:number;document_id:string;version_id:string;
  document_original_hash:string;document_original_bytes:number;chunk_ids:string[];selection_hash:string;normalized_hash:string;
  selected_utf8_bytes:number;stored_chunk_count:number;coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT";comparison_complete:boolean;
  captured_at:string;recorded_at:string;actor_id:string;change_id:string;selected_originals:RadarSelection[];
}
export interface RadarChange {
  schema_version:"radar-change/1";id:string;workspace_id:string;source_id:string;before_snapshot_id:string|null;after_snapshot_id:string;
  previous_hash:string|null;current_hash:string;before_chunk_ids:string[];previous_selection_hash:string|null;current_selection_hash:string;
  status:"BASELINE"|"UNCHANGED"|"CHANGED"|"RIGHTS_BLOCKED";
  materiality:RadarMateriality;review_state:"NOT_REQUIRED"|"PENDING"|"APPROVED"|"CHANGES_REQUESTED";
  review_revision:number;finding_id:string|null;created_at:string;
}
export interface RadarSelection {
  id:string;document_id:string;version_id:string;chunk_index:number;original_content_hash:string;original_bytes:number;location:unknown;
}
export interface RadarReview {id:string;reviewer_id:string;decision:"approved"|"changes_requested";comment:string;affected_workflows:string[];created_at:string;revision:number}
export interface RadarChangeDetail extends RadarChange {
  before:RadarSnapshot|null;after:RadarSnapshot;reviews:RadarReview[];review_count:number;reviews_next_after:number|null;review_history_hash:string;confirmed_review?:RadarReview;
  source_available:boolean;rights:RadarRights;affected_workflows:string[];
  before_text_preview:string|null;after_text_preview:string|null;preview_truncated:boolean;
  coverage:"SELECTED_CHUNKS_NOT_FULL_DOCUMENT";selections:{before:RadarSelection[];after:RadarSelection[]};
  provider_id?:string;source_url?:string;kind?:RadarKind;
}
export type RadarOrigin=Omit<RadarChangeDetail,"reviews"|"before_text_preview"|"after_text_preview"|"selections">;
export interface RadarPage<T>{items:T[];next_after:string|null}
export interface RadarRun {
  id:string;workspace_id:string;monitor_id:string;status:"BASELINE"|"UNCHANGED"|"CHANGED"|"FAILED"|"RIGHTS_BLOCKED"|"QUOTA_EXHAUSTED"|"REVIEW_REQUIRED";
  previous_hash:string|null;current_hash:string|null;materiality:RadarMateriality|null;started_at:string;completed_at:string|null;
  metadata:{source_mode:"SUPPLIED_DOCUMENT";reason_code?:string|null;after_snapshot_id?:string|null;before_snapshot_id?:string|null;last_confirmed_snapshot_id?:string|null};
}
export interface RadarRunPage extends RadarPage<RadarRun>{schema_version:"radar-run-list/1"}
export interface RadarFindingCreation {
  schema_version:"radar-finding-creation/1";workspace_id:string;finding_id:string;change_id:string;created_by:string;revision:1;
  expected_review_revision:number;title:string;authored_markdown_hash:string;authored_markdown_bytes:number;
}
export interface RadarSourceDetail {
  schema_version:"radar-source-detail/1";source:RadarSource;latest_snapshot?:RadarSnapshot|null;
  snapshots:RadarPage<RadarSnapshot>;changes:RadarPage<RadarChange>;runs:RadarRunPage;
}
export interface RadarCapture {schema_version:"radar-capture/1";source:RadarSource;snapshot:RadarSnapshot;change:RadarChangeDetail}
export interface RadarChunk extends RadarSelection {preview:string;preview_truncated:boolean}
export interface RadarChunks extends RadarPage<RadarChunk> {
  schema_version:"radar-chunks/1";document_id:string;version_id:string;document_original_hash:string;document_original_bytes:number;stored_chunk_count:number;
}
export const radarUuid=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const hash=(value:unknown)=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
const whole=(value:unknown,minimum=0):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=minimum;
const text=(value:unknown,maximum:number,minimum=0):value is string=>typeof value==="string"&&Array.from(value).length>=minimum&&Array.from(value).length<=maximum;
const time=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value));
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const strings=(value:unknown,maximum:number,count=50)=>Array.isArray(value)&&value.length<=count&&value.every(item=>text(item,maximum,1));
export function confirmedRadarRights(value:unknown):value is RadarRights {
  return object(value)&&text(value.decision,64,1)&&text(value.state,64,1)&&text(value.reason_code,128,1)
    &&["ALLOW","ALLOW_WITH_DUTIES","DENY","REVIEW_REQUIRED"].includes(String(value.decision))
    &&(value.duties===undefined||strings(value.duties,2000,100));
}
export function confirmedRadarSource(value:unknown,workspace:string,expectedId?:string):value is RadarSource {
  if(!object(value)||!object(value.monitor))return false;
  const m=value.monitor;
  return value.schema_version==="radar-source/1"&&radarUuid(value.id)&&(!expectedId||value.id===expectedId)&&value.workspace_id===workspace
    &&text(value.provider_id,128,1)&&text(value.title,160,1)&&text(value.source_url,2000,1)&&value.source_url.startsWith("https://")
    &&radarKinds.includes(value.kind as RadarKind)&&whole(value.revision)&&(value.latest_snapshot_id===null||radarUuid(value.latest_snapshot_id))
    &&time(value.created_at)&&radarUuid(value.created_by)&&strings(value.affected_workflows,128)&&confirmedRadarRights(value.rights)
    &&radarUuid(m.id)&&m.tier==="MANUAL_REVIEW"&&m.retrieval_method==="SUPPLIED_DOCUMENT"&&m.enabled===false&&m.next_run_at===null;
}
export function confirmedRadarSnapshot(value:unknown,workspace:string,sourceId:string):value is RadarSnapshot {
  if(!object(value))return false;
  const ids=value.chunk_ids;
  return value.schema_version==="radar-snapshot/1"&&radarUuid(value.id)&&value.workspace_id===workspace&&value.source_id===sourceId
    &&whole(value.revision,1)&&radarUuid(value.document_id)&&radarUuid(value.version_id)&&hash(value.document_original_hash)
    &&whole(value.document_original_bytes,1)&&value.document_original_bytes<=originalPolicy.maximum_bytes
    &&Array.isArray(ids)&&ids.length>=1&&ids.length<=156&&ids.every(radarUuid)
    &&new Set(ids).size===ids.length&&hash(value.selection_hash)&&hash(value.normalized_hash)
    &&whole(value.selected_utf8_bytes,1)&&value.selected_utf8_bytes<=156*32768&&whole(value.stored_chunk_count,1)&&value.stored_chunk_count>=ids.length
    &&value.coverage==="SELECTED_CHUNKS_NOT_FULL_DOCUMENT"&&typeof value.comparison_complete==="boolean"
    &&time(value.captured_at)&&time(value.recorded_at)&&radarUuid(value.actor_id)&&radarUuid(value.change_id)
    &&Array.isArray(value.selected_originals)&&value.selected_originals.length===ids.length
    &&new Set(value.selected_originals.map(row=>object(row)?row.id:undefined)).size===ids.length
    &&value.selected_originals.every(row=>selection(row)&&row.document_id===value.document_id&&row.version_id===value.version_id&&ids.includes(row.id));
}
export function confirmedRadarChange(value:unknown,workspace:string,sourceId?:string):value is RadarChange {
  return object(value)&&value.schema_version==="radar-change/1"&&radarUuid(value.id)&&value.workspace_id===workspace&&radarUuid(value.source_id)
    &&(!sourceId||value.source_id===sourceId)&&(value.before_snapshot_id===null||radarUuid(value.before_snapshot_id))&&radarUuid(value.after_snapshot_id)
    &&(value.previous_hash===null||hash(value.previous_hash))&&hash(value.current_hash)
    &&Array.isArray(value.before_chunk_ids)&&value.before_chunk_ids.length<=156&&value.before_chunk_ids.every(radarUuid)
    &&new Set(value.before_chunk_ids).size===value.before_chunk_ids.length
    &&(value.previous_selection_hash===null||hash(value.previous_selection_hash))&&hash(value.current_selection_hash)
    &&["BASELINE","UNCHANGED","CHANGED","RIGHTS_BLOCKED"].includes(String(value.status))
    &&["NONE","EDITORIAL","OPERATIONAL","RIGHTS_REVIEW","SECURITY_REVIEW","REVIEW_REQUIRED"].includes(String(value.materiality))
    &&["NOT_REQUIRED","PENDING","APPROVED","CHANGES_REQUESTED"].includes(String(value.review_state))&&whole(value.review_revision)
    &&(value.finding_id===null||radarUuid(value.finding_id))&&time(value.created_at);
}
function selection(value:unknown):value is RadarSelection {
  return object(value)&&radarUuid(value.id)&&radarUuid(value.document_id)&&radarUuid(value.version_id)&&whole(value.chunk_index)
    &&hash(value.original_content_hash)&&whole(value.original_bytes,1)&&value.original_bytes<=32768;
}
function sameJson(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameJson(value,right[index]));
  return object(left)&&object(right)&&Object.keys(left).length===Object.keys(right).length
    &&Object.keys(left).every(key=>Object.hasOwn(right,key)&&sameJson(left[key],right[key]));
}
function sameOriginal(left:RadarSelection,right:RadarSelection):boolean {
  return left.id===right.id&&left.document_id===right.document_id&&left.version_id===right.version_id&&left.chunk_index===right.chunk_index
    &&left.original_content_hash===right.original_content_hash&&left.original_bytes===right.original_bytes&&sameJson(left.location,right.location);
}
export function confirmedRadarChangeDetail(value:unknown,workspace:string,id?:string):value is RadarChangeDetail {
  if(!confirmedRadarChange(value,workspace)||id&&value.id!==id||!object(value))return false;
  const before=value.before,after=value.after;
  if(before!==null&&!confirmedRadarSnapshot(before,workspace,value.source_id)||!confirmedRadarSnapshot(after,workspace,value.source_id))return false;
  return after.id===value.after_snapshot_id&&after.change_id===value.id&&(before===null?value.before_snapshot_id===null:before.id===value.before_snapshot_id)
    &&value.current_hash===after.normalized_hash&&value.current_selection_hash===after.selection_hash
    &&(before===null?value.previous_hash===null&&value.previous_selection_hash===null&&value.before_chunk_ids.length===0
      :value.before_chunk_ids.length>=1&&value.before_chunk_ids.every(id=>before.chunk_ids.includes(id))
        &&(value.before_chunk_ids.length!==before.chunk_ids.length||value.previous_hash===before.normalized_hash&&value.previous_selection_hash===before.selection_hash))
    &&typeof value.source_available==="boolean"&&confirmedRadarRights(value.rights)&&strings(value.affected_workflows,128)
    &&(value.before_text_preview===null||text(value.before_text_preview,4096))&&(value.after_text_preview===null||text(value.after_text_preview,4096))
    &&(value.source_available||value.before_text_preview===null&&value.after_text_preview===null)
    &&typeof value.preview_truncated==="boolean"&&value.coverage==="SELECTED_CHUNKS_NOT_FULL_DOCUMENT"
    &&object(value.selections)&&Array.isArray(value.selections.before)&&Array.isArray(value.selections.after)
    &&value.selections.before.every(selection)&&value.selections.after.every(selection)
    &&value.selections.before.length===value.before_chunk_ids.length&&value.selections.before.every(row=>value.before_chunk_ids.includes(row.id))
    &&value.selections.after.length===after.chunk_ids.length&&value.selections.after.every(row=>after.chunk_ids.includes(row.id))
    &&new Set(value.selections.before.map(row=>row.id)).size===value.selections.before.length
    &&new Set(value.selections.after.map(row=>row.id)).size===value.selections.after.length
    &&value.selections.before.every(row=>before!==null&&row.document_id===before.document_id&&row.version_id===before.version_id)
    &&value.selections.after.every(row=>row.document_id===after.document_id&&row.version_id===after.version_id)
    &&value.selections.before.every(row=>before!==null&&before.selected_originals.some(original=>sameOriginal(row,original)))
    &&value.selections.after.every(row=>after.selected_originals.some(original=>sameOriginal(row,original)))
    &&new Set([...value.selections.before,...value.selections.after].map(row=>row.id)).size<=156
    &&Array.isArray(value.reviews)&&value.reviews.length<=20&&whole(value.review_count,value.reviews.length)&&hash(value.review_history_hash)
    &&(value.reviews_next_after===null||whole(value.reviews_next_after,1))&&value.reviews.every(confirmedRadarReview);
}
export function confirmedRadarReview(review:unknown):review is RadarReview {
  return object(review)&&radarUuid(review.id)&&radarUuid(review.reviewer_id)&&whole(review.revision,1)
    &&["approved","changes_requested"].includes(String(review.decision))&&text(review.comment,4000)&&strings(review.affected_workflows,128)&&time(review.created_at);
}
export function confirmedRadarPage<T>(value:unknown,confirm:(item:unknown)=>item is T):value is RadarPage<T> {
  return object(value)&&Array.isArray(value.items)&&value.items.length<=50&&value.items.every(confirm)
    &&(value.next_after===null||radarUuid(value.next_after))&&new Set(value.items.map(item=>(item as {id:string}).id)).size===value.items.length;
}
export function confirmedRadarChunks(value:unknown,documentId:string,versionId?:string):value is RadarChunks {
  return object(value)&&value.schema_version==="radar-chunks/1"&&value.document_id===documentId&&radarUuid(value.version_id)
    &&(!versionId||value.version_id===versionId)&&hash(value.document_original_hash)&&whole(value.document_original_bytes,1)
    &&value.document_original_bytes<=originalPolicy.maximum_bytes&&whole(value.stored_chunk_count,1)
    &&confirmedRadarPage<RadarChunk>(value,(row):row is RadarChunk=>selection(row)&&object(row)&&row.document_id===documentId&&row.version_id===value.version_id
      &&text(row.preview,200)&&typeof row.preview_truncated==="boolean");
}
export function confirmedRadarRuns(value:unknown,workspace:string,monitorId?:string):value is RadarRunPage {
  return object(value)&&value.schema_version==="radar-run-list/1"&&confirmedRadarPage<RadarRun>(value,(row):row is RadarRun=>
    object(row)&&radarUuid(row.id)&&row.workspace_id===workspace&&radarUuid(row.monitor_id)&&(!monitorId||row.monitor_id===monitorId)
    &&["BASELINE","UNCHANGED","CHANGED","FAILED","RIGHTS_BLOCKED","QUOTA_EXHAUSTED","REVIEW_REQUIRED"].includes(String(row.status))
    &&(row.previous_hash===null||hash(row.previous_hash))&&(row.current_hash===null||hash(row.current_hash))
    &&(row.materiality===null||["NONE","EDITORIAL","OPERATIONAL","RIGHTS_REVIEW","SECURITY_REVIEW","REVIEW_REQUIRED"].includes(String(row.materiality)))
    &&time(row.started_at)&&(row.completed_at===null||time(row.completed_at))&&object(row.metadata)&&row.metadata.source_mode==="SUPPLIED_DOCUMENT"
    &&(row.metadata.reason_code==null||text(row.metadata.reason_code,128,1))
    &&[row.metadata.before_snapshot_id,row.metadata.after_snapshot_id,row.metadata.last_confirmed_snapshot_id].every(id=>id==null||radarUuid(id)));
}
export function confirmedRadarFindingCreation(value:unknown):value is RadarFindingCreation {
  return object(value)&&value.schema_version==="radar-finding-creation/1"&&radarUuid(value.workspace_id)&&radarUuid(value.finding_id)
    &&radarUuid(value.change_id)&&radarUuid(value.created_by)&&value.revision===1&&whole(value.expected_review_revision)
    &&text(value.title,160,1)&&hash(value.authored_markdown_hash)&&whole(value.authored_markdown_bytes);
}
