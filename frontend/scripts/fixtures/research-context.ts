export async function getApiHeaders() {
  const actor = new URLSearchParams(window.location.search).get("actor") || "22222222-2222-4222-8222-222222222222";
  return { Authorization: `Bearer synthetic-research-browser:${actor}`, "x-workspace-id": "11111111-1111-4111-8111-111111111111" };
}
export function getStoredWorkspaceId() { return "11111111-1111-4111-8111-111111111111"; }
export function setStoredWorkspaceId(workspaceId: string | null) { void workspaceId; }
