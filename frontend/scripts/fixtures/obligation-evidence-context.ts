declare global {interface Window {__OBLIGATION_FIXTURE__:{workspace:string;actor:string}}}
export async function getApiHeaders(context:{workspaceId?:string|null;expectedUserId?:string|null}={}) {
  const current=window.__OBLIGATION_FIXTURE__;
  if(context.expectedUserId!==undefined&&context.expectedUserId!==current.actor||context.workspaceId!==undefined&&context.workspaceId!==current.workspace)
    throw Object.assign(new Error("The selected account or workspace changed."),{code:"AUTH_CONTEXT_CHANGED"});
  return {Authorization:`Bearer synthetic-obligation-browser:${current.actor}`,"x-workspace-id":current.workspace};
}
export function getStoredWorkspaceId(){return window.__OBLIGATION_FIXTURE__.workspace;}
export function setStoredWorkspaceId(workspaceId:string|null){void workspaceId;}
