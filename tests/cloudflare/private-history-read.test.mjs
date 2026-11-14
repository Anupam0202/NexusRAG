import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";

const workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const env = { SUPABASE_URL: "https://supabase.invalid",
  SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  FRONTEND_ORIGIN: "https://frontend.invalid" };
const message = (index = 0) => ({ workspace_id: workspace, session_id: session,
  role: index % 2 ? "assistant" : "user", content: `Synthetic history ${index}`,
  sources: [], metadata: {}, created_at: "2026-10-11T00:00:00Z" });
const projection = ({ role, content, sources, metadata, created_at }) =>
  ({ role, content, sources, metadata, created_at });

async function readWith(payload, { status = 200, raw = false, networkError = false,
  method = "GET", owner = true, alternate = session, scope = workspace } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, method: init.method || "GET", headers: init.headers, body: init.body });
    if (target.endsWith("/auth/v1/user")) return Response.json({ id: user });
    if (target.includes("/workspace_members?")) return Response.json([{ role: "viewer", user_id: user, workspace_id: workspace }]);
    if (target.endsWith("/rpc/read_gateway_private_history")) {
      if (networkError) throw new Error("private-provider-diagnostic");
      return new Response(raw ? payload : JSON.stringify(payload), { status });
    }
    // A stale owner check must not authorize a later privileged history read.
    if (target.includes("/chat_sessions?")) return Response.json(owner ? [{ id: session, user_id: user }] : []);
    if (target.includes("/chat_messages?")) return Response.json([projection(message())]);
    throw new Error("Unexpected test request");
  };
  try {
    const response = await handle(new Request(`https://gateway.invalid/api/v1/chat/sessions/${alternate}/messages`, {
      method, headers: { authorization: "Bearer synthetic.user.token", "X-Nexus-Workspace-Id": scope },
    }), env);
    const text = await response.text();
    return { response, body: text ? JSON.parse(text) : null, calls };
  } finally { globalThis.fetch = original; }
}

function assertCallerRead(calls) {
  const rpc = calls.filter(c => c.target.endsWith("/rpc/read_gateway_private_history"));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].method, "POST");
  assert.equal(rpc[0].headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(rpc[0].headers.authorization, "Bearer synthetic.user.token");
  assert.deepEqual(JSON.parse(rpc[0].body), { p_workspace: workspace, p_session: session });
  assert.equal(calls.some(c => c.target.includes("/chat_sessions?") || c.target.includes("/chat_messages?")), false);
}

test("history denial after stale authorization never restores privileged messages", async () => {
  const { response, body, calls } = await readWith([]);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { session_id: session, messages: [], total: 0 });
  assertCallerRead(calls);
});

for (const count of [1, 100, 101, 500]) test(`caller-authorized history preserves the ${count}-message window`, async () => {
  const rows = Array.from({ length: count }, (_, index) => message(index));
  const { response, body, calls } = await readWith(rows);
  assert.equal(response.status, 200);
  assert.deepEqual(body, { session_id: session, messages: rows.map(projection), total: count });
  assertCallerRead(calls);
});

test("database-authorized participant or legacy reader needs no gateway owner preflight", async () => {
  const { response, body, calls } = await readWith([message()], { owner: false });
  assert.equal(response.status, 200);
  assert.deepEqual(body.messages, [projection(message())]);
  assertCallerRead(calls);
});

const malformed = [null, {}, [null], [true], [{ ...message(), workspace_id: "other" }],
  [{ ...message(), session_id: "other" }], [{ ...message(), role: "unknown" }],
  [{ ...message(), content: null }], [{ ...message(), sources: {} }],
  [{ ...message(), metadata: null }], [{ ...message(), metadata: [] }],
  [{ ...message(), created_at: 123 }], [{ ...message(), workspace_id: undefined }],
  Array.from({ length: 501 }, (_, index) => message(index))];
for (const [index, payload] of malformed.entries()) test(`history rejects unconfirmed scoped projection ${index}`, async () => {
  const { response, body, calls } = await readWith(payload);
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "HISTORY_UNCONFIRMED");
  assert.equal(JSON.stringify(body).includes("Synthetic history"), false);
  assertCallerRead(calls);
});

test("history UUID scope is normalized without changing its API projection", async () => {
  const { response, calls } = await readWith([message()], { alternate: session.toUpperCase(), scope: workspace.toUpperCase() });
  assert.equal(response.status, 200);
  assertCallerRead(calls);
});

test("history HEAD uses caller authority and returns no response body", async () => {
  const { response, body, calls } = await readWith([message()], { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(body, null);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assertCallerRead(calls);
});

test("unsupported history methods never inspect private sessions or messages", async () => {
  const { response, calls } = await readWith([message()], { method: "POST" });
  assert.equal(response.status, 404);
  assert.equal(calls.some(c => /\/(chat_sessions|chat_messages)\?|\/rpc\/read_gateway_private_history$/.test(c.target)), false);
});

for (const options of [{ raw: true }, { networkError: true }, ...[401, 403, 500].map(status => ({ status }))]) {
  test(`history provider failure is static with no retry or service fallback ${JSON.stringify(options)}`, async () => {
    const { response, body, calls } = await readWith("private-provider-diagnostic", options);
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "HISTORY_UNCONFIRMED");
    assert.equal(JSON.stringify(body).includes("private-provider-diagnostic"), false);
    assertCallerRead(calls);
  });
}
