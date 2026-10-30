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
const receipt = (count = 3) => [{ workspace_id: workspace, session_id: session,
  success: true, durable_messages_deleted: count }];

async function clearWith(payload, { status = 200, raw = false, alternate = session } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    calls.push({ target, method: init.method || "GET", headers: init.headers, body: init.body });
    if (target.endsWith("/auth/v1/user")) return Response.json({ id: user });
    if (target.includes("/workspace_members?")) return Response.json([{ role: "viewer", user_id: user, workspace_id: workspace }]);
    if (target.endsWith("/rpc/clear_private_history")) return new Response(raw ? payload : JSON.stringify(payload), { status });
    // Reproduces a stale preflight that says owner; DB mutation must recheck authority.
    if (target.includes("/chat_sessions?")) return Response.json([{ id: session, user_id: user, revision: 1 }]);
    if (target.includes("/chat_messages?")) return Response.json([{ id: "synthetic-message" }]);
    throw new Error("Unexpected test request");
  };
  try {
    const response = await handle(new Request(`https://gateway.invalid/api/v1/chat/sessions/${alternate}/clear`, {
      method: "POST", headers: { authorization: "Bearer synthetic.user.token", "X-Nexus-Workspace-Id": workspace },
    }), env);
    return { response, body: await response.json(), calls };
  } finally { globalThis.fetch = original; }
}

test("private clear denial after stale owner preflight never becomes privileged deletion", async () => {
  const { response, body, calls } = await clearWith([]);
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "CONVERSATION_UNAVAILABLE");
  assert.equal(calls.some(c => c.method === "DELETE" || c.method === "PATCH"), false);
  assert.equal(calls.some(c => c.target.includes("/chat_sessions?")), false);
});

for (const count of [0, 3]) test(`owner clear accepts an exact durable ${count}-message receipt`, async () => {
  const { response, body, calls } = await clearWith(receipt(count));
  assert.equal(response.status, 200);
  assert.deepEqual(body, { success: true, durable_messages_deleted: count });
  const rpc = calls.filter(c => c.target.endsWith("/rpc/clear_private_history"));
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0].headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(rpc[0].headers.authorization, "Bearer synthetic.user.token");
  assert.deepEqual(JSON.parse(rpc[0].body), { p_workspace: workspace, p_session: session });
  assert.equal(calls.some(c => c.method === "DELETE" || c.method === "PATCH"), false);
});

for (const payload of [null, {}, [null], [true], [...receipt(), ...receipt()],
  [{ ...receipt()[0], workspace_id: "other" }], [{ ...receipt()[0], session_id: "other" }],
  [{ ...receipt()[0], success: false }],
  ...[null, true, -1, 1.5, "3", Number.MAX_SAFE_INTEGER + 1].map(receipt)]) {
  test(`private clear fails closed for ambiguous receipt ${JSON.stringify(payload)}`, async () => {
    const { response, body, calls } = await clearWith(payload);
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "CLEANUP_UNCONFIRMED");
    assert.equal(calls.some(c => c.method === "DELETE" || c.method === "PATCH"), false);
  });
}

test("private clear normalizes canonical UUID case", async () => {
  const { response, calls } = await clearWith(receipt(), { alternate: session.toUpperCase() });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(calls.find(c => c.target.endsWith("/rpc/clear_private_history")).body).p_session, session);
});

test("private clear never renders invalid JSON provider details or retries", async () => {
  const { response, body, calls } = await clearWith("private-provider-diagnostic", { raw: true });
  assert.equal(response.status, 503);
  assert.equal(body.error.code, "CLEANUP_UNCONFIRMED");
  assert.equal(JSON.stringify(body).includes("private-provider-diagnostic"), false);
  assert.equal(calls.filter(c => c.target.endsWith("/rpc/clear_private_history")).length, 1);
});

for (const status of [401, 403, 500]) test(`private clear upstream ${status} never retries with service credentials`, async () => {
  const { response, body, calls } = await clearWith({ secret: "private-provider-diagnostic" }, { status });
  assert.notEqual(response.status, 200);
  assert.equal(JSON.stringify(body).includes("private-provider-diagnostic"), false);
  assert.equal(calls.filter(c => c.target.endsWith("/rpc/clear_private_history")).length, 1);
  assert.equal(calls.some(c => c.method === "DELETE" || c.method === "PATCH"), false);
});
