export interface Candidate { workspaceId:string; documentId:string; versionId:string; lifecycleEpoch:number; contentHash:string; id:string }
export interface RetrievalSnapshot { workspaceId:string; documentIds:ReadonlySet<string>; versions:ReadonlyMap<string,string>; lifecycleEpochs:ReadonlyMap<string,number> }
export function authorizeCandidate(c:Candidate,s:RetrievalSnapshot):boolean {return c.workspaceId===s.workspaceId&&s.documentIds.has(c.documentId)&&s.versions.get(c.documentId)===c.versionId&&s.lifecycleEpochs.get(c.documentId)===c.lifecycleEpoch&&/^[0-9a-f]{64}$/i.test(c.contentHash)}
