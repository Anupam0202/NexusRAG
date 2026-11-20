import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { removeSignIn } from "../../apps/gateway/src/account-deletion.js";
import { isSupabaseApiKey, serviceHeaders } from "../../apps/gateway/src/supabase-keys.js";

// Synthetic values only; neither is a real key.
const legacy = "eyJsynthetic.legacy.jwt", secret = "sb_secret_test";

test("a secret key goes in apikey only; a legacy service_role key also goes in Authorization", () => {
  assert.equal(isSupabaseApiKey(secret), true);
  assert.equal(isSupabaseApiKey(legacy), false);
  assert.equal(isSupabaseApiKey(undefined), false);
  assert.deepEqual(serviceHeaders({ SUPABASE_SERVICE_ROLE_KEY: secret }), { apikey: secret });
  assert.deepEqual(serviceHeaders({ SUPABASE_SERVICE_ROLE_KEY: legacy }), { apikey: legacy, authorization: `Bearer ${legacy}` });
  assert.deepEqual(serviceHeaders({ SUPABASE_SERVICE_ROLE_KEY: secret }, { "content-type": "application/json" }),
    { apikey: secret, "content-type": "application/json" });
});

test("Supabase Auth's admin API gets the secret key without a Bearer token", async () => {
  const seen = [];
  await removeSignIn({ SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: secret }, "22222222-2222-4222-8222-222222222222",
    async (_url, init) => { seen.push(init.headers); return new Response(null, { status: 200 }); });
  assert.deepEqual(seen, [{ apikey: secret }]);
});

const workspace = "11111111-1111-4111-8111-111111111111", user = "22222222-2222-4222-8222-222222222222";
const plan = "33333333-3333-4333-8333-333333333333";
for (const [kind, key] of [["secret", secret], ["legacy", legacy]]) test(`every database request of a gateway route carries a ${kind} key correctly`, async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input), json = value => new Response(JSON.stringify(value));
    calls.push({ path: url.pathname, headers: { ...init.headers } });
    if (url.pathname === "/auth/v1/user") return json({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return json([{ workspace_id: workspace, user_id: user, role: "editor" }]);
    if (url.pathname === "/rest/v1/workspaces") return json([{ lifecycle_state: "active", capability_revision: 1 }]);
    if (url.pathname === "/rest/v1/workspace_settings") return json([{ active_policy_id: "44444444-4444-4444-8444-444444444444", policy_version: 1 }]);
    if (url.pathname === "/rest/v1/rpc/nexus_research_run") return json({ items: [], next_after: null });
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic", SUPABASE_SERVICE_ROLE_KEY: key };
  const response = await handle(new Request(`https://gateway.invalid/api/v2/research/plans/${plan}/runs`,
    { headers: { authorization: "Bearer synthetic-user-token", "x-workspace-id": workspace } }), env);
  assert.equal(response.status, 200);
  const database = calls.filter(call => call.path.startsWith("/rest/v1/"));
  assert.ok(database.length >= 3);
  for (const call of database) {
    assert.equal(call.headers.apikey, key);
    assert.equal(call.headers.authorization, kind === "secret" ? undefined : `Bearer ${legacy}`, call.path);
  }
  // Checking the person's own token is unchanged: their token, with the publishable key.
  const auth = calls.find(call => call.path === "/auth/v1/user");
  assert.equal(auth.headers.apikey ?? auth.headers.Apikey, "sb_publishable_synthetic");
});
