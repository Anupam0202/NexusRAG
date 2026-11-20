import test from "node:test";
import assert from "node:assert/strict";
import { InvalidAccessToken, resetAccessTokenKeys, verifyAccessToken } from "../../apps/gateway/src/access-token.js";
import { handle, withinRequestLimit } from "../../apps/gateway/src/preview-worker.js";

const SUPABASE_URL = "https://project.supabase.invalid";
const env = { SUPABASE_URL };
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const NOW = Date.parse("2026-11-17T12:00:00Z");
const seconds = NOW / 1000;

const encode = (bytes) => Buffer.from(bytes).toString("base64url");
const json = (value) => encode(new TextEncoder().encode(JSON.stringify(value)));

async function keyPair(kid) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, alg: "ES256", use: "sig" } };
}

async function sign(key, claims = {}, header = {}) {
  const head = json({ alg: "ES256", kid: key.kid, typ: "JWT", ...header });
  const body = json({ iss: `${SUPABASE_URL}/auth/v1`, aud: "authenticated", role: "authenticated", sub: USER,
    iat: seconds - 60, exp: seconds + 3540, session_id: "s", ...claims });
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${encode(new Uint8Array(signature))}`;
}

/** The project's key list endpoint: `keys` is what it publishes now; `fail` makes it answer with an error. */
function keyList(keys) {
  const state = { keys, reads: 0, fail: false };
  state.fetchImpl = async (url) => {
    assert.equal(url, `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    state.reads += 1;
    if (state.fail) return new Response("unavailable", { status: 503 });
    return Response.json({ keys: state.keys.map((key) => key.jwk) });
  };
  return state;
}

test("a token signed with the project's published key gives its user, reading the key list once", async () => {
  resetAccessTokenKeys();
  const key = await keyPair("k1"), list = keyList([key]);
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(await verifyAccessToken(await sign(key), env, { fetchImpl: list.fetchImpl, now: NOW }), { id: USER });
  }
  assert.equal(list.reads, 1);
  // The list is read again after ten minutes, so a key Supabase retires stops being trusted.
  await verifyAccessToken(await sign(key), env, { fetchImpl: list.fetchImpl, now: NOW + 11 * 60 * 1000 });
  assert.equal(list.reads, 2);
});

test("a token that fails any check is refused, never handed on", async () => {
  resetAccessTokenKeys();
  const key = await keyPair("k1"), forger = await keyPair("k1"), list = keyList([key]);
  const valid = await sign(key);
  const [head, body] = valid.split(".");
  const cases = {
    "tampered claims": `${head}.${json({ ...JSON.parse(Buffer.from(body, "base64url")), sub: "11111111-1111-4111-8111-111111111111" })}.${valid.split(".")[2]}`,
    "signed by another key under the same id": await sign(forger),
    expired: await sign(key, { exp: seconds - 1 }),
    "another project's issuer": await sign(key, { iss: "https://other.supabase.invalid/auth/v1" }),
    "another audience": await sign(key, { aud: "service" }),
    "the service role": await sign(key, { role: "service_role" }),
    "no expiry": await sign(key, { exp: undefined }),
    "not yet valid": await sign(key, { nbf: seconds + 600 }),
    "issued in the future": await sign(key, { iat: seconds + 600 }),
    "a user id that is not one": await sign(key, { sub: "admin" }),
  };
  for (const [name, token] of Object.entries(cases)) {
    await assert.rejects(verifyAccessToken(token, env, { fetchImpl: list.fetchImpl, now: NOW }), InvalidAccessToken, name);
  }
  assert.deepEqual(await verifyAccessToken(await sign(key, { aud: ["authenticated", "other"] }), env, { fetchImpl: list.fetchImpl, now: NOW }), { id: USER });
});

test("a key Supabase rotates in is found by reading the list again, at most once a minute", async () => {
  resetAccessTokenKeys();
  const old = await keyPair("old"), rotated = await keyPair("new"), list = keyList([old]);
  await verifyAccessToken(await sign(old), env, { fetchImpl: list.fetchImpl, now: NOW });
  list.keys = [old, rotated];
  assert.deepEqual(await verifyAccessToken(await sign(rotated), env, { fetchImpl: list.fetchImpl, now: NOW + 1000 }), { id: USER });
  assert.equal(list.reads, 2);
  // A key the project does not publish is refused, and does not make every request read the list again.
  const stranger = await keyPair("stranger");
  await assert.rejects(verifyAccessToken(await sign(stranger), env, { fetchImpl: list.fetchImpl, now: NOW + 2000 }), InvalidAccessToken);
  await assert.rejects(verifyAccessToken(await sign(stranger), env, { fetchImpl: list.fetchImpl, now: NOW + 3000 }), InvalidAccessToken);
  assert.equal(list.reads, 2, "the list was read again for the rotated key within the minute, not for the stranger");
  await assert.rejects(verifyAccessToken(await sign(stranger), env, { fetchImpl: list.fetchImpl, now: NOW + 62_000 }), InvalidAccessToken);
  assert.equal(list.reads, 3);
});

test("a token this project's keys cannot check goes to Supabase Auth instead", async () => {
  resetAccessTokenKeys();
  const key = await keyPair("k1"), list = keyList([key]);
  const legacy = `${json({ alg: "HS256", typ: "JWT" })}.${json({ sub: USER })}.${encode(new Uint8Array(32))}`;
  for (const token of [legacy, "synthetic-oauth-token", "synthetic.user.token", "", `${json({ alg: "ES256" })}.e30.AA`]) {
    assert.equal(await verifyAccessToken(token, env, { fetchImpl: list.fetchImpl, now: NOW }), null, token);
  }
  list.fail = true;
  assert.equal(await verifyAccessToken(await sign(key), env, { fetchImpl: list.fetchImpl, now: NOW }), null, "an unreadable key list");
  assert.equal(await verifyAccessToken(await sign(key), env, { fetchImpl: async () => { throw new TypeError("network"); }, now: NOW + 11 * 60 * 1000 }), null);
});

test("the gateway answers a checked token without asking Supabase Auth, and refuses a forged one", async (t) => {
  resetAccessTokenKeys();
  const key = await keyPair("k1"), forger = await keyPair("k1"), list = keyList([key]);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith("/.well-known/jwks.json")) return list.fetchImpl(String(url), init);
    if (String(url).endsWith("/auth/v1/user")) return Response.json({ id: USER });
    throw new Error(`unexpected request ${url}`);
  });
  const gatewayEnv = { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic" };
  const ask = async (token) => handle(new Request("https://gateway.invalid/api/v2/capabilities", { headers: { authorization: `Bearer ${token}` } }), gatewayEnv);
  const now = Math.floor(Date.now() / 1000);
  const fresh = (signer) => sign(signer, { iat: now - 60, exp: now + 3540 });

  const answered = await ask(await fresh(key));
  assert.equal(answered.status, 200);
  assert.equal((await answered.json()).authenticated, true);
  assert.equal(calls.filter((url) => url.endsWith("/auth/v1/user")).length, 0);

  const forged = await ask(await fresh(forger));
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).error.code, "AUTH_REQUIRED");
  assert.equal(calls.filter((url) => url.endsWith("/auth/v1/user")).length, 0, "a forged token is not handed on");

  const opaque = await ask("synthetic-oauth-token");
  assert.equal(opaque.status, 200);
  assert.equal(calls.filter((url) => url.endsWith("/auth/v1/user")).length, 1, "other tokens still go to Supabase Auth");
});

test("a request needs both the isolate's count and Cloudflare's rate limiter to allow it", async (t) => {
  const keys = [];
  const limiter = (success) => ({ limit: async ({ key }) => { keys.push(key); return { success }; } });
  const user = `user-${crypto.randomUUID()}`;
  assert.equal(await withinRequestLimit({ USER_RATE_LIMITER: limiter(true) }, user), true);
  assert.equal(await withinRequestLimit({ USER_RATE_LIMITER: limiter(false) }, user), false, "Cloudflare's count refuses");
  assert.deepEqual(keys, [user, user], "the user is the key");
  const failing = { USER_RATE_LIMITER: { limit: async () => { throw new Error("unavailable"); } } };
  t.mock.method(console, "warn", () => {});
  assert.equal(await withinRequestLimit(failing, `fallback-${crypto.randomUUID()}`), true, "a limiter that fails leaves the isolate's count to decide");
  assert.match(console.warn.mock.calls[0].arguments[0], /"event":"rate_limiter_failed"/);
  for (const env of [{}, { USER_RATE_LIMITER: limiter(true) }]) {
    const burst = `burst-${crypto.randomUUID()}`;
    for (let index = 0; index < 60; index += 1) assert.equal(await withinRequestLimit(env, burst), true);
    assert.equal(await withinRequestLimit(env, burst), false, "the isolate refuses the sixty-first request in a minute even when Cloudflare's count allows it");
  }

  // Through the gateway: a refused request gets 429 with a retry time, before anything else is read.
  resetAccessTokenKeys();
  const key = await keyPair("k1"), list = keyList([key]);
  t.mock.method(globalThis, "fetch", async (url, init) => list.fetchImpl(String(url), init));
  const now = Math.floor(Date.now() / 1000);
  const token = await sign(key, { iat: now - 60, exp: now + 3540 });
  const response = await handle(new Request("https://gateway.invalid/api/v2/capabilities", { headers: { authorization: `Bearer ${token}` } }),
    { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic", USER_RATE_LIMITER: limiter(false) });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal((await response.json()).error.code, "TENANT_QUOTA_EXCEEDED");
});

