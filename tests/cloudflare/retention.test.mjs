import test from "node:test";
import assert from "node:assert/strict";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";
import { retentionReceipt, runDueRetention, runRetentionNow, setRetention } from "../../apps/gateway/src/retention.js";

const workspace = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const lease = "2026-11-13T12:05:00.123456+00:00";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-secret" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const swept = (patch = {}) => ({
  cutoff: "2026-10-14T12:00:00+00:00",
  documents: [{ document_id: "d1000000-0000-4000-8000-000000000001", operation_id: "0d100000-0000-4000-8000-000000000001" }],
  documents_kept_for_radar: 1, chat_messages_deleted: 12, chat_sessions_deleted: 2, chat_titles_cleared: 1,
  workbench_runs_redacted: 3, research_runs_deleted: 1, runs_kept_for_findings: 2, retry_copies_deleted: 1, more: false, ...patch,
});

// The service-role database as retention.js sees it: answers by path, and remembers what was asked.
function database(answers) {
  const calls = [];
  const db = async (_env, path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, body });
    const answer = answers[path.split("?")[0]];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(body) : answer;
  };
  return { db, calls, paths: () => calls.map((call) => call.path.split("?")[0]) };
}

test("a manual run sweeps under the lease it was handed and hands it back", async () => {
  const store = database({
    "rpc/claim_workspace_retention": { workspace_id: workspace, retention_days: 30, retention_lease_owner: "manual:x", retention_lease_expires_at: lease },
    "rpc/nexus_retention_sweep": swept(),
    "rpc/finish_retention_claim": true,
  });
  const receipt = await runRetentionNow(env, { workspace, actor: user, workerId: "manual:x" }, { db: store.db });
  assert.deepEqual(store.paths(), ["rpc/claim_workspace_retention", "rpc/nexus_retention_sweep", "rpc/finish_retention_claim"]);
  assert.deepEqual(store.calls[0].body, { p_workspace: workspace, p_actor: user, p_worker_id: "manual:x", p_lease_seconds: 300 });
  assert.deepEqual(store.calls[1].body, { p_workspace: workspace, p_worker_id: "manual:x", p_lease_expires_at: lease, p_limit: 25, p_actor: user });
  assert.deepEqual(store.calls[2].body, { p_workspace: workspace, p_worker_id: "manual:x", p_lease_expires_at: lease, p_retention_days: 30, p_succeeded: true });
  assert.deepEqual(receipt, {
    workspace_deleted: false, cutoff: "2026-10-14T12:00:00+00:00", documents_deleted: 1, documents_pending_erasure: 1,
    documents_kept_for_radar: 1, chat_messages_deleted: 12, chat_sessions_deleted: 2, chat_titles_cleared: 1,
    workbench_runs_redacted: 3, research_runs_deleted: 1, runs_kept_for_findings: 2, more_remaining: false, failures: [],
  });
});

test("a run that leaves more for later is recorded as partial, so the next one comes in an hour", async () => {
  const store = database({
    "rpc/claim_workspace_retention": { workspace_id: workspace, retention_days: 7, retention_lease_expires_at: lease },
    "rpc/nexus_retention_sweep": swept({ more: true }),
    "rpc/finish_retention_claim": true,
  });
  const receipt = await runRetentionNow(env, { workspace, actor: user, workerId: "manual:y" }, { db: store.db });
  assert.equal(receipt.more_remaining, true);
  assert.equal(store.calls.at(-1).body.p_succeeded, false);
});

test("a manual run that cannot start says why", async () => {
  const off = database({ "rpc/claim_workspace_retention": null, workspace_settings: [{ retention_enabled: false, retention_days: 30 }] });
  await assert.rejects(runRetentionNow(env, { workspace, actor: user }, { db: off.db }), { status: 409, code: "RETENTION_DISABLED" });
  const busy = database({ "rpc/claim_workspace_retention": null, workspace_settings: [{ retention_enabled: true, retention_days: 30 }] });
  await assert.rejects(runRetentionNow(env, { workspace, actor: user }, { db: busy.db }), { status: 409, code: "RETENTION_RUNNING" });
  assert.equal(busy.paths().includes("rpc/nexus_retention_sweep"), false);
});

test("a failed or unreadable sweep still hands the lease back", async () => {
  for (const [answer, code] of [[Object.assign(new Error("storage"), { status: 503, code: "PERSISTENCE_UNAVAILABLE" }), "PERSISTENCE_UNAVAILABLE"],
    [{ documents: "not a list" }, "RETENTION_UNCONFIRMED"]]) {
    const store = database({
      "rpc/claim_workspace_retention": { workspace_id: workspace, retention_days: 30, retention_lease_expires_at: lease },
      "rpc/nexus_retention_sweep": answer,
      "rpc/finish_retention_claim": true,
    });
    await assert.rejects(runRetentionNow(env, { workspace, actor: user }, { db: store.db }), { code });
    assert.deepEqual(store.calls.at(-1), { path: "rpc/finish_retention_claim", body: { p_workspace: workspace,
      p_worker_id: store.calls[0].body.p_worker_id, p_lease_expires_at: lease, p_retention_days: 30, p_succeeded: false } });
  }
});

test("the cron runs one due workspace for its owner and logs what it removed", async () => {
  const logged = [];
  const store = database({
    "rpc/claim_retention_schedules": [{ workspace_id: workspace, retention_days: 30, retention_lease_expires_at: lease }],
    "rpc/nexus_retention_sweep": swept(),
    "rpc/finish_retention_claim": true,
  });
  const results = await runDueRetention(env, { db: store.db, log: (line) => logged.push(JSON.parse(line)), workerId: "cron:z" });
  assert.deepEqual(store.calls[0].body, { p_worker_id: "cron:z", p_limit: 1, p_lease_seconds: 300 });
  // No person asked: the database acts for the workspace owner.
  assert.equal(store.calls[1].body.p_actor, null);
  assert.equal(results.length, 1);
  assert.deepEqual(logged, [{ event: "retention_run", workspace_id: workspace, documents: 1, messages: 12, conversations: 2, more: false }]);
});

test("a cron failure is logged without stopping the cron or naming more than the workspace", async () => {
  const logged = [];
  const failing = database({
    "rpc/claim_retention_schedules": [{ workspace_id: workspace, retention_days: 30, retention_lease_expires_at: lease }],
    "rpc/nexus_retention_sweep": Object.assign(new Error("relation does not exist"), { code: "PERSISTENCE_UNAVAILABLE" }),
    "rpc/finish_retention_claim": true,
  });
  assert.deepEqual(await runDueRetention(env, { db: failing.db, log: (line) => logged.push(JSON.parse(line)) }), []);
  assert.equal(failing.calls.at(-1).body.p_succeeded, false);
  const unreachable = database({ "rpc/claim_retention_schedules": Object.assign(new Error("down"), { code: "PERSISTENCE_UNAVAILABLE" }) });
  assert.deepEqual(await runDueRetention(env, { db: unreachable.db, log: (line) => logged.push(JSON.parse(line)) }), []);
  assert.deepEqual(logged, [
    { event: "retention_run_failed", stage: "sweep", workspace_id: workspace, code: "PERSISTENCE_UNAVAILABLE" },
    { event: "retention_run_failed", stage: "claim", code: "PERSISTENCE_UNAVAILABLE" },
  ]);
});

test("the schedule accepts only on or off and a number of days from 1 to 3650", async () => {
  const store = database({ "rpc/nexus_set_retention": (body) => ({ retention_enabled: body.p_enabled, retention_days: body.p_days ?? 30 }) });
  for (const body of [null, [], { retention_enabled: "yes", retention_days: 30 }, { retention_enabled: true }, { retention_enabled: true, retention_days: 0 },
    { retention_enabled: true, retention_days: 3651 }, { retention_enabled: true, retention_days: 1.5 }, { retention_enabled: true, retention_days: 30, extra: 1 }]) {
    await assert.rejects(setRetention(env, { workspace, actor: user, body }, { db: store.db }), { status: 422, code: "INVALID_SCOPE" }, JSON.stringify(body));
  }
  assert.equal(store.calls.length, 0);
  await setRetention(env, { workspace, actor: user, body: { retention_enabled: true, retention_days: 90 } }, { db: store.db });
  // The privacy page sends 0 days when it turns retention off; the stored number is kept for next time.
  await setRetention(env, { workspace, actor: user, body: { retention_enabled: false, retention_days: 0 } }, { db: store.db });
  assert.deepEqual(store.calls.map((call) => call.body), [
    { p_workspace: workspace, p_actor: user, p_enabled: true, p_days: 90 },
    { p_workspace: workspace, p_actor: user, p_enabled: false, p_days: null },
  ]);
});

test("a receipt never reports a negative or made-up count", () => {
  const receipt = retentionReceipt({ documents: [], more: false, chat_messages_deleted: -4, chat_sessions_deleted: "2" });
  assert.equal(receipt.chat_messages_deleted, 0);
  assert.equal(receipt.chat_sessions_deleted, 0);
  assert.equal(receipt.documents_deleted, 0);
});

// The routes, through the gateway, for a member with `role`.
function gateway(role, rpc = {}) {
  const seen = [];
  const fetch = async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    const method = init.method || "GET";
    seen.push({ method, path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role }]);
    if (url.pathname === "/rest/v1/workspace_settings")
      return json([{ retention_enabled: true, retention_days: 30, last_retention_at: null, next_retention_at: "2026-11-14T00:00:00+00:00" }]);
    if (url.pathname === "/rest/v1/audit_events") return json([]);
    const name = url.pathname.replace("/rest/v1/rpc/", "");
    if (name in rpc) return typeof rpc[name] === "function" ? rpc[name](JSON.parse(init.body)) : json(rpc[name]);
    throw new Error(`unexpected request: ${method} ${url.pathname}`);
  };
  return { fetch, seen };
}
const headers = { authorization: "Bearer synthetic-user-token", "x-nexus-workspace-id": workspace, "content-type": "application/json" };
const call = (path, method = "GET", body) => handle(new Request(`https://gateway.invalid${path}`, { method, headers, body: body && JSON.stringify(body) }), env);

test("the privacy page is told retention can be changed and run", async (t) => {
  t.mock.method(globalThis, "fetch", gateway("viewer").fetch);
  const body = await (await call("/api/v1/privacy/settings")).json();
  assert.deepEqual(body, { retention_enabled: true, retention_days: 30, last_retention_at: null, next_retention_at: "2026-11-14T00:00:00+00:00",
    retention_mutation_supported: true, workspace_deletion_supported: false });
});

test("only an owner or administrator changes or runs retention", async (t) => {
  for (const role of ["editor", "viewer"]) {
    const backend = gateway(role);
    t.mock.method(globalThis, "fetch", backend.fetch);
    for (const [path, method, body] of [["/api/v1/privacy/settings", "PATCH", { retention_enabled: true, retention_days: 30 }], ["/api/v1/privacy/retention/run", "POST"]]) {
      const response = await call(path, method, body);
      assert.equal(response.status, 403, `${role} ${method} ${path}`);
      assert.equal((await response.json()).error.code, "FORBIDDEN");
    }
    assert.equal(backend.seen.some((request) => request.path.startsWith("/rest/v1/rpc/")), false, "the database was not asked");
  }
});

test("an administrator saves the schedule and runs it, and both are audited", async (t) => {
  const backend = gateway("admin", {
    nexus_set_retention: (body) => json({ retention_enabled: body.p_enabled, retention_days: body.p_days, last_retention_at: null, next_retention_at: "2026-11-13T12:00:00+00:00" }),
    claim_workspace_retention: { workspace_id: workspace, retention_days: 14, retention_lease_expires_at: lease },
    nexus_retention_sweep: swept({ more: true }),
    finish_retention_claim: true,
  });
  t.mock.method(globalThis, "fetch", backend.fetch);
  const saved = await call("/api/v1/privacy/settings", "PATCH", { retention_enabled: true, retention_days: 14 });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { retention_enabled: true, retention_days: 14, last_retention_at: null, next_retention_at: "2026-11-13T12:00:00+00:00",
    retention_mutation_supported: true, workspace_deletion_supported: false });
  const run = await call("/api/v1/privacy/retention/run", "POST");
  assert.equal(run.status, 200);
  const receipt = await run.json();
  assert.deepEqual([receipt.documents_deleted, receipt.chat_messages_deleted, receipt.more_remaining, receipt.failures], [1, 12, true, []]);
  assert.deepEqual(backend.seen.filter((request) => request.path === "/rest/v1/audit_events").map((request) => request.body[0].action),
    ["privacy.retention_update", "privacy.retention_run"]);
});

test("the database's refusal reaches the person as a refusal", async (t) => {
  t.mock.method(globalThis, "fetch", gateway("owner", {
    nexus_set_retention: () => json({ code: "P0001", message: "NR:FORBIDDEN" }, 400),
  }).fetch);
  const response = await call("/api/v1/privacy/settings", "PATCH", { retention_enabled: true, retention_days: 30 });
  assert.equal(response.status, 403);
  const invalid = await call("/api/v1/privacy/settings", "PATCH", { retention_enabled: true, retention_days: 0 });
  assert.equal(invalid.status, 422);
});

test("every cron run asks whether a retention run is due", async (t) => {
  const asked = [];
  t.mock.method(globalThis, "fetch", async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    if (url.pathname === "/rest/v1/rpc/claim_retention_schedules") asked.push(JSON.parse(init.body).p_limit);
    return json([]);
  });
  t.mock.method(console, "warn", () => {});
  for (const scheduledTime of [Date.UTC(2026, 10, 13, 0, 0), Date.UTC(2026, 10, 13, 9, 35)]) {
    const waited = [];
    scheduled({ scheduledTime }, { ...env, QDRANT_URL: "", QDRANT_API_KEY: "" }, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
    await Promise.all(waited);
  }
  assert.deepEqual(asked, [1, 1]);
});
