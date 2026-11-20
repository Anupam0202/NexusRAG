// Retention runs (NX-16). A workspace owner or administrator sets a number of days; a run removes documents
// uploaded, and conversation content written, before that many days ago (nexus_retention_sweep says exactly what).
// The database does the removal under a lease, so two runs never overlap; documents it marks are erased by the
// deletion cron (document-deletion.js) like any other deleted document.

export const RETENTION_LEASE_SECONDS = 300;
export const RETENTION_DOCUMENT_BATCH = 25;

const post = (body) => ({ method: "POST", body: JSON.stringify(body) });
const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

/** What a person is told about one run; `failures` stays empty because a failed run throws instead. */
export function retentionReceipt(swept) {
  const documents = Array.isArray(swept?.documents) ? swept.documents.length : 0;
  return {
    workspace_deleted: false,
    cutoff: typeof swept?.cutoff === "string" ? swept.cutoff : null,
    documents_deleted: documents,
    // Hidden at once; their index entries, originals and rows are erased by the deletion cron.
    documents_pending_erasure: documents,
    documents_kept_for_radar: count(swept?.documents_kept_for_radar),
    chat_messages_deleted: count(swept?.chat_messages_deleted),
    chat_sessions_deleted: count(swept?.chat_sessions_deleted),
    chat_titles_cleared: count(swept?.chat_titles_cleared),
    workbench_runs_redacted: count(swept?.workbench_runs_redacted),
    research_runs_deleted: count(swept?.research_runs_deleted),
    runs_kept_for_findings: count(swept?.runs_kept_for_findings),
    more_remaining: swept?.more === true,
    failures: [],
  };
}

function checkSweep(swept) {
  if (!swept || typeof swept !== "object" || !Array.isArray(swept.documents) || typeof swept.more !== "boolean")
    throw Object.assign(new Error("The retention run could not be confirmed."), { status: 503, code: "RETENTION_UNCONFIRMED", retryable: true });
  return swept;
}

// One run under a lease already held. The lease is always handed back: after a complete run the next one is due
// in a day; after a partial or failed one, in an hour.
async function sweepUnderLease(env, db, { workspace, workerId, lease, days, actor = null, limit = RETENTION_DOCUMENT_BATCH }) {
  const finish = (succeeded) => db(env, "rpc/finish_retention_claim", post({ p_workspace: workspace, p_worker_id: workerId,
    p_lease_expires_at: lease, p_retention_days: days, p_succeeded: succeeded }));
  let swept;
  try {
    swept = checkSweep(await db(env, "rpc/nexus_retention_sweep", post({ p_workspace: workspace, p_worker_id: workerId,
      p_lease_expires_at: lease, p_limit: limit, p_actor: actor })));
  } catch (error) {
    await finish(false).catch(() => null);
    throw error;
  }
  await finish(!swept.more);
  return swept;
}

/**
 * Runs retention now for a workspace, for the owner or administrator `actor`. The database checks the role
 * again under the workspace lock.
 */
export async function runRetentionNow(env, { workspace, actor, workerId = `manual:${crypto.randomUUID()}` }, { db }) {
  const claim = await db(env, "rpc/claim_workspace_retention", post({ p_workspace: workspace, p_actor: actor,
    p_worker_id: workerId, p_lease_seconds: RETENTION_LEASE_SECONDS }));
  if (!claim) {
    const settings = (await db(env, `workspace_settings?workspace_id=eq.${workspace}&select=retention_enabled,retention_days&limit=1`))?.[0];
    if (!settings?.retention_enabled)
      throw Object.assign(new Error("Retention is off for this workspace. Turn it on and save before running it."), { status: 409, code: "RETENTION_DISABLED" });
    throw Object.assign(new Error("A retention run is already in progress for this workspace. Try again in a few minutes."), { status: 409, code: "RETENTION_RUNNING", retryable: true });
  }
  const swept = await sweepUnderLease(env, db, { workspace, workerId, lease: claim.retention_lease_expires_at,
    days: claim.retention_days, actor });
  return retentionReceipt(swept);
}

/**
 * The cron's part: runs at most `limit` workspaces whose run is due. A failure in one workspace is logged and
 * does not stop the cron; the workspace is tried again in an hour.
 */
export async function runDueRetention(env, { db, log = console.log, workerId = `cron:${crypto.randomUUID()}`, limit = 1 }) {
  let claimed;
  try {
    claimed = await db(env, "rpc/claim_retention_schedules", post({ p_worker_id: workerId, p_limit: limit,
      p_lease_seconds: RETENTION_LEASE_SECONDS }));
  } catch (error) {
    log(JSON.stringify({ event: "retention_run_failed", stage: "claim", code: error?.code || "UNKNOWN" }));
    return [];
  }
  const results = [];
  for (const claim of Array.isArray(claimed) ? claimed : []) {
    try {
      const receipt = retentionReceipt(await sweepUnderLease(env, db, { workspace: claim.workspace_id, workerId,
        lease: claim.retention_lease_expires_at, days: claim.retention_days }));
      log(JSON.stringify({ event: "retention_run", workspace_id: claim.workspace_id, documents: receipt.documents_deleted,
        messages: receipt.chat_messages_deleted, conversations: receipt.chat_sessions_deleted, more: receipt.more_remaining }));
      results.push({ workspace_id: claim.workspace_id, ...receipt });
    } catch (error) {
      log(JSON.stringify({ event: "retention_run_failed", stage: "sweep", workspace_id: claim.workspace_id, code: error?.code || "UNKNOWN" }));
    }
  }
  return results;
}

/** Turns the schedule on or off; the database checks the person's role. */
export async function setRetention(env, { workspace, actor, body }, { db }) {
  const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null;
  const enabled = body?.retention_enabled;
  const days = body?.retention_days;
  if (!keys || keys.some((key) => !["retention_enabled", "retention_days"].includes(key)) || typeof enabled !== "boolean"
      || (enabled && (!Number.isSafeInteger(days) || days < 1 || days > 3650))
      || (!enabled && days !== undefined && days !== null && !Number.isSafeInteger(days)))
    throw Object.assign(new Error("Choose retention on or off, and a number of days from 1 to 3650."), { status: 422, code: "INVALID_SCOPE" });
  return db(env, "rpc/nexus_set_retention", post({ p_workspace: workspace, p_actor: actor, p_enabled: enabled,
    p_days: enabled ? days : null }));
}
