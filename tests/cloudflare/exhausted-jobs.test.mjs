import test from "node:test";
import assert from "node:assert/strict";
import { handleQueue, sweepJobs } from "../../apps/gateway/src/worker-jobs.js";

const workspace = "30303030-3030-4030-8030-303030303030";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

/** Whether a row passes PostgREST's filters in a query string (the operators the job code uses). */
function holds(row, params) {
  for (const [column, filter] of params) {
    if (["select", "order", "limit"].includes(column)) continue;
    const dot = filter.indexOf("."), op = filter.slice(0, dot), operand = filter.slice(dot + 1), value = row[column];
    if (op === "eq" && String(value) !== operand) return false;
    if (op === "neq" && String(value) === operand) return false;
    if (op === "is" && operand === "null" && value != null) return false;
    if (op === "in" && !operand.slice(1, -1).split(",").includes(String(value))) return false;
    if (op === "lte" && !(Date.parse(value) <= Date.parse(operand))) return false;
  }
  return true;
}

/** A database with one document and its ingestion job, which has already used `attempts` of its three attempts. */
function database({ attempts, jobStatus = "processing", documentStatus = "processing", activeVersion = null }) {
  const document = { id: crypto.randomUUID(), workspace_id: workspace, status: documentStatus, active_version_id: activeVersion };
  const version = { id: crypto.randomUUID(), workspace_id: workspace, document_id: document.id, publication_state: "staged" };
  const job = { id: crypto.randomUUID(), workspace_id: workspace, document_id: document.id, version_id: version.id, lifecycle_epoch: 1,
    kind: "ingestion", status: jobStatus, attempts, max_attempts: 3, lease_generation: attempts, payload: { batch_offset: 0 },
    lease_expires_at: new Date(Date.now() - 60_000).toISOString(), available_at: new Date(Date.now() - 600_000).toISOString() };
  const tables = { ingestion_jobs: [job], document_versions: [version], documents: [document] };
  const sent = [];
  const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic",
    INGESTION_QUEUE: { send: async (message) => { sent.push(message); } } };
  const fetch = async (raw, init = {}) => {
    const url = new URL(String(raw)), table = url.pathname.replace("/rest/v1/", ""), method = init.method || "GET";
    const rows = (tables[table] || []).filter((row) => holds(row, url.searchParams));
    if (method === "PATCH") for (const row of rows) Object.assign(row, JSON.parse(init.body));
    return json(table.startsWith("rpc/") ? 0 : rows);
  };
  return { document, version, job, sent, env, fetch };
}

const delivered = (job) => ({ job_id: job.id, workspace_id: job.workspace_id, document_id: job.document_id, version_id: job.version_id, lifecycle_epoch: 1, batch_offset: 0 });

test("a job whose attempts ran out while its Worker kept stopping fails its document too, so it is not shown processing for ever", async (t) => {
  const state = database({ attempts: 3 });
  t.mock.method(globalThis, "fetch", state.fetch);
  const result = await sweepJobs(state.env);
  assert.equal(result.enqueued, 0);
  assert.deepEqual(state.sent, []);
  assert.deepEqual([state.job.status, state.job.error_code], ["failed", "LEASE_EXHAUSTED"]);
  assert.equal(state.version.publication_state, "failed");
  assert.equal(state.document.status, "failed", "the document shows an error instead of processing");
});

test("a queued message for a job without attempts left fails the job and its document, and is acknowledged", async (t) => {
  const state = database({ attempts: 3, jobStatus: "retry_wait", documentStatus: "queued" });
  t.mock.method(globalThis, "fetch", state.fetch);
  const outcome = [];
  await handleQueue({ messages: [{ body: delivered(state.job), ack() { outcome.push("ack"); }, retry() { outcome.push("retry"); } }] }, state.env);
  assert.deepEqual(outcome, ["ack"]);
  assert.deepEqual([state.job.status, state.version.publication_state, state.document.status], ["failed", "failed", "failed"]);
});

test("a failed re-index leaves a document that has a ready version usable", async (t) => {
  const state = database({ attempts: 3, documentStatus: "ready", activeVersion: crypto.randomUUID() });
  t.mock.method(globalThis, "fetch", state.fetch);
  await sweepJobs(state.env);
  assert.equal(state.job.status, "failed");
  assert.equal(state.document.status, "ready");
});

test("a job whose message went to the dead-letter queue with attempts left is sent again by the cron", async (t) => {
  // The queue gave up on the message, but the job's own record decides: its lease ran out, so the cron sends it again.
  const state = database({ attempts: 1 });
  t.mock.method(globalThis, "fetch", state.fetch);
  const result = await sweepJobs(state.env);
  assert.equal(result.enqueued, 1);
  assert.deepEqual(state.sent, [delivered(state.job)]);
  assert.equal(state.document.status, "processing");
});
