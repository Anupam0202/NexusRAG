import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const key = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", FRONTEND_ORIGIN: "https://frontend.invalid" };

async function run(fields, idempotencyKey = key) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: url.pathname, method, body, query: url.searchParams });
    assert.equal(url.hostname, "supabase.invalid", "no real provider may process a synthetic test");
    if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return Response.json([{ role: "owner", workspace_id: workspace, user_id: user }]);
    if (url.pathname === "/rest/v1/workspace_settings" || url.pathname === "/rest/v1/documents") return Response.json([]);
    if (url.pathname === "/rest/v1/rpc/nexus_admit_account_operation")
      return Response.json({ state: "READY", credential_mode: "platform_trial", used: 1, limit: 5 });
    if (url.pathname === "/rest/v1/rpc/read_gateway_private_turn_context")
      return Response.json([{ workspace_id: body.p_workspace, session_id: body.p_session, revision: 0 }]);
    if (url.pathname === "/rest/v1/rpc/stage_gateway_private_turn")
      return Response.json([{ workspace_id: body.p_workspace, session_id: body.p_session, revision: 0, state: "STAGED" }]);
    if (url.pathname === "/rest/v1/rpc/commit_gateway_private_turn")
      return Response.json([{ workspace_id: body.p_workspace, session_id: body.p_session,
        revision: 1, state: "COMMITTED", messages_written: 2 }]);
    if (url.pathname === "/rest/v1/chat_sessions") {
      if (method === "GET") return Response.json([]);
      if (method === "POST") return Response.json(body);
      if (method === "PATCH") return Response.json([]);
    }
    if (url.pathname === "/rest/v1/chat_messages" || url.pathname === "/rest/v1/audit_events") return Response.json([]);
    throw new Error("Unexpected persistence route in synthetic identity test");
  };
  try {
    const response = await handle(new Request("https://gateway.invalid/api/v1/chat", {
      method: "POST", headers: { authorization: "Bearer synthetic.user.token", "content-type": "application/json",
        "X-Nexus-Workspace-Id": workspace, "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ question: "Synthetic fixture question", non_sensitive_attested: true, ...fields }),
    }), env);
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}

for (const [index, value] of ["", "not-a-uuid", "a".repeat(36), "-".repeat(36),
  "cccccccc-cccc-4ccc-8ccc-cccccccccccz", ` ${session}`, `${session} `, 42, false, true, [], {}, [session]].entries())
  test(`malformed session ${index} is denied before settings, quota or records`, async (t) => {
    const { response, body, calls } = await run({ session_id: value });
    t.diagnostic(JSON.stringify({ fixture: index, status: response.status,
      quota_calls: calls.filter(c => c.path.endsWith("nexus_admit_account_operation")).length,
      record_writes: calls.filter(c => c.method !== "GET" && !c.path.endsWith("nexus_admit_account_operation")).length }));
    assert.equal(response.status, 422);
    assert.equal(body.error.code, "INVALID_SCOPE");
    assert.equal(calls.length, 2);
    assert.equal(calls.some(c => c.method !== "GET"), false);
    assert.equal(body.metadata, undefined);
  });

for (const [index, idempotencyKey] of [`dddddddd-${"-".repeat(27)}`, `dddddddd-${"d".repeat(27)}`,
  "dddddddd-dddd-dddd-dddd-dddddddddddg"].entries())
  test(`malformed admission key ${index} cannot consume quota or create records`, async (t) => {
    const { response, body, calls } = await run({ session_id: session }, idempotencyKey);
    t.diagnostic(JSON.stringify({ fixture: index, status: response.status,
      quota_calls: calls.filter(c => c.path.endsWith("nexus_admit_account_operation")).length,
      record_writes: calls.filter(c => c.method !== "GET" && !c.path.endsWith("nexus_admit_account_operation")).length }));
    assert.equal(response.status, 400);
    assert.equal(body.error.code, "INVALID_SCOPE");
    assert.equal(calls.some(c => c.method !== "GET"), false);
    assert.equal(calls.some(c => c.path.endsWith("nexus_admit_account_operation")), false);
  });

for (const [index, fields] of [{}, { session_id: null }, { session_id: session }, { session_id: session.toUpperCase() }].entries())
  test(`valid/new session ${index} retains the correct canonical identity`, async () => {
    const { response, body, calls } = await run(fields, key.toUpperCase());
    assert.equal(response.status, 200);
    const selected = body.metadata.session_id;
    assert.match(selected, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    if (fields.session_id) assert.equal(selected, session);
    const admission = calls.find(c => c.path.endsWith("nexus_admit_account_operation"));
    assert.equal(admission.body.p_idempotency_key, key);
    const committed = calls.find(c => c.path.endsWith("commit_gateway_private_turn"));
    assert.equal(committed.body.p_session, selected);
    assert.equal(committed.body.p_revision, 0);
    assert.equal(committed.body.p_question, "Synthetic fixture question");
    assert.equal(committed.body.p_answer, body.answer);
    assert.equal(body.metadata.session_revision, 1);
    assert.equal(calls.some(c => /\/(chat_sessions|chat_messages)$/.test(c.path)), false);
    assert.equal(body.sources.length, 0);
    assert.equal(body.metadata.abstained, true);
  });

for (const [index, idempotencyKey] of [`dddddddd-${"-".repeat(27)}`, `dddddddd-${"d".repeat(27)}`].entries())
  test(`shared upload admission rejects malformed UUID ${index} before quota/storage`, async (t) => {
    const calls = [];
    t.mock.method(globalThis, "fetch", async (input, init = {}) => {
      const url = new URL(String(input)); calls.push(url.pathname);
      if (url.pathname === "/auth/v1/user") return Response.json({ id: user });
      if (url.pathname === "/rest/v1/workspace_members") return Response.json([{ role: "owner" }]);
      if (url.pathname === "/rest/v1/documents" && !init.method) return Response.json([]);
      throw new Error("Upload must not reach quota, storage or persistence for an invalid admission key");
    });
    const form = new FormData();
    form.set("file", new Blob(["Synthetic non-sensitive fixture text"], { type: "text/plain" }), "synthetic.txt");
    form.set("non_sensitive_attested", "true");
    form.set("data_classification", "non_sensitive");
    const response = await handle(new Request("https://gateway.invalid/api/v1/documents/upload", { method: "POST",
      headers: { authorization: "Bearer synthetic.user.token", "X-Nexus-Workspace-Id": workspace,
        "Idempotency-Key": idempotencyKey }, body: form }), env);
    assert.equal(response.status, 400, await response.clone().text());
    assert.equal((await response.json()).error.code, "INVALID_SCOPE");
    assert.deepEqual(calls, ["/auth/v1/user", "/rest/v1/workspace_members", "/rest/v1/documents"]);
  });
