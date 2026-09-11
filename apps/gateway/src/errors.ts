export type ErrorCode="AUTH_REQUIRED"|"FORBIDDEN"|"WORKSPACE_UNAVAILABLE"|"INVALID_SCOPE"|"VERSION_CONFLICT"|"TENANT_QUOTA_EXCEEDED"|"PROVIDER_RATE_LIMIT"|"PROVIDER_QUOTA_EXCEEDED"|"PROVIDER_AUTH_INVALID"|"PROVIDER_UNAVAILABLE"|"CONFIGURATION_ERROR"|"RESOURCE_LIMIT_EXCEEDED"|"INGESTION_FAILED"|"CANCELLED"|"PERSISTENCE_UNAVAILABLE"|"INTERNAL_ERROR";
export class PublicError extends Error { constructor(readonly code:ErrorCode,message:string,readonly status:number,readonly retryable=false,readonly retryAfterSeconds?:number){super(message)} }
export function errorResponse(error:unknown,requestId:string):Response {
  const e=error instanceof PublicError?error:new PublicError("INTERNAL_ERROR","The request could not be completed.",500,false);
  const headers=new Headers({"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff","x-request-id":requestId});
  if(e.retryAfterSeconds!==undefined) headers.set("retry-after",String(e.retryAfterSeconds));
  return new Response(JSON.stringify({error:{code:e.code,message:e.message,request_id:requestId,retryable:e.retryable,retry_after_seconds:e.retryAfterSeconds??null}}),{status:e.status,headers});
}
