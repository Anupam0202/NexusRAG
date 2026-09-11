export type UploadState="allocated"|"receiving"|"verified"|"aborted"|"cleanup_pending"|"deleted";
export interface UploadManifest { readonly workspaceId:string; readonly uploadId:string; readonly documentId:string; readonly versionId:string; readonly bucket:string; readonly objectKey:string; readonly expectedBytes:number; readonly expectedHash?:string; readonly actualBytes?:number; readonly actualHash?:string; readonly lifecycleEpoch:number; readonly state:UploadState }
const transitions:Readonly<Record<UploadState,ReadonlySet<UploadState>>>={allocated:new Set(["receiving","aborted"]),receiving:new Set(["verified","aborted","cleanup_pending"]),verified:new Set(["cleanup_pending"]),aborted:new Set(["cleanup_pending","deleted"]),cleanup_pending:new Set(["deleted"]),deleted:new Set()};
export function transitionUpload(current:UploadManifest,next:UploadState,actual?:{bytes:number;hash:string}):UploadManifest {
 if(!transitions[current.state].has(next)) throw new Error("INVALID_UPLOAD_TRANSITION");
 if(next==="verified"){
  if(!actual||actual.bytes!==current.expectedBytes||!/^[0-9a-f]{64}$/i.test(actual.hash)||(current.expectedHash&&actual.hash!==current.expectedHash)) throw new Error("UPLOAD_INTEGRITY_FAILED");
  return Object.freeze({...current,state:next,actualBytes:actual.bytes,actualHash:actual.hash});
 }
 return Object.freeze({...current,state:next});
}
export function mayCreateRunnableJob(upload:UploadManifest):boolean { return upload.state==="verified"&&upload.actualBytes===upload.expectedBytes&&!!upload.actualHash&&upload.actualHash.length===64; }
