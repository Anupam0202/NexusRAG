import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../../apps/gateway/src/preview-worker.js";
import { loadUserGeminiKey } from "../../apps/gateway/src/user-gemini-key.js";
import { generateAnswer } from "../../apps/gateway/src/worker-pipeline.js";

const userId = "20202020-2020-4020-8020-202020202020";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test("account Gemini key is validated, encrypted at rest, masked on read, and decrypts only server-side", async (t) => {
  const user = { id: userId };
  const saved = new Map();
  const rawKey = "AIzaSyntheticPrivateUserKey000000000000";
  const env = {
    SUPABASE_URL: "https://supabase.invalid",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
    GEMINI_USER_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  };
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, headers: new Headers(init.headers || {}) });
    if (url.hostname === "supabase.invalid" && url.pathname === "/auth/v1/user") return json(user);
    if (url.hostname === "supabase.invalid" && url.pathname.startsWith("/rest/v1/nexus_user_provider_keys")) {
      if (init.method === "POST") {
        const row = JSON.parse(init.body)[0];
        saved.set(row.user_id, row);
        return json([row], 201);
      }
      if (!init.method || init.method === "GET") return json(saved.has(userId) ? [saved.get(userId)] : []);
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      assert.equal(url.searchParams.get("key"), null, "the provider key must not appear in the URL");
      assert.equal(new Headers(init.headers).get("x-goog-api-key"), rawKey);
      return json({ models: [{ name: "models/gemini-2.5-flash" }] });
    }
    throw new Error(`Unexpected network call: ${url.href}`);
  });

  const saveResponse = await handle(new Request("https://gateway.invalid/api/v1/apikey", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    body: JSON.stringify({ api_key: rawKey, cost_consent: true }),
  }), env);
  assert.equal(saveResponse.status, 200, await saveResponse.clone().text());
  const responseBody = await saveResponse.json();
  assert.equal(responseBody.workspace_key_configured, true);
  assert.equal(responseBody.key_fingerprint, "…0000");
  assert.equal(JSON.stringify(responseBody).includes(rawKey), false);
  assert.ok(saved.get(userId).ciphertext);
  assert.ok(saved.get(userId).nonce);
  assert.ok(Number.isFinite(Date.parse(saved.get(userId).cost_consent_at)));
  assert.notEqual(saved.get(userId).ciphertext, rawKey);
  assert.equal(JSON.stringify(saved.get(userId)).includes(rawKey), false);

  const statusResponse = await handle(new Request("https://gateway.invalid/api/v1/apikey", {
    headers: { authorization: "Bearer synthetic-token" },
  }), env);
  assert.equal(statusResponse.status, 200, await statusResponse.clone().text());
  assert.equal(JSON.stringify(await statusResponse.json()).includes(rawKey), false);
  assert.equal(await loadUserGeminiKey(env, userId), rawKey);
  assert.ok(calls.every((call) => !call.url.includes(rawKey)));
});

test("account Gemini key cannot trigger Google validation without explicit billing consent", async (t) => {
  const env = {
    SUPABASE_URL: "https://supabase.invalid",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role",
    GEMINI_USER_KEY_ENCRYPTION_SECRET: Buffer.alloc(32, 7).toString("base64"),
  };
  let googleCalls = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "supabase.invalid" && url.pathname === "/auth/v1/user") {
      return json({ id: userId });
    }
    if (url.hostname === "generativelanguage.googleapis.com") {
      googleCalls += 1;
      return json({ models: [] });
    }
    throw new Error(`Unexpected network call: ${url.href}`);
  });

  const response = await handle(new Request("https://gateway.invalid/api/v1/apikey", {
    method: "POST",
    headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
    body: JSON.stringify({ api_key: "AIzaSyntheticPrivateUserKey000000000000" }),
  }), env);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "COST_CONSENT_REQUIRED");
  assert.equal(googleCalls, 0, "no provider request should precede billing consent");
});

test("BYOK Gemini generation sends credentials only in the API-key header and skips platform quota reservations", async (t) => {
  const apiKey = "AIzaAnotherSyntheticKey000000000000000";
  let callCount = 0;
  let generationConfig;
  t.mock.method(globalThis, "fetch", async (input, init = {}) => {
    const url = new URL(String(input));
    callCount += 1;
    assert.equal(url.search, "");
    assert.equal(new Headers(init.headers).get("x-goog-api-key"), apiKey);
    generationConfig = JSON.parse(init.body).generationConfig;
    return json({
      candidates: [{ content: { parts: [{ text: "Grounded answer [S1]" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
  });
  const response = await generateAnswer({}, "Prompt", {
    workspaceId: "10101010-1010-4010-8010-101010101010",
    priority: "interactive",
    dataClassification: "non_sensitive",
    userApiKey: apiKey,
    credentialMode: "user_byok",
    temperature: 0.45,
  });
  assert.equal(response.answer, "Grounded answer [S1]");
  assert.equal(callCount, 1);
  assert.equal(generationConfig.temperature, 0.45);
  assert.equal(generationConfig.maxOutputTokens, 1024);
});