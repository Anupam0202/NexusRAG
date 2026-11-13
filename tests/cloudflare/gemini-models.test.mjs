import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GENERATION_MODELS,
  activeGenerationModel,
  checkGeminiModels,
  embeddingModel,
  generationModels,
  isDailyModelCheckWindow,
  isModelUnavailable,
  modelAvailability,
  resetGeminiModelMemory,
  thinkingConfigFor,
  withGenerationModel,
} from "../../apps/gateway/src/gemini-models.js";
import { generateAnswer } from "../../apps/gateway/src/worker-pipeline.js";
import { extractFileText } from "../../apps/gateway/src/worker-lifecycle.js";
import { handle, scheduled } from "../../apps/gateway/src/preview-worker.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const unavailable = () => Object.assign(new Error("retired"), { modelUnavailable: true });
const NOT_FOUND = "models/gemini-3.5-flash-lite is not found for API version v1beta, or is not supported for generateContent. Call ListModels to see the list of available models and their supported methods.";

// Answers the quota RPCs like a healthy database and hands Gemini requests to `gemini`.
function providerFetch(gemini) {
  const calls = { gemini: [], reserve: 0, settle: [] };
  let sequence = 0;
  const fetch = async (rawUrl, init = {}) => {
    const url = String(rawUrl);
    if (url.endsWith("/rpc/v6_reserve_many")) {
      calls.reserve += 1;
      const payload = JSON.parse(init.body);
      return json({ state: "READY", reservations: Object.values(payload.p_dimensions).map((amount) => ({ id: `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`, amount })) });
    }
    if (url.endsWith("/rpc/v6_settle_many")) {
      const payload = JSON.parse(init.body);
      calls.settle.push(payload.p_provider_called);
      return json({ state: payload.p_provider_called ? "SETTLED" : "RELEASED" });
    }
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      const model = decodeURIComponent(new URL(url).pathname.split("/models/")[1].split(":")[0]);
      const body = JSON.parse(init.body);
      calls.gemini.push({ model, body, key: new Headers(init.headers).get("x-goog-api-key") });
      return gemini(model, body);
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetch, calls };
}

const answer = (text = "Grounded answer. [S1]") => json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 } });
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only", GOOGLE_API_KEY: "synthetic-gemini-only" };
const context = { workspaceId, priority: "interactive", dataClassification: "non_sensitive" };

test("generation candidates default to the D24 chain and accept a validated override", () => {
  assert.deepEqual(DEFAULT_GENERATION_MODELS, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest"]);
  assert.deepEqual(generationModels({}), [...DEFAULT_GENERATION_MODELS]);
  assert.deepEqual(generationModels({ GEMINI_MODEL: "gemini-3.6-flash" }), ["gemini-3.6-flash"]);
  assert.deepEqual(generationModels({ GEMINI_MODEL: " gemini-3.6-flash , gemini-3.1-flash-lite,gemini-3.6-flash " }), ["gemini-3.6-flash", "gemini-3.1-flash-lite"]);
  // Malformed entries are dropped; an override with nothing valid falls back to the defaults.
  assert.deepEqual(generationModels({ GEMINI_MODEL: "../models,gemini 3,GEMINI-X" }), [...DEFAULT_GENERATION_MODELS]);
  assert.deepEqual(generationModels({ GEMINI_MODEL: "x/../../v1,gemini-3.1-flash-lite" }), ["gemini-3.1-flash-lite"]);
});

test("the embedding model is pinned unless explicitly overridden", () => {
  assert.equal(DEFAULT_EMBEDDING_MODEL, "gemini-embedding-001");
  assert.equal(embeddingModel({}), "gemini-embedding-001");
  assert.equal(embeddingModel({ GEMINI_EMBEDDING_MODEL: "gemini-embedding-2" }), "gemini-embedding-2");
  assert.equal(embeddingModel({ GEMINI_EMBEDDING_MODEL: "bad/model" }), "gemini-embedding-001");
});

test("thinking settings follow each model family's documented controls", () => {
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash"), { thinkingBudget: 0 });
  assert.deepEqual(thinkingConfigFor("gemini-2.5-flash-lite"), { thinkingBudget: 0 });
  assert.equal(thinkingConfigFor("gemini-3.5-flash-lite"), undefined);
  assert.equal(thinkingConfigFor("gemini-3.1-flash-lite"), undefined);
  assert.equal(thinkingConfigFor("gemini-flash-latest"), undefined);
  assert.equal(thinkingConfigFor("gemini-flash-lite-latest"), undefined);
  assert.deepEqual(thinkingConfigFor("gemini-3.6-flash"), { thinkingLevel: "low" });
  assert.deepEqual(thinkingConfigFor("gemini-3.8-flash"), { thinkingLevel: "low" });
  assert.deepEqual(thinkingConfigFor("gemini-4-flash"), { thinkingLevel: "low" });
  assert.deepEqual(thinkingConfigFor("gemini-10.1-pro"), { thinkingLevel: "low" });
  assert.equal(thinkingConfigFor("gemma-3-27b-it"), undefined);
});

test("only model problems count as unavailable; key, quota and server errors never do", () => {
  assert.equal(isModelUnavailable(404, ""), true);
  assert.equal(isModelUnavailable(404, NOT_FOUND), true);
  assert.equal(isModelUnavailable(400, NOT_FOUND), true);
  assert.equal(isModelUnavailable(400, "The model gemini-2.0-flash has been retired."), true);
  assert.equal(isModelUnavailable(400, "The model gemini-2.0-flash-lite is no longer available. Use a newer model."), true);
  assert.equal(isModelUnavailable(400, "Thinking budget is not supported for this model."), true);
  assert.equal(isModelUnavailable(400, "Invalid value at 'generation_config.thinking_config.thinking_level' (TYPE_ENUM), \"low\""), true);
  assert.equal(isModelUnavailable(400, "The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)."), false);
  assert.equal(isModelUnavailable(400, "Invalid JSON payload received. Unknown name \"foo\" at 'generation_config': Cannot find field."), false);
  assert.equal(isModelUnavailable(400, "API key not valid. Please pass a valid API key."), false);
  assert.equal(isModelUnavailable(400, '{"error":{"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}'), false);
  assert.equal(isModelUnavailable(403, "Permission denied on resource project 123."), false);
  assert.equal(isModelUnavailable(403, "Billing is not enabled for model access."), false);
  assert.equal(isModelUnavailable(400, "Request contains an invalid argument."), false);
  assert.equal(isModelUnavailable(429, NOT_FOUND), false);
  assert.equal(isModelUnavailable(500, NOT_FOUND), false);
  assert.equal(isModelUnavailable(503, ""), false);
});

test("fallback moves to the next candidate only for unavailable models and remembers it for a day", async (t) => {
  resetGeminiModelMemory();
  const warn = t.mock.method(console, "warn", () => {});
  const tried = [];
  const now = Date.UTC(2026, 10, 9, 12);
  const result = await withGenerationModel({}, async (model) => {
    tried.push(model);
    if (model === "gemini-3.5-flash-lite") throw unavailable();
    return `served by ${model}`;
  }, now);
  assert.equal(result, "served by gemini-3.1-flash-lite");
  assert.deepEqual(tried, ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(warn.mock.calls[0].arguments[0]), { event: "gemini_model_fallback", from: "gemini-3.5-flash-lite", to: "gemini-3.1-flash-lite" });
  // Every clock reading is passed in, so the test does not depend on the day it runs.
  assert.equal(activeGenerationModel({}, now + 60_000), "gemini-3.1-flash-lite");
  assert.equal(activeGenerationModel({}, now + 25 * 60 * 60 * 1000), "gemini-3.5-flash-lite");

  tried.length = 0;
  await withGenerationModel({}, async (model) => { tried.push(model); return model; }, now + 60_000);
  assert.deepEqual(tried, ["gemini-3.1-flash-lite"], "the remembered model is tried first");

  tried.length = 0;
  await withGenerationModel({}, async (model) => { tried.push(model); return model; }, now + 25 * 60 * 60 * 1000);
  assert.deepEqual(tried, ["gemini-3.5-flash-lite"], "after a day the preferred model is tried again");
  resetGeminiModelMemory();
});

test("other errors stop at once and an exhausted chain reports the last error", async () => {
  resetGeminiModelMemory();
  const tried = [];
  const quota = Object.assign(new Error("quota"), { code: "PROVIDER_QUOTA_EXHAUSTED" });
  await assert.rejects(withGenerationModel({}, async (model) => { tried.push(model); throw quota; }), (error) => error === quota);
  assert.deepEqual(tried, ["gemini-3.5-flash-lite"]);

  tried.length = 0;
  await assert.rejects(withGenerationModel({}, async (model) => { tried.push(model); throw Object.assign(unavailable(), { model }); }), (error) => error.model === "gemini-flash-latest");
  assert.deepEqual(tried, [...DEFAULT_GENERATION_MODELS]);
  assert.equal(activeGenerationModel({}), "gemini-3.5-flash-lite", "a chain that never succeeded is not remembered");
});

test("model availability compares configured models with the listed ones", () => {
  const listed = ["models/gemini-3.1-flash-lite", "models/gemini-flash-latest", "models/gemini-embedding-001"];
  assert.deepEqual(modelAvailability(listed, {}), {
    generation: [
      { model: "gemini-3.5-flash-lite", available: false },
      { model: "gemini-3.1-flash-lite", available: true },
      { model: "gemini-flash-latest", available: true },
    ],
    active_generation: "gemini-3.1-flash-lite",
    primary_available: false,
    embedding: { model: "gemini-embedding-001", available: true },
  });
  assert.equal(modelAvailability([], {}).active_generation, null);
});

test("the daily check lists every page with the platform key and steers generation", async (t) => {
  resetGeminiModelMemory();
  const warn = t.mock.method(console, "warn", () => {});
  assert.deepEqual(await checkGeminiModels({}, { fetchImpl: async () => { throw new Error("must not fetch"); } }), { status: "SKIPPED_NO_PLATFORM_KEY" });

  const requests = [];
  const pages = [
    { models: [{ name: "models/gemini-3.1-flash-lite" }], nextPageToken: "page-2" },
    { models: [{ name: "models/gemini-embedding-001" }, { name: "models/gemini-flash-latest" }] },
  ];
  const fetchImpl = async (url, init) => {
    requests.push({ url: new URL(url), key: init.headers["x-goog-api-key"] });
    return json(pages[requests.length - 1]);
  };
  const result = await checkGeminiModels({ GOOGLE_API_KEY: "synthetic-gemini-only" }, { fetchImpl });
  assert.equal(result.status, "CHECKED");
  assert.equal(result.active_generation, "gemini-3.1-flash-lite");
  assert.equal(result.primary_available, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get("pageSize"), "1000");
  assert.equal(requests[1].url.searchParams.get("pageToken"), "page-2");
  assert.ok(requests.every((request) => request.key === "synthetic-gemini-only"));
  assert.equal(activeGenerationModel({}), "gemini-3.1-flash-lite");
  assert.equal(warn.mock.callCount(), 1, "a missing primary model is logged");
  assert.doesNotMatch(warn.mock.calls[0].arguments[0], /synthetic/);

  // Once the primary model is listed again, generation returns to it.
  const restored = await checkGeminiModels({ GOOGLE_API_KEY: "synthetic-gemini-only" }, {
    fetchImpl: async () => json({ models: [{ name: "models/gemini-3.5-flash-lite" }, { name: "models/gemini-embedding-001" }] }),
  });
  assert.equal(restored.primary_available, true);
  assert.equal(activeGenerationModel({}), "gemini-3.5-flash-lite");
  assert.deepEqual(await checkGeminiModels({ GOOGLE_API_KEY: "k" }, { fetchImpl: async () => json({}, 403) }), { status: "UNAVAILABLE", http_status: 403 });
  resetGeminiModelMemory();
});

test("the daily check runs only in the first five minutes of each UTC day", () => {
  assert.equal(isDailyModelCheckWindow(Date.UTC(2026, 10, 9, 0, 0)), true);
  assert.equal(isDailyModelCheckWindow(Date.UTC(2026, 10, 9, 0, 4, 59)), true);
  assert.equal(isDailyModelCheckWindow(Date.UTC(2026, 10, 9, 0, 5)), false);
  assert.equal(isDailyModelCheckWindow(Date.UTC(2026, 10, 9, 13, 2)), false);
});

test("answers fall back from a retired model, send per-model thinking settings and meter each call", async (t) => {
  resetGeminiModelMemory();
  t.mock.method(console, "warn", () => {});
  const provider = providerFetch((model) => model === "gemini-3.5-flash-lite" ? json({ error: { code: 404, message: NOT_FOUND, status: "NOT_FOUND" } }, 404) : answer());
  t.mock.method(globalThis, "fetch", provider.fetch);
  const result = await generateAnswer(env, "question", context);
  assert.equal(result.model, "gemini-3.1-flash-lite");
  assert.equal(result.answer, "Grounded answer. [S1]");
  assert.deepEqual(provider.calls.gemini.map((call) => call.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.ok(provider.calls.gemini.every((call) => call.body.generationConfig.thinkingConfig === undefined), "Flash-Lite 3.x keeps its default thinking level");
  assert.equal(provider.calls.reserve, 2);
  assert.deepEqual(provider.calls.settle, [true, true], "every provider call is charged once");
  resetGeminiModelMemory();

  const override = providerFetch(() => answer());
  t.mock.method(globalThis, "fetch", override.fetch);
  await generateAnswer({ ...env, GEMINI_MODEL: "gemini-3.6-flash" }, "question", context);
  assert.deepEqual(override.calls.gemini[0].body.generationConfig.thinkingConfig, { thinkingLevel: "low" });
  const legacy = providerFetch(() => answer());
  t.mock.method(globalThis, "fetch", legacy.fetch);
  await generateAnswer({ ...env, GEMINI_MODEL: "gemini-2.5-flash" }, "question", context);
  assert.deepEqual(legacy.calls.gemini[0].body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
});

test("key, quota and server errors never switch models and say what went wrong", async (t) => {
  for (const [status, message, code, shown] of [
    [400, "API key not valid. Please pass a valid API key.", "PROVIDER_KEY_REJECTED", /Gemini rejected the API key/],
    [403, "Method doesn't allow unregistered callers (callers without established identity).", "PROVIDER_KEY_REJECTED", /check it in Settings/],
    [402, "Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.", "PROVIDER_CREDIT_EXHAUSTED", /no prepaid credit left\. Add your own Gemini API key in Settings/],
    [429, "Resource has been exhausted (e.g. check quota).", "PROVIDER_QUOTA_EXHAUSTED", /Gemini is rate limited or out of quota/],
    [500, "Internal error encountered.", "PROVIDER_UNAVAILABLE", /Gemini is unavailable right now \(HTTP 500\)/],
  ]) {
    resetGeminiModelMemory();
    const provider = providerFetch(() => json({ error: { code: status, message } }, status));
    t.mock.method(globalThis, "fetch", provider.fetch);
    await assert.rejects(generateAnswer(env, "question", context), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.modelUnavailable, false);
      assert.match(error.message, shown);
      assert.doesNotMatch(error.message, new RegExp(message.slice(0, 20)), "provider text is never passed on");
      return true;
    });
    assert.equal(provider.calls.gemini.length, 1, `HTTP ${status} must not try another model`);
    assert.equal(activeGenerationModel({}), "gemini-3.5-flash-lite");
  }
});

test("PDF extraction uses the same fallback chain and records the model that served it", async (t) => {
  resetGeminiModelMemory();
  t.mock.method(console, "warn", () => {});
  const provider = providerFetch((model) => model === "gemini-3.5-flash-lite" ? json({ error: { code: 404, message: NOT_FOUND } }, 404) : answer("[PAGE 1] Retention is 30 days."));
  t.mock.method(globalThis, "fetch", provider.fetch);
  const file = new File(["%PDF-1.7 synthetic"], "policy.pdf", { type: "application/pdf" });
  const extracted = await extractFileText(env, file, { ...context, priority: "background" });
  assert.equal(extracted.text, "[PAGE 1] Retention is 30 days.");
  assert.equal(extracted.manifest.model, "gemini-3.1-flash-lite");
  assert.deepEqual(provider.calls.gemini.map((call) => call.model), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  assert.equal(provider.calls.gemini[1].body.contents[0].parts[1].inlineData.mimeType, "application/pdf");
  resetGeminiModelMemory();

  const failing = providerFetch(() => json({ error: { code: 500, message: "Internal error encountered." } }, 500));
  t.mock.method(globalThis, "fetch", failing.fetch);
  await assert.rejects(extractFileText(env, file, { ...context, priority: "background" }), (error) => error.code === "EXTRACTION_FAILED");
  assert.equal(failing.calls.gemini.length, 1);
});

test("health reports the models in use and the cron runs the model check once a day", async (t) => {
  resetGeminiModelMemory();
  const body = await (await handle(new Request("https://gateway.invalid/health"), {})).json();
  assert.deepEqual(body.gemini_models, { generation: "gemini-3.5-flash-lite", embedding: "gemini-embedding-001" });
  const pinned = await (await handle(new Request("https://gateway.invalid/health"), { GEMINI_MODEL: "gemini-3.6-flash", GEMINI_EMBEDDING_MODEL: "gemini-embedding-2" })).json();
  assert.deepEqual(pinned.gemini_models, { generation: "gemini-3.6-flash", embedding: "gemini-embedding-2" });

  t.mock.method(globalThis, "fetch", async () => json([]));
  t.mock.method(console, "warn", () => {});
  const runs = (scheduledTime) => {
    const waited = [];
    scheduled({ scheduledTime }, {}, { waitUntil: (promise) => waited.push(Promise.resolve(promise).catch(() => undefined)) });
    return waited;
  };
  const midnight = runs(Date.UTC(2026, 10, 9, 0, 0));
  const later = runs(Date.UTC(2026, 10, 9, 0, 5));
  await Promise.all([...midnight, ...later]);
  // Every run sweeps jobs, unfinished deletions and due retention runs; only the first run of the day adds the daily checks.
  assert.equal(midnight.length, 4, "the first run of the day also checks models");
  assert.equal(later.length, 3, "other runs only sweep jobs, deletions and retention");
});
