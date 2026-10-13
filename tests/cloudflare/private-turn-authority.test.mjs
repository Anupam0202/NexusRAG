import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", FRONTEND_ORIGIN: "https://frontend.invalid" };
const context = () => [{ workspace_id: workspace, session_id: session, revision: 3 }];
const receipt = () => [{ workspace_id: workspace, session_id: session, revision: 4, state: "COMMITTED", messages_written: 2 }];

async function run(t, { read = context(), write = receipt(), readStatus = 200, writeStatus = 200,
  staged = [{ workspace_id: workspace, session_id: session, revision: 3, state: "STAGED" }], stageStatus = 200,
  rawRead = false, rawWrite = false, crash = false, cancel = false, upper = false, role = "owner" } = {}) {
  const calls = [], controller = new AbortController(); let memberReads = 0;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input)), body = init.body ? JSON.parse(init.body) : null;
    const path = url.pathname; calls.push({ path, body, headers: init.headers, method: init.method || "GET" });
    assert.equal(url.hostname, "supabase.invalid", "no live provider processing");
    if (path === "/auth/v1/user") return Response.json({ id: user });
    if (path.endsWith("workspace_members")) {
      if (++memberReads === 3 && cancel) controller.abort();
      return Response.json([{ role }]);
    }
    if (path.endsWith("workspace_settings") || path.endsWith("documents")) return Response.json([]);
    if (path.endsWith("read_gateway_private_turn_context")) return new Response(rawRead ? read : JSON.stringify(read), { status: readStatus });
    if (path.endsWith("stage_gateway_private_turn")) return Response.json(staged, { status: stageStatus });
    if (path.endsWith("commit_gateway_private_turn")) {
      if (crash) throw Error("Private transport detail must not be rendered");
      assert.equal(init.signal.aborted, false);
      return new Response(rawWrite ? write : JSON.stringify(write), { status: writeStatus });
    }
    if (path.endsWith("nexus_admit_account_operation")) return Response.json({ state: "READY", credential_mode: "platform_trial", used: 1, limit: 5 });
    if (path.endsWith("audit_events")) return Response.json([]);
    throw Error("Unfenced direct table access is forbidden in this fixture");
  });
  const response = await handle(new Request("https://gateway.invalid/api/v1/chat", { method: "POST", signal: controller.signal,
    headers: { authorization: "Bearer synthetic.user.token", "content-type": "application/json",
      "x-nexus-workspace-id": upper ? workspace.toUpperCase() : workspace, "idempotency-key": "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
    body: JSON.stringify({ question: "Synthetic non-sensitive question", session_id: upper ? session.toUpperCase() : session,
      non_sensitive_attested: true }),
  }), env);
  return { response, body: await response.json(), calls };
}

for (const role of ["owner", "admin", "editor"]) test(`legitimate ${role} turn uses caller authority and exact revision receipt`, async t => {
  const { response, body, calls } = await run(t, { role, upper: true });
  assert.equal(response.status, 200, JSON.stringify(body));
  const commit = calls.find(c => c.path.endsWith("commit_gateway_private_turn"));
  const read = calls.find(c => c.path.endsWith("read_gateway_private_turn_context"));
  for (const c of [read, commit]) {
    assert.equal(c.headers.apikey, "synthetic-public");
    assert.equal(c.headers.authorization, "Bearer synthetic.user.token");
    assert.equal(c.body.p_workspace, workspace); assert.equal(c.body.p_session, session);
    assert.equal(c.body.p_actor, undefined);
  }
  assert.equal(commit.body.p_revision, 3); assert.equal(body.metadata.session_revision, 4);
  assert.equal(commit.body.p_key, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(commit.body.p_question, "Synthetic non-sensitive question"); assert.equal(commit.body.p_answer, body.answer);
  assert.deepEqual(commit.body.p_sources, body.sources);
  const staged = calls.find(c => c.path.endsWith("stage_gateway_private_turn"));
  assert.equal(staged.headers.apikey, "synthetic-service");
  assert.equal(staged.body.p_actor, user);
  const { p_actor, ...attested } = staged.body;
  assert.equal(p_actor, user); assert.deepEqual(attested, commit.body);
  assert.ok(calls.indexOf(read) < calls.findIndex(c => c.path.endsWith("nexus_admit_account_operation")));
  assert.equal(calls.some(c => /\/(chat_sessions|chat_messages)$/.test(c.path)), false);
});

for (const [label, fields] of [
  ["missing attestation", { staged: [] }], ["wrong identity", { staged: [{ workspace_id: user, session_id: session, revision: 3, state: "STAGED" }] }],
  ["wrong revision", { staged: [{ workspace_id: workspace, session_id: session, revision: 4, state: "STAGED" }] }],
  ["failed staging", { staged: {}, stageStatus: 503 }],
]) test(`server ${label} never commits unverified assistant evidence`, async t => {
  const { response, body, calls } = await run(t, fields);
  assert.equal(response.status, 503); assert.equal(body.answer, undefined);
  assert.equal(calls.some(c => c.path.endsWith("commit_gateway_private_turn") || c.path.endsWith("audit_events")), false);
});

for (const [label, changes] of [
  ["revoked or foreign session", { read: [] }], ["non-array context", { read: {} }],
  ["wrong workspace", { read: [{ ...context()[0], workspace_id: user }] }],
  ["wrong session", { read: [{ ...context()[0], session_id: user }] }],
  ["string revision", { read: [{ ...context()[0], revision: "3" }] }],
  ["negative revision", { read: [{ ...context()[0], revision: -1 }] }],
  ["unsafe next revision", { read: [{ ...context()[0], revision: Number.MAX_SAFE_INTEGER - 1 }] }],
  ["duplicate rows", { read: [...context(), ...context()] }],
  ["malformed JSON", { read: "private not JSON", rawRead: true }],
  ["missing migration", { read: {}, readStatus: 404 }],
]) test(`context denies ${label} before quota and mutation`, async t => {
  const { response, body, calls } = await run(t, changes);
  assert.equal(response.status, Array.isArray(changes.read) && changes.read.length === 0 ? 404 : 503);
  assert.equal(calls.some(c => /nexus_admit_account_operation|commit_gateway_private_turn|audit_events/.test(c.path)), false);
  assert.equal(body.answer, undefined); assert.doesNotMatch(JSON.stringify(body), /private not JSON/);
});

for (const [label, changes] of [
  ["revocation after stale preflights", { write: [] }],
  ["clear or concurrent append", { write: [{ workspace_id: workspace, session_id: session, state: "CONFLICT" }] }],
  ["unbound conflict", { write: [{ workspace_id: user, session_id: session, state: "CONFLICT" }] }],
  ["wrong session", { write: [{ ...receipt()[0], session_id: user }] }],
  ["wrong revision", { write: [{ ...receipt()[0], revision: 5 }] }],
  ["partial write", { write: [{ ...receipt()[0], messages_written: 1 }] }],
  ["string count", { write: [{ ...receipt()[0], messages_written: "2" }] }],
  ["missing committed state", { write: [{ ...receipt()[0], state: undefined }] }],
  ["duplicate receipt", { write: [...receipt(), ...receipt()] }],
  ["object receipt", { write: receipt()[0] }],
  ["invalid JSON", { write: "private transport detail", rawWrite: true }],
  ["RPC failure", { write: {}, writeStatus: 500 }],
  ["network ambiguity", { crash: true }],
  ["cancellation before commit", { cancel: true }],
]) test(`commit rejects ${label} without success, audit or privileged retry`, async t => {
  const { response, body, calls } = await run(t, changes);
  assert.equal(response.status, label === "revocation after stale preflights" ? 404 : label === "clear or concurrent append" ? 409 : 503);
  assert.equal(body.answer, undefined); assert.doesNotMatch(JSON.stringify(body), /private transport detail/);
  assert.equal(calls.filter(c => c.path.endsWith("commit_gateway_private_turn")).length, changes.cancel ? 0 : 1);
  assert.equal(calls.some(c => c.path.endsWith("audit_events") || /\/(chat_sessions|chat_messages)$/.test(c.path)), false);
});
