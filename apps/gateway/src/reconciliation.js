// The daily reconciliation (NX-27). File storage and the search index are filled and emptied in steps, so a crash
// or a store that lost data can leave them out of step with the database: a stored file or index entries that no
// row names (a deleted document's content that is still there), or a document whose original or passages are gone
// (it can no longer be downloaded, indexed again or answered from).
//
// The first cron run of each day counts these and writes one line to the Worker's log, which only the operator can
// read. It changes nothing and names nothing: scripts/reconciliation.py shows the details and removes leftovers
// when the operator asks. The database does the comparing (20261114120000_storage_reconciliation.sql).
import { indexEndpoint, indexFetch } from "./search-index.js";

// The index is asked for its versions in one request, to stay within a cron run's limits. A list this long may
// not be the whole index, and then nothing can be said about what is missing from it.
const VERSION_LIMIT = 1000;
const whole = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);

/** The versions the index holds entries of, as [{ value, count }], or why it could not be asked. */
async function indexedVersions(env, probe, fetchImpl) {
  if (probe?.state === "EMPTY") return { state: "CHECKED", versions: [], complete: true };
  if (probe?.state !== "READY") return { state: probe?.state || "NOT_CHECKED" };
  const { base, headers } = indexEndpoint(env);
  const response = await indexFetch(`${base}/facet`, {
    method: "POST", headers, body: JSON.stringify({ key: "version_id", limit: VERSION_LIMIT, exact: false }),
  }, 8_000, fetchImpl);
  const hits = response.ok ? (await response.json().catch(() => null))?.result?.hits : null;
  if (!response.ok) await response.body?.cancel().catch(() => {});
  // An index too old to count by field, or without the field's index, cannot be compared this way.
  if (!Array.isArray(hits)) return { state: "NOT_COUNTABLE", http_status: response.status };
  const versions = hits.filter((hit) => typeof hit?.value === "string").map((hit) => ({ value: hit.value, count: whole(hit.count) ?? 0 }));
  return { state: "CHECKED", versions, complete: hits.length < VERSION_LIMIT };
}

/**
 * Counts what is out of step and logs it as `store_reconciliation`: a warning when anything is, an ordinary line
 * when nothing is or a store could not be asked (the keep-alive already reports an index that does not answer).
 * `db` is the gateway's service-role database call; `probe` is what the index just answered to the keep-alive.
 * Never throws: a cron run must not fail because a report could not be made.
 */
export async function reconcileStores(env, { db, probe, fetchImpl = fetch } = {}) {
  const report = { event: "store_reconciliation", storage: "UNAVAILABLE", unreferenced_files: null, unreferenced_bytes: null,
    missing_originals: null, index: "NOT_CHECKED", orphaned_versions: null, orphaned_entries: null, unindexed_documents: null };
  try {
    const storage = await db(env, "rpc/nexus_storage_reconciliation", { method: "POST", body: JSON.stringify({ p_limit: 0 }) });
    report.unreferenced_files = whole(storage?.unreferenced_objects?.count);
    report.unreferenced_bytes = whole(storage?.unreferenced_objects?.bytes);
    report.missing_originals = whole(storage?.missing_originals?.count);
    if (report.unreferenced_files !== null && report.missing_originals !== null) report.storage = "CHECKED";
  } catch { /* reported as UNAVAILABLE */ }
  try {
    const indexed = await indexedVersions(env, probe, fetchImpl);
    report.index = indexed.state;
    if (indexed.state === "CHECKED") {
      const index = await db(env, "rpc/nexus_index_reconciliation", { method: "POST",
        body: JSON.stringify({ p_indexed: indexed.versions, p_complete: indexed.complete, p_limit: 0 }) });
      report.orphaned_versions = whole(index?.orphaned_entries?.versions);
      report.orphaned_entries = whole(index?.orphaned_entries?.entries);
      // Unknown when the list was not the whole index.
      report.unindexed_documents = whole(index?.unindexed_versions?.count);
      if (report.orphaned_versions === null) report.index = "UNAVAILABLE";
      else if (!indexed.complete) report.index = "PARTLY_CHECKED";
    }
  } catch { report.index = "UNAVAILABLE"; }
  const found = [report.unreferenced_files, report.missing_originals, report.orphaned_versions, report.unindexed_documents].some((count) => count > 0);
  const line = JSON.stringify(report);
  if (found) console.warn(line); else console.log(line);
  return report;
}
