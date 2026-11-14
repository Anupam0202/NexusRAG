// Deleting a workspace (NX-16). The owner's request marks it `deleting`, which hides it from every member at once.
// Then, in an order that cannot leave copies behind:
//   1. the database stops the workspace's jobs and says whether one may still be writing;
//   2. the search index entries and the stored originals are removed, each verified before its receipt is written;
//   3. one database function removes every row of the workspace and writes the last receipt in that transaction.
// What cannot finish within the request is finished by the cron, with a growing delay between attempts.
//
// Removal is never metered against the workspace's provider budget: a deletion must not wait for a quota.

import { sha256 } from "./worker-pipeline.js";
import { indexEndpoint, indexFetch } from "./search-index.js";
import { serviceHeaders } from "./supabase-keys.js";

export const DELETE_WORKSPACE_CONFIRMATION = "DELETE WORKSPACE";
const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const failure = (code, message, status = 503, retryable = true) => Object.assign(new Error(message), { code, status, retryable });

/** Marks the workspace for deletion; only its owner may. Returns the deletion's operation id. */
export async function beginWorkspaceDeletion(env, { workspace, actor }, { db }) {
  const started = await db(env, "rpc/nexus_begin_workspace_deletion", post({ p_workspace: workspace, p_actor: actor }));
  if (started?.state !== "STARTED" || typeof started.operation_id !== "string")
    throw failure("WORKSPACE_UNAVAILABLE", "The workspace is unavailable.", 404, false);
  return started.operation_id;
}

/**
 * Removes the workspace's index entries: every point whose payload names the workspace. Counts them first, so
 * the receipt says how many went, and verifies that none is left.
 */
export async function removeWorkspaceIndexEntries(env, workspace, fetchImpl = fetch) {
  const { base, headers } = indexEndpoint(env);
  const filter = { must: [{ key: "workspace_id", match: { value: workspace } }] };
  const count = async () => {
    const response = await indexFetch(`${base}/points/count`, { method: "POST", headers, body: JSON.stringify({ exact: true, filter }) }, 8_000, fetchImpl);
    if (response.status === 404) return 0; // No collection, nothing stored.
    const value = response.ok ? (await response.json().catch(() => null))?.result?.count : null;
    if (!Number.isSafeInteger(value) || value < 0) throw failure("QDRANT_DELETE_UNVERIFIED", "The search index did not confirm what it holds for this workspace.");
    return value;
  };
  const before = await count();
  if (before > 0) {
    const response = await indexFetch(`${base}/points/delete?wait=true`, { method: "POST", headers, body: JSON.stringify({ filter }) }, 8_000, fetchImpl);
    if (!response.ok && response.status !== 404) throw failure("QDRANT_DELETE_FAILED", "The search index did not delete this workspace's entries.");
    if (await count() !== 0) throw failure("QDRANT_DELETE_UNVERIFIED", "The search index still holds entries of this workspace.");
  }
  return { points_removed: before };
}

/**
 * Removes the workspace's stored originals: first every key the database knows of, in batches, then anything
 * else still listed under the workspace's folder (a file whose upload stopped before its row was written).
 * Verified by listing the folder, which must be empty.
 */
export async function removeWorkspaceOriginals(env, workspace, keys = [], fetchImpl = fetch) {
  const storage = `${String(env.SUPABASE_URL).replace(/\/+$/, "")}/storage/v1/object`;
  const headers = serviceHeaders(env, { "content-type": "application/json" });
  const call = (url, init) => fetchImpl(url, { ...init, headers, signal: AbortSignal.timeout(8_000) })
    .catch(() => { throw failure("STORAGE_DELETE_FAILED", "File storage did not answer."); });
  const own = [...new Set(keys.filter((key) => typeof key === "string" && key.startsWith(`${workspace}/`)))];
  let removed = 0;
  const remove = async (batch) => {
    for (let start = 0; start < batch.length; start += 1000) {
      const response = await call(`${storage}/documents`, { method: "DELETE", body: JSON.stringify({ prefixes: batch.slice(start, start + 1000) }) });
      if (!response.ok) throw failure("STORAGE_DELETE_FAILED", "File storage did not delete this workspace's files.");
      const deleted = await response.json().catch(() => []);
      removed += Array.isArray(deleted) ? deleted.length : 0;
    }
  };
  const list = async (prefix) => {
    const response = await call(`${storage}/list/documents`, { method: "POST", body: JSON.stringify({ prefix, limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } }) });
    const items = response.ok ? await response.json().catch(() => null) : null;
    if (!Array.isArray(items)) throw failure("STORAGE_DELETE_UNVERIFIED", "File storage did not list this workspace's folder.");
    return items;
  };
  if (own.length) await remove(own);
  // Keys are workspace/document/version/file. A folder is listed with no id; a bounded walk finds the files.
  let budget = 12;
  const leftovers = [];
  const walk = async (prefix, depth) => {
    if (budget-- <= 0) throw failure("STORAGE_DELETE_UNVERIFIED", "This workspace's folder holds more than one request can remove; the cron goes on.");
    for (const item of await list(prefix)) {
      if (typeof item?.name !== "string" || !item.name) continue;
      if (item.id) leftovers.push(`${prefix}/${item.name}`);
      else if (depth < 3) await walk(`${prefix}/${item.name}`, depth + 1);
    }
  };
  try {
    await walk(workspace, 0);
  } catch (error) {
    // What was found is removed now, so the next attempt has less to walk.
    if (leftovers.length) await remove(leftovers);
    throw error;
  }
  if (leftovers.length) {
    await remove(leftovers);
    if ((await list(workspace)).length) throw failure("STORAGE_DELETE_UNVERIFIED", "File storage still lists files of this workspace.");
  }
  return { objects_removed: removed };
}

/**
 * Finishes a workspace deletion that has begun. Returns
 *   { state: "VERIFIED", removed, receipts }   everything is gone and on record
 *   { state: "WAITING", retry_at }             a job may still be writing; nothing was removed
 *   { state: "BLOCKED", reason }               it cannot finish yet
 *   { state: "NOT_FOUND" }                     no such deletion
 * A provider or database failure is thrown after the operation has been marked "blocked".
 */
export async function finishWorkspaceDeletion(env, { workspace, operationId }, tools) {
  const { db } = tools;
  const identifiers = { p_workspace: workspace, p_operation: operationId };
  const begun = await db(env, "rpc/nexus_begin_workspace_purge", post(identifiers));
  if (begun?.state !== "READY") return typeof begun?.state === "string" ? begun : { state: "NOT_FOUND" };
  try {
    const receipt = async (target, provider, inventory) => {
      const verifiedAt = new Date().toISOString();
      const receiptHash = await sha256(JSON.stringify({ workspace, operation_id: operationId, target_id: target.id, provider, verified_at: verifiedAt, inventory }));
      await db(env, "deletion_receipts?on_conflict=workspace_id,target_id,provider", {
        ...post([{ workspace_id: workspace, operation_id: operationId, target_id: target.id, provider, receipt_hash: receiptHash, verified_at: verifiedAt }]),
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      });
      await db(env, `deletion_targets?id=eq.${target.id}`, { method: "PATCH",
        body: JSON.stringify({ attempts: Number(target.attempts || 0) + 1, verified_at: verifiedAt, failure_code: null, inventory }) });
    };
    const removed = {};
    for (const target of Array.isArray(begun.targets) ? begun.targets : []) {
      if (target.kind === "workspace_index") {
        Object.assign(removed, await tools.removeIndexEntries(env, workspace));
        await receipt(target, "qdrant", { points_removed: removed.points_removed });
      } else if (target.kind === "workspace_originals") {
        Object.assign(removed, await tools.removeOriginals(env, workspace, Array.isArray(begun.originals) ? begun.originals : []));
        await receipt(target, "supabase_storage", { objects_removed: removed.objects_removed });
      }
    }
    const purged = await db(env, "rpc/nexus_purge_workspace", post(identifiers));
    if (purged?.state === "VERIFIED")
      return { state: "VERIFIED", removed: { ...removed, ...(purged.removed || {}) }, receipts: purged.receipts };
    return typeof purged?.state === "string" ? purged : { state: "BLOCKED", reason: "PURGE_UNCONFIRMED" };
  } catch (error) {
    await db(env, `deletion_operations?id=eq.${operationId}&state=neq.verified`, { method: "PATCH", body: JSON.stringify({ state: "blocked" }) }).catch(() => null);
    throw error;
  }
}

/** What the owner is told. The workspace is gone for everyone in both cases; only the erasure may still run. */
export function workspaceDeletionReceipt(outcome, operationId) {
  const removed = outcome?.state === "VERIFIED" ? outcome.removed || {} : {};
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  const done = outcome?.state === "VERIFIED";
  return {
    workspace_deleted: true,
    state: done ? "DELETED" : "PENDING",
    operation_id: operationId,
    documents_deleted: count(removed.documents),
    chat_sessions_deleted: count(removed.chat_sessions),
    local_chunks_deleted: count(removed.chunks),
    qdrant_chunks_deleted: count(removed.points_removed),
    receipts: done ? count(outcome.receipts) : 0,
    failures: [],
    message: done
      ? "The workspace and everything in it were deleted."
      : "The workspace is deleted for everyone. Its stored data is still being erased; this finishes on its own, usually within minutes.",
  };
}

/** Cron step: finishes workspace deletions that could not finish when they were asked for. Never throws. */
export async function sweepWorkspaceDeletions(env, tools, limit = 1) {
  let claimed;
  try {
    claimed = await tools.db(env, "rpc/nexus_claim_workspace_purges", post({ p_limit: limit }));
  } catch {
    return { state: "UNAVAILABLE", finished: 0, open: [] };
  }
  let finished = 0;
  const open = [];
  for (const item of Array.isArray(claimed) ? claimed : []) {
    try {
      const result = await finishWorkspaceDeletion(env, { workspace: item.workspace_id, operationId: item.operation_id }, tools);
      if (result.state === "VERIFIED") finished += 1;
      else open.push({ operation_id: item.operation_id, state: result.state, reason: result.reason || null });
    } catch (error) {
      open.push({ operation_id: item.operation_id, state: "FAILED", reason: error?.code || "UNKNOWN" });
    }
  }
  if (open.length) console.warn(JSON.stringify({ event: "workspace_deletion_open", open }));
  return { state: "CHECKED", finished, open };
}
