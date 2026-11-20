// Finishes the deletion of a document that has been marked for it. Marking (tombstone_document) hides the
// document from lists and answers at once. What is still stored is removed here, in an order that cannot leave
// copies behind:
//   1. the database closes the document's unfinished jobs and says whether a step may still be writing;
//   2. the search index entries and the original file are removed, each verified before its receipt is written;
//   3. the database removes every row of the document and writes the remaining receipts in that transaction.
// A failure leaves the operation "blocked" and the cron tries again later, with a growing delay.

import { sha256 } from "./worker-pipeline.js";
import { deleteQdrantDocument } from "./worker-lifecycle.js";

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });

/**
 * Removes what a marked document still stores. `tools.db` is the service-role REST helper and
 * `tools.removeOriginal` deletes one stored original and verifies that it is gone.
 *
 * Returns how far the deletion got:
 *   { state: "VERIFIED", removed, receipts }   everything is gone and on record
 *   { state: "WAITING", retry_at }             a processing step may still be writing; nothing was removed
 *   { state: "BLOCKED", reason }               it cannot finish yet, for the reason given
 *   { state: "NOT_FOUND" }                     no such deletion
 * A provider or database failure is thrown after the operation has been marked "blocked".
 */
export async function finishDocumentDeletion(env, { workspace, documentId, operationId }, { db, removeOriginal }) {
  const identifiers = { p_workspace: workspace, p_document: documentId, p_operation: operationId };
  const begun = await db(env, "rpc/nexus_begin_document_purge", post(identifiers));
  if (begun?.state !== "READY") return typeof begun?.state === "string" ? begun : { state: "NOT_FOUND" };
  try {
    const targets = await db(env, `deletion_targets?workspace_id=eq.${workspace}&operation_id=eq.${operationId}&verified_at=is.null&kind=in.(original,version_index)&select=id,kind,object_key,attempts&order=kind.asc`) || [];
    let receipts = 0;
    const receipt = async (target, provider) => {
      const verifiedAt = new Date().toISOString();
      const receiptHash = await sha256(JSON.stringify({ workspace, operation_id: operationId, target_id: target.id, provider, verified_at: verifiedAt }));
      // A repeat after an interruption must not fail on the receipt that was already written.
      await db(env, "deletion_receipts?on_conflict=workspace_id,target_id,provider", {
        ...post([{ workspace_id: workspace, operation_id: operationId, target_id: target.id, provider, receipt_hash: receiptHash, verified_at: verifiedAt }]),
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
      });
      await db(env, `deletion_targets?id=eq.${target.id}`, { method: "PATCH", body: JSON.stringify({ attempts: Number(target.attempts || 0) + 1, verified_at: verifiedAt, failure_code: null }) });
      receipts += 1;
    };
    // Index entries are removed by document, not by version, so entries whose version left no record go too.
    await deleteQdrantDocument(env, workspace, documentId, "background");
    for (const target of targets.filter((item) => item.kind === "version_index")) await receipt(target, "qdrant");
    for (const target of targets.filter((item) => item.kind === "original")) {
      await removeOriginal(env, target.object_key);
      await receipt(target, "supabase_storage");
    }
    const purged = await db(env, "rpc/nexus_purge_document", post(identifiers));
    // The database counts every receipt on record, including those of earlier attempts.
    if (purged?.state === "VERIFIED") return { state: "VERIFIED", removed: purged.removed || {}, receipts: Number.isSafeInteger(purged.receipts) ? purged.receipts : receipts + 3 };
    return typeof purged?.state === "string" ? purged : { state: "BLOCKED", reason: "PURGE_UNCONFIRMED" };
  } catch (error) {
    await db(env, `deletion_operations?id=eq.${operationId}&state=neq.verified`, { method: "PATCH", body: JSON.stringify({ state: "blocked" }) }).catch(() => null);
    throw error;
  }
}

/**
 * Cron step: takes a few unfinished deletions from the database and tries to finish them. It never throws,
 * and it reports the ones that are still open so they show up in the Worker's log.
 */
export async function sweepDeletions(env, tools, limit = 2) {
  let claimed;
  try {
    claimed = await tools.db(env, "rpc/nexus_claim_document_purges", post({ p_limit: limit }));
  } catch {
    return { state: "UNAVAILABLE", finished: 0, open: [] };
  }
  let finished = 0;
  const open = [];
  for (const item of Array.isArray(claimed) ? claimed : []) {
    try {
      const result = await finishDocumentDeletion(env, { workspace: item.workspace_id, documentId: item.document_id, operationId: item.operation_id }, tools);
      if (result.state === "VERIFIED") finished += 1;
      else open.push({ operation_id: item.operation_id, state: result.state, reason: result.reason || null });
    } catch (error) {
      open.push({ operation_id: item.operation_id, state: "FAILED", reason: error?.code || "UNKNOWN" });
    }
  }
  if (open.length) console.warn(JSON.stringify({ event: "document_deletion_open", open }));
  return { state: "CHECKED", finished, open };
}
