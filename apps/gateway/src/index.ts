import { errorResponse,PublicError } from "./errors.ts";
import { validateQuery } from "../../../packages/contracts/src/index.ts";
import { assertBindingEnvironment } from "../../../packages/domain/src/environment.ts";
export interface GatewayEnv { ENVIRONMENT:"dev"|"test"|"preview"|"canary"|"production"; DB_NAME:string; R2_NAME:string; VECTORIZE_NAME:string }
export default {
  async fetch(request:Request,env:GatewayEnv):Promise<Response>{
    const requestId=request.headers.get("cf-ray")??crypto.randomUUID();
    try{
      assertBindingEnvironment(env.ENVIRONMENT,[{environment:env.ENVIRONMENT,name:env.DB_NAME},{environment:env.ENVIRONMENT,name:env.R2_NAME},{environment:env.ENVIRONMENT,name:env.VECTORIZE_NAME}]);
      const url=new URL(request.url);
      if(url.pathname==="/health") return Response.json({status:"ok",environment:env.ENVIRONMENT},{headers:{"cache-control":"no-store","x-request-id":requestId}});
      if(request.method==="POST"&&/^\/api\/v2\/workspaces\/[^/]+\/query-runs$/.test(url.pathname)){
        const idempotency=request.headers.get("idempotency-key"); if(!idempotency) throw new PublicError("INVALID_SCOPE","Idempotency-Key is required.",400);
        const contentLength=Number(request.headers.get("content-length")??"0"); if(contentLength>64_000) throw new PublicError("RESOURCE_LIMIT_EXCEEDED","Request body is too large.",413);
        const query=validateQuery(await request.json());
        return Response.json({state:"validation_only",query},{status:501,headers:{"cache-control":"no-store","x-request-id":requestId}});
      }
      throw new PublicError("INVALID_SCOPE","Route is not available.",404);
    }catch(error){ return errorResponse(error,requestId); }
  }
};
