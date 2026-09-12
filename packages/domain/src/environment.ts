export type EnvironmentName="dev"|"test"|"preview"|"canary"|"production";
export interface BindingIdentity { environment:EnvironmentName; name:string }
export function assertBindingEnvironment(runtime:EnvironmentName, bindings:readonly BindingIdentity[]):void {
  for(const binding of bindings){
    if(binding.environment!==runtime) throw new Error(`CONFIGURATION_ERROR: ${binding.name} belongs to ${binding.environment}, not ${runtime}`);
    if(runtime==="production" && /(?:dev|test|preview|canary)(?:-|_|$)/i.test(binding.name)) throw new Error(`CONFIGURATION_ERROR: unsafe production binding ${binding.name}`);
  }
}
export function narrowDeadline(operationDeadline:string, tokenExpiry:string, now=new Date()):string {
  const deadline=Math.min(Date.parse(operationDeadline),Date.parse(tokenExpiry));
  if(!Number.isFinite(deadline)||deadline<=now.getTime()) throw new Error("AUTH_REQUIRED: deadline expired");
  return new Date(deadline).toISOString();
}
