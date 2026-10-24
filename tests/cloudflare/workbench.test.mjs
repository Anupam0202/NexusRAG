import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
const workspace = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const finding = "33333333-3333-4333-8333-333333333333";
const policy = "44444444-4444-4444-8444-444444444444";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_PUBLISHABLE_KEY: "synthetic-public",
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-secret" };
const request = (path, init = {}) => new Request(`https://gateway.invalid${path}`, {
  ...init, headers: { authorization: "Bearer synthetic", "x-workspace-id": workspace, ...init.headers },
});
function mock(t, role = "editor", onRpc = () => ({})) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input); calls.push({ url, init });
    const response = value => new Response(JSON.stringify(value), { status: 200 });
    if (url.pathname === "/auth/v1/user") return response({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return response([{ workspace_id: workspace, user_id: user, role }]);
    if (url.pathname === "/rest/v1/workspaces") return response([{ lifecycle_state: "active", capability_revision: 7 }]);
    if (url.pathname === "/rest/v1/workspace_settings") return response([{ active_policy_id: policy, policy_version: 9 }]);
    if (url.pathname.startsWith("/rest/v1/rpc/")) return onRpc(url, JSON.parse(init.body), response);
    throw Error(`Unexpected call ${url.pathname}`);
  });
  return calls;
}
test("finding list uses private record authorization, not a service-role table scan", async t => {
  mock(t, "viewer", (url, data, response) => {
    assert.equal(url.pathname, "/rest/v1/rpc/workbench_read");
    assert.equal(data.p_context.user_id, user);
    assert.equal(data.p_context.workspace_id, workspace);
    assert.equal(data.p_context.membership_revision, 7);
    assert.equal(data.p_context.policy_id, policy);
    assert.equal(data.p_resource, "findings");
    return response({ items: [], next_after: null });
  });
  assert.equal((await handle(request("/api/v2/findings"), env)).status, 200);
});
test("MCP finding lookup uses the same private record authorization", async t => {
  mock(t, "viewer", (url, data, response) => {
    assert.equal(url.pathname, "/rest/v1/rpc/workbench_read");
    assert.equal(data.p_context.user_id, user); return response({ items: [], next_after: null });
  });
  assert.equal((await handle(request("/api/v2/mcp/execute", { method: "POST",
    body: JSON.stringify({ operation: "finding_retrieval" }) }), env)).status, 200);
});
test("unsupported product aliases cannot masquerade as findings or exports", async t => {
  const calls = mock(t, "viewer");
  for (const path of ["/api/v2/obligations", "/api/v2/procurement", "/api/v2/passports"]) {
    assert.equal((await handle(request(path), env)).status, 501);
  }
  assert.equal(calls.some(call => /findings|evidence_exports/.test(call.url.pathname)), false);
});
test("viewer cannot create or mutate a finding", async t => {
  const calls = mock(t, "viewer");
  assert.equal((await handle(request("/api/v2/findings", { method: "POST", body: '{"title":"test"}' }), env)).status, 403);
  assert.equal(calls.some(call => call.url.pathname.includes("/rpc/nexus_finding")), false);
});
test("create binds trusted identity and rejects injected context fields", async t => {
  mock(t, "editor", (url, data, response) => {
    assert.equal(data.p_context.user_id, user);
    assert.equal(data.p_context.workspace_id, workspace);
    assert.equal(data.p_command.title, "Saved note");
    assert.equal(data.p_command.user_id, undefined);
    assert.equal(data.p_operation, "create");
    assert.match(data.p_hash, /^[a-f0-9]{64}$/);
    return response({ id: finding, revision: 1 });
  });
  const result = await handle(request("/api/v2/findings", { method: "POST", headers: { "Idempotency-Key": "stable-test" },
    body: JSON.stringify({ title: "Saved note", authored_markdown: "Authored only", workspace_id: finding, user_id: finding }) }), env);
  assert.equal(result.status, 201);
});
test("malformed, oversized, and missing-idempotency inputs fail before mutation", async t => {
  const calls = mock(t);
  for (const body of ["{", "[]", JSON.stringify({ title: "test", authored_markdown: "x".repeat(100_001) }), '{"title":"test"}']) {
    const response = await handle(request("/api/v2/findings", { method: "POST", body }), env);
    assert.ok([400, 413, 422].includes(response.status));
  }
  assert.equal(calls.some(call => call.url.pathname.includes("/rpc/nexus_finding")), false);
});
test("chunked finding overflow stops without waiting for the body end or mutating", async t => {
  const calls = mock(t);
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"title":"test","authored_markdown":"'));
      controller.enqueue(new TextEncoder().encode("x".repeat(100_001)));
    },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const result = await handle(request("/api/v2/findings", {
    method: "POST", body: stream, duplex: "half",
    headers: { "Idempotency-Key": "stream-overflow" },
  }), env);
  assert.equal(result.status, 413);
  assert.equal(cancelled, true);
  assert.equal(calls.some(call => call.url.pathname.includes("/rpc/nexus_finding")), false);
});
test("general chat JSON overflow fails before account reservation or persistence", async t => {
  const calls = mock(t);
  const result = await handle(request("/api/v1/chat", {
    method: "POST",
    body: JSON.stringify({ question: "x".repeat(100_001), non_sensitive_attested: true }),
  }), env);
  assert.equal(result.status, 413);
  assert.equal(calls.some(call => /account|chat_messages|chat_sessions|gemini/.test(call.url.pathname)), false);
});
test("edit requires a revision and propagates database conflict without leaking detail", async t => {
  mock(t, "editor", () => new Response(JSON.stringify({ message: "NR:VERSION_CONFLICT sensitive-server-detail" }), { status: 400 }));
  const path = `/api/v2/findings/${finding}`;
  const invalid = await handle(request(path, { method: "PATCH", body: '{"title":"test","authored_markdown":""}' }), env);
  assert.equal(invalid.status, 422);
  const conflict = await handle(request(path, { method: "PATCH", body: '{"title":"test","authored_markdown":"","revision":1}' }), env);
  assert.equal(conflict.status, 409);
  assert.doesNotMatch(await conflict.text(), /sensitive-server-detail/);
});
test("MCP capability discovery advertises only record-authorized runtime operations", async t => {
  mock(t);
  const response = await handle(request("/api/v2/mcp/operations"), env);
  const body = await response.json();
  assert.deepEqual(body.operations.map(item => item.name).sort(), ["claim_retrieval", "finding_retrieval"]);
  assert.ok(body.unavailable_operations.includes("obligation_lookup"));
});
test("member operations bind the actor, forbid viewer management, and validate role", async t => {
  const calls = mock(t, "owner", (url, data, response) => {
    assert.equal(url.pathname, "/rest/v1/rpc/nexus_manage_member");
    assert.equal(data.p_actor, user); assert.equal(data.p_workspace, workspace);
    assert.equal(data.p_role, "viewer"); return response({ user_id: finding, role: "viewer" });
  });
  assert.equal((await handle(request("/api/v1/workspaces/current/members", { method: "POST",
    body: JSON.stringify({ email_or_user_id: finding, role: "viewer", p_actor: finding }) }), env)).status, 201);
  assert.equal((await handle(request("/api/v1/workspaces/current/members", { method: "POST",
    body: JSON.stringify({ email_or_user_id: finding, role: "owner" }) }), env)).status, 422);
  assert.equal(calls.filter(call => call.url.pathname.includes("nexus_manage_member")).length, 1);
});
test("workspace creation is delegated to one idempotent atomic transaction", async t => {
  mock(t, "owner", (url, data, response) => {
    assert.equal(url.pathname, "/rest/v1/rpc/nexus_create_workspace");
    assert.equal(data.p_actor, user); assert.equal(data.p_key, "create-stable");
    return response({ id: workspace, role: "owner" });
  });
  const result = await handle(request("/api/v1/workspaces", { method: "POST",
    headers: { "Idempotency-Key": "create-stable" }, body: '{"name":"Test workspace","slug":"test-workspace"}' }), env);
  assert.equal(result.status, 201);
});
test("name-only workspace creation derives a stable, actor-scoped valid slug", async t => {
  const slugs = [];
  mock(t, "owner", (_url, data, response) => {
    assert.equal(data.p_actor, user);
    assert.match(data.p_slug, /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/);
    slugs.push(data.p_slug); return response({ id: workspace, role: "owner" });
  });
  for (let i = 0; i < 2; i++) assert.equal((await handle(request("/api/v1/workspaces", { method: "POST",
    headers: { "Idempotency-Key": "name-only" }, body: '{"name":"Research workspace"}' }), env)).status, 201);
  assert.equal(slugs[0], slugs[1]);
});
test("malformed finding routes are 404 responses, not invalid Worker returns", async t => {
  mock(t);
  assert.equal((await handle(request("/api/v2/findings/not-a-valid-id"), env)).status, 404);
});
test("every membership check restricts authority to active workspaces", async t => {
  const calls = mock(t, "viewer", (_url, _data, response) => response({ items: [], next_after: null }));
  await handle(request("/api/v2/findings"), env);
  const memberships = calls.filter(call => call.url.pathname === "/rest/v1/workspace_members");
  assert.ok(memberships.length);
  assert.ok(memberships.every(call => call.url.searchParams.get("workspaces.lifecycle_state") === "eq.active"));
});
test("document pages expose a cursor and never report a truncated sample as an exact inventory", async t => {
  t.mock.method(globalThis, "fetch", async input => {
    const url = new URL(input);
    const response = value => new Response(JSON.stringify(value));
    if (url.pathname === "/auth/v1/user") return response({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return response([{ role: "viewer" }]);
    assert.equal(url.pathname, "/rest/v1/documents");
    assert.equal(url.searchParams.get("limit"), "101");
    assert.equal(url.searchParams.get("order"), "id.asc");
    return response(Array.from({ length: 101 }, (_, index) => ({ id: `id-${index}`, filename: `doc-${index}.txt`, status: "ready" })));
  });
  const body = await (await handle(request("/api/v1/documents"), env)).json();
  assert.equal(body.documents.length, 100); assert.equal(body.total_is_exact, false);
  assert.equal(body.next_after, "id-99");
});
test("deletion cannot fabricate derived-data and outstanding-write receipts", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input); calls.push({ url, init });
    const response = value => new Response(JSON.stringify(value));
    if (url.pathname === "/auth/v1/user") return response({ id: user });
    if (url.pathname === "/rest/v1/workspace_members") return response([{ role: "owner" }]);
    if (url.pathname === "/rest/v1/documents") return response([{ id: finding, lifecycle_state: "deleting" }]);
    if (url.pathname === "/rest/v1/deletion_operations") return response([{ id: policy }]);
    if (url.pathname === "/rest/v1/deletion_targets") return response([{ id: user, kind: "derived_content_review", verified_at: null }]);
    throw Error("Unexpected cleanup call");
  });
  const result = await handle(request(`/api/v1/documents/${finding}/delete`, { method: "POST" }), env);
  assert.equal(result.status, 409);
  assert.equal((await result.json()).error.code, "DELETE_REVIEW_REQUIRED");
  assert.equal(calls.some(call => call.url.pathname === "/rest/v1/deletion_receipts"), false);
  assert.equal(calls.some(call => call.url.pathname.startsWith("/storage")), false);
});
test("health exposes only a validated source identity, not fabricated readiness", async () => {
  const sha = "a".repeat(40);
  const valid = await (await handle(request("/health"), { ...env, SOURCE_COMMIT: sha })).json();
  assert.equal(valid.source_commit, sha); assert.equal(valid.readiness, "NOT_PROBED");
  const invalid = await (await handle(request("/health"), { ...env, SOURCE_COMMIT: "not-a-commit" })).json();
  assert.equal(invalid.source_commit, null);
});

test("finding revocation is bound to the server actor and private-record RPC", async t => {
  mock(t, "editor", (url, data, response) => {
    assert.equal(url.pathname, "/rest/v1/rpc/nexus_finding");
    assert.equal(data.p_operation, "unshare"); assert.equal(data.p_context.user_id, user);
    assert.deepEqual(data.p_command, { user_id: policy }); return response({ id: finding });
  });
  const response = await handle(request(`/api/v2/findings/${finding}/unshare`, { method: "POST",
    body: JSON.stringify({ user_id: policy, actor_id: policy }) }), env);
  assert.equal(response.status, 200);
});
