import test from "node:test";
import assert from "node:assert/strict";
import { metered } from "../../apps/gateway/src/quota.js";
import { assessAnswer } from "../../apps/gateway/src/answer-evidence.js";
import { indexChunks } from "../../apps/gateway/src/worker-pipeline.js";
const workspaceId = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "synthetic-test-only" };
const context = { workspaceId, provider: "gemini", priority: "interactive" };
function mockRpc(admit = "READY") {
  const calls = []; let sequence = 0;
  const fetch = async (url, init) => {
    const payload = JSON.parse(init.body); calls.push({ url, payload });
    const result = url.endsWith("v6_reserve_many") ? { state: admit, reservations: admit === "READY" ?
      Object.values(payload.p_dimensions).map(amount => ({ id: `11111111-1111-4111-8111-${String(++sequence).padStart(12,"0")}`, amount })) : undefined } :
      { state: payload.p_provider_called ? "SETTLED" : "RELEASED" };
    return new Response(JSON.stringify(result), { status: 200 });
  };
  return { fetch, calls };
}
test("missing batch quota RPC fails closed before provider call", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("not found", { status: 404 }));
  let called = false;
  await assert.rejects(metered(env, context, { requests: 1 }, async () => { called = true; }), e => e.code === "MIGRATION_REQUIRED");
  assert.equal(called, false);
});
test("exhaustion denies without calling provider", async t => {
  const rpc = mockRpc("QUOTA_EXHAUSTED"); t.mock.method(globalThis, "fetch", rpc.fetch);
  let called = false;
  await assert.rejects(metered(env, context, { requests: 1, input_tokens: 100 }, async () => { called = true; }), e => e.code === "QUOTA_EXHAUSTED" && e.status === 429);
  assert.equal(called, false); assert.equal(rpc.calls.length, 1);
});
test("replayed active reservations never authorize a second provider call", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, payload: JSON.parse(init.body) });
    return new Response(JSON.stringify({ state: "RESERVATION_IN_PROGRESS", replayed: true, reservations: [] }), { status: 200 });
  });
  let called = false;
  await assert.rejects(metered(env, context, { requests: 1 }, async () => { called = true; }), e => e.code === "RESERVATION_IN_PROGRESS" && e.status === 409);
  assert.equal(called, false);
  assert.equal(calls.length, 1);
});
test("one atomic admission and one settlement for multiple dimensions", async t => {
  const rpc = mockRpc(); t.mock.method(globalThis, "fetch", rpc.fetch);
  assert.equal(await metered(env, context, { requests:1, input_tokens:100, output_tokens:20 }, async () => "ok"), "ok");
  assert.equal(rpc.calls.length,2);
  assert.equal(rpc.calls[0].payload.p_dimensions.input_tokens,100);
  assert.equal(rpc.calls[1].payload.p_reservations.length,3);
  assert.equal(rpc.calls[1].payload.p_provider_called,true);
});
test("provider errors charge conservative admitted maximum", async t => {
  const rpc = mockRpc(); t.mock.method(globalThis, "fetch", rpc.fetch);
  await assert.rejects(metered(env, context, { requests:1 }, async () => { throw Error("timeout"); }), /timeout/);
  assert.equal(rpc.calls.at(-1).payload.p_provider_called, true);
});
test("citation presence cannot certify semantic support", () => {
  const sources = [{ content: "Evidence about one claim" }];
  assert.equal(assessAnswer("Unsupported claim [S1]", sources).claim_state, "REVIEW_REQUIRED");
  assert.equal(assessAnswer("Uncited assertion", sources).claim_state, "UNSUPPORTED");
  assert.equal(assessAnswer("Invalid source [S9]", sources).abstained, true);
});

test("oversized Worker ingestion fails before provider work", async t => {
  const calls = []; t.mock.method(globalThis, "fetch", async (...args) => { calls.push(args); throw Error("must not fetch"); });
  await assert.rejects(indexChunks(env, { workspaceId, documentId:workspaceId, versionId:workspaceId,
    generation:"test", filename:"too-large.txt", chunks:[{},{},{},{}] }), e => e.code === "CAPACITY_REACHED");
  assert.equal(calls.length,0);
});
