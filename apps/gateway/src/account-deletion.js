// Deleting an account (NX-27). The database part (nexus_begin_account_deletion) starts the deletion of every
// workspace the person owns and cleans up what they left in other people's workspaces; once no owned workspace is
// left, Supabase Auth's admin API removes the sign-in, and the profile, keys and usage go with it. What cannot
// finish within the request, the cron finishes.

import { finishWorkspaceDeletion } from "./workspace-deletion.js";

export const DELETE_ACCOUNT_CONFIRMATION = "DELETE MY ACCOUNT";
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const failure = (code, message, status = 503, retryable = true) => Object.assign(new Error(message), { code, status, retryable });

/** Removes the sign-in. An account that is already gone counts as removed. */
export async function removeSignIn(env, userId, fetchImpl = fetch) {
  const url = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
  const response = await fetchImpl(url, { method: "DELETE", signal: AbortSignal.timeout(8_000),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } })
    .catch(() => { throw failure("AUTH_DELETE_FAILED", "Supabase Auth did not answer."); });
  if (response.ok || response.status === 404) return;
  throw failure("AUTH_DELETE_FAILED", "Supabase Auth did not remove the sign-in.");
}

/**
 * Removes the sign-in once nothing the person owns is left. Returns { state: "DELETED" } or
 * { state: "PENDING", reason } while owned workspaces are still being erased.
 */
export async function finishAccountDeletion(env, userId, tools) {
  const status = await tools.db(env, "rpc/nexus_account_deletion_status", post({ p_user: userId }));
  if (status?.state === "VERIFIED") return { state: "DELETED" };
  if (status?.state !== "READY")
    return { state: "PENDING", reason: status?.state === "WAITING" ? "WORKSPACES_BEING_ERASED" : "NOT_FOUND" };
  await tools.removeSignIn(env, userId);
  const finished = await tools.db(env, "rpc/nexus_finish_account_deletion", post({ p_user: userId }));
  return finished?.state === "VERIFIED" ? { state: "DELETED" } : { state: "PENDING", reason: "UNCONFIRMED" };
}

/** The person's own request. Up to `inlineWorkspaces` owned workspaces are erased here; the cron does the rest. */
export async function deleteAccount(env, userId, tools, { inlineWorkspaces = 2 } = {}) {
  const begun = await tools.db(env, "rpc/nexus_begin_account_deletion", post({ p_user: userId }));
  if (begun?.state !== "STARTED") throw failure("ACCOUNT_UNAVAILABLE", "The account is unavailable.", 404, false);
  const workspaces = Array.isArray(begun.workspaces) ? begun.workspaces : [];
  for (const item of workspaces.slice(0, inlineWorkspaces)) {
    try {
      await finishWorkspaceDeletion(env, { workspace: item.workspace_id, operationId: item.operation_id }, tools);
    } catch { /* The workspace is already hidden; the cron finishes its erasure. */ }
  }
  let outcome;
  try {
    outcome = await finishAccountDeletion(env, userId, tools);
  } catch (error) {
    outcome = { state: "PENDING", reason: error?.code || "UNKNOWN" };
  }
  const deleted = outcome.state === "DELETED";
  return {
    account_deleted: true,
    state: deleted ? "DELETED" : "PENDING",
    workspaces_deleted: workspaces.length,
    removed: begun.removed && typeof begun.removed === "object" ? begun.removed : {},
    message: deleted
      ? "Your account and everything it owned were deleted."
      : "Your account is deleted and can no longer be used. What it owned is still being erased; this finishes on its own, usually within minutes.",
  };
}

/** Cron step: finishes account deletions that were waiting for their workspaces. Never throws. */
export async function sweepAccountDeletions(env, tools, limit = 1) {
  let claimed;
  try {
    claimed = await tools.db(env, "rpc/nexus_claim_account_deletions", post({ p_limit: limit }));
  } catch {
    return { state: "UNAVAILABLE", finished: 0, open: [] };
  }
  let finished = 0;
  const open = [];
  for (const userId of Array.isArray(claimed) ? claimed : []) {
    try {
      const result = await finishAccountDeletion(env, userId, tools);
      if (result.state === "DELETED") finished += 1;
      else open.push({ state: result.state, reason: result.reason || null });
    } catch (error) {
      open.push({ state: "FAILED", reason: error?.code || "UNKNOWN" });
    }
  }
  // Account ids stay out of the log; the record in the database says which account is waiting.
  if (open.length) console.warn(JSON.stringify({ event: "account_deletion_open", open }));
  return { state: "CHECKED", finished, open };
}
