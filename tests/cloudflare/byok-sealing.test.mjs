import test from "node:test";
import assert from "node:assert/strict";
import { encryptGeminiKey, loadUserGeminiKey, reencryptUserGeminiKeys } from "../../apps/gateway/src/user-gemini-key.js";

const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const first = Buffer.alloc(32, 7).toString("base64"), second = Buffer.alloc(32, 9).toString("base64");
const geminiKey = "AIza-synthetic-sealing-test";
const env = (current, previous) => ({ SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  GEMINI_USER_KEY_ENCRYPTION_SECRET: current, ...(previous ? { GEMINI_USER_KEY_ENCRYPTION_SECRET_PREVIOUS: previous } : {}) });
const secretId = async secret => Buffer.from(await crypto.subtle.digest("SHA-256", Buffer.from(secret, "base64"))).subarray(0, 8).toString("hex");

// How keys were sealed before version 2: one secret, constant associated data.
async function sealV1(secret, value) {
  const key = await crypto.subtle.importKey("raw", Buffer.from(secret, "base64"), "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: new TextEncoder().encode("nexusrag-user-gemini-key-v1") },
    key, new TextEncoder().encode(value));
  return { ciphertext: Buffer.from(sealed).toString("base64"), nonce: Buffer.from(nonce).toString("base64") };
}
// The vault table as the gateway reads it.
function vault(t, rows) {
  const patches = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(input), json = value => new Response(JSON.stringify(value));
    assert.equal(url.pathname, "/rest/v1/nexus_user_provider_keys");
    if ((init.method || "GET") === "GET") {
      const user = url.searchParams.get("user_id")?.slice(3);
      if (user) return json(rows.filter(row => row.user_id === user));
      const excluded = url.searchParams.get("ciphertext").replace(/^not\.like\./, "").replace(/\*$/, "");
      return json(rows.filter(row => !row.ciphertext.startsWith(excluded)));
    }
    const body = JSON.parse(init.body), match = rows.find(row => row.user_id === url.searchParams.get("user_id").slice(3)
      && row.ciphertext === url.searchParams.get("ciphertext").slice(3));
    patches.push({ user: url.searchParams.get("user_id").slice(3), body });
    if (!match || match.changedMeanwhile) return json([]);
    Object.assign(match, body);
    return json([match]);
  });
  return patches;
}
const record = (user, sealed) => ({ user_id: user, provider: "gemini", ...sealed, key_fingerprint: "…0000", is_active: true, cost_consent_at: "2026-11-14T00:00:00Z" });

test("a key is sealed for its user and opens only for that user", async t => {
  const sealed = await encryptGeminiKey(env(first), geminiKey, userA);
  assert.match(sealed.ciphertext, new RegExp(`^v2:${await secretId(first)}:`));
  vault(t, [record(userA, sealed), record(userB, sealed)]);
  assert.equal(await loadUserGeminiKey(env(first), userA), geminiKey);
  // The same ciphertext copied into another user's row does not open.
  await assert.rejects(loadUserGeminiKey(env(first), userB), { code: "KEY_VAULT_UNAVAILABLE" });
  await assert.rejects(encryptGeminiKey(env(first), geminiKey), { code: "KEY_VAULT_UNAVAILABLE" });
});

test("keys sealed before version 2 and keys sealed with the previous secret still open", async t => {
  vault(t, [record(userA, await sealV1(first, geminiKey)), record(userB, await encryptGeminiKey(env(first), geminiKey, userB))]);
  assert.equal(await loadUserGeminiKey(env(first), userA), geminiKey);
  // After a rotation the old secret is the previous one; without it neither key opens.
  assert.equal(await loadUserGeminiKey(env(second, first), userA), geminiKey);
  assert.equal(await loadUserGeminiKey(env(second, first), userB), geminiKey);
  await assert.rejects(loadUserGeminiKey(env(second), userA), { code: "KEY_VAULT_UNAVAILABLE" });
  await assert.rejects(loadUserGeminiKey(env(second), userB), { code: "KEY_VAULT_UNAVAILABLE" });
});

test("the daily sweep re-seals every other key with the current secret, never one changed meanwhile", async t => {
  const userC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", userD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const rows = [record(userA, await sealV1(first, geminiKey)), record(userB, await encryptGeminiKey(env(first), geminiKey, userB)),
    record(userC, await encryptGeminiKey(env(second), geminiKey, userC)), { ...record(userD, await sealV1(first, geminiKey)), changedMeanwhile: true }];
  const lines = [];
  t.mock.method(console, "log", line => lines.push(line));
  t.mock.method(console, "warn", line => lines.push(line));
  const patches = vault(t, rows);
  assert.deepEqual(await reencryptUserGeminiKeys(env(second, first)), { state: "CHECKED", reencrypted: 2, failed: 0, more: false });
  // The key already sealed with the current secret is not read again; the one changed meanwhile is not written.
  assert.deepEqual(patches.map(patch => patch.user), [userA, userB, userD]);
  const current = await secretId(second);
  for (const user of [userA, userB]) {
    assert.match(rows.find(row => row.user_id === user).ciphertext, new RegExp(`^v2:${current}:`));
    assert.equal(await loadUserGeminiKey(env(second), user), geminiKey);
  }
  assert.ok(lines.length === 1 && lines.every(line => ![userA, userB, userC, userD].some(user => line.includes(user))));
  assert.deepEqual(await reencryptUserGeminiKeys({ ...env(second), SUPABASE_URL: undefined }), { state: "NOT_CONFIGURED", reencrypted: 0, failed: 0, more: false });
});
