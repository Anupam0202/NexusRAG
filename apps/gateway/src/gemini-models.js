// Gemini model policy (D24 in docs/completion/MASTER_PROMPT.md).
//
// Generation uses the least expensive stable model first and falls back automatically when Google retires a
// model. Embeddings are pinned: a different embedding model produces a different vector space, so changing it
// requires a new index generation and a re-index, never a silent fallback.

export const DEFAULT_GENERATION_MODELS = Object.freeze([
  "gemini-3.5-flash-lite", // stable, free tier; Google's replacement for gemini-2.5-flash
  "gemini-3.1-flash-lite", // cheapest stable model
  "gemini-flash-latest", // alias Google moves to each new Flash release (two weeks' notice); last resort
]);
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-001"; // supported until 2028-05-14
export const EMBEDDING_DIMENSIONS = 768;

const MODEL_ID = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const remembered = new Map(); // candidate list -> { index, at }; per isolate

/** Ordered generation candidates: `GEMINI_MODEL` may hold one model or a comma-separated list. */
export function generationModels(env) {
  const configured = String(env?.GEMINI_MODEL || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => MODEL_ID.test(value));
  return configured.length ? [...new Set(configured)] : [...DEFAULT_GENERATION_MODELS];
}

export function embeddingModel(env) {
  const configured = String(env?.GEMINI_EMBEDDING_MODEL || "").trim();
  return MODEL_ID.test(configured) ? configured : DEFAULT_EMBEDDING_MODEL;
}

function rememberedIndex(models, now = Date.now()) {
  const entry = remembered.get(models.join(","));
  return entry && now - entry.at < MEMORY_TTL_MS && entry.index < models.length ? entry.index : 0;
}

/** The generation model this isolate currently uses: the first candidate unless a retirement moved it on. */
export function activeGenerationModel(env) {
  const models = generationModels(env);
  return models[rememberedIndex(models)];
}

/**
 * Thinking settings Google documents per family: `thinkingBudget: 0` turns thinking off on 2.5 models; 3.x
 * Flash-Lite models default to minimal thinking, so nothing is sent; other 3.x models get `thinkingLevel: low`.
 * Aliases may point at any release, so they keep the model's own default.
 */
export function thinkingConfigFor(model) {
  if (/^gemini-2\.5-/.test(model)) return { thinkingBudget: 0 };
  if (model.endsWith("-latest") || model.includes("flash-lite")) return undefined;
  if (/^gemini-(?:[3-9]|\d{2,})(?:\.\d+)?-/.test(model)) return { thinkingLevel: "low" };
  return undefined;
}

/**
 * True when an error response means this model cannot serve the request (retired, renamed or unsupported), so
 * the next candidate should be tried. Key, quota, safety and transport errors are never model problems.
 */
const MODEL_PROBLEM = "(?:not found|not supported|unsupported|is not available|no longer available|deprecated|retired|shut ?down|discontinued)";
const MODEL_THEN_PROBLEM = new RegExp(`\\bmodels?\\b[^.]*\\b${MODEL_PROBLEM}`, "i");
const PROBLEM_THEN_MODEL = new RegExp(`\\b${MODEL_PROBLEM}[^.]*\\bmodels?\\b`, "i");
const THINKING_PROBLEM = /thinking[^.]*(?:not supported|unsupported|invalid|not enabled)|invalid[^.]*thinking/i;

export function isModelUnavailable(status, detail = "") {
  // Join dotted words ("gemini-2.0-flash", "generation_config.thinking_config") so only a real sentence end
  // stops the same-sentence checks below.
  const text = String(detail).replace(/(\w)\.(?=\w)/g, "$1_");
  if (/api[ _-]?key|API_KEY_INVALID|permission denied on resource project|billing/i.test(text)) return false;
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  return MODEL_THEN_PROBLEM.test(text) || PROBLEM_THEN_MODEL.test(text) || THINKING_PROBLEM.test(text);
}

/**
 * Runs `attempt(model)` on each generation candidate in order until one is not rejected as unavailable.
 * `attempt` must throw an error with `modelUnavailable: true` to move on; any other error is rethrown at once.
 */
export async function withGenerationModel(env, attempt, now = Date.now()) {
  const models = generationModels(env);
  const start = rememberedIndex(models, now);
  let lastError;
  for (let index = start; index < models.length; index += 1) {
    try {
      const result = await attempt(models[index]);
      if (index !== start) {
        remembered.set(models.join(","), { index, at: now });
        console.warn(JSON.stringify({ event: "gemini_model_fallback", from: models[start], to: models[index] }));
      }
      return result;
    } catch (error) {
      if (!error?.modelUnavailable) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Which configured models appear in a `models.list` response. */
export function modelAvailability(listedNames, env) {
  const listed = new Set((listedNames || []).map((name) => String(name).replace(/^models\//, "")));
  const generation = generationModels(env).map((model) => ({ model, available: listed.has(model) }));
  const embedding = embeddingModel(env);
  return {
    generation,
    active_generation: generation.find((item) => item.available)?.model || null,
    primary_available: Boolean(generation[0]?.available),
    embedding: { model: embedding, available: listed.has(embedding) },
  };
}

/** Lists Gemini models with the platform key and steers generation to the first listed candidate. */
export async function checkGeminiModels(env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!env?.GOOGLE_API_KEY) return { status: "SKIPPED_NO_PLATFORM_KEY" };
  const names = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetchImpl(url, { headers: { "x-goog-api-key": env.GOOGLE_API_KEY }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return { status: "UNAVAILABLE", http_status: response.status };
    const body = await response.json();
    names.push(...(body?.models || []).map((item) => item?.name).filter(Boolean));
    pageToken = body?.nextPageToken || "";
    if (!pageToken) break;
  }
  const availability = modelAvailability(names, env);
  const models = generationModels(env);
  const index = models.indexOf(availability.active_generation);
  if (index > 0) remembered.set(models.join(","), { index, at: now });
  if (index === 0) remembered.delete(models.join(","));
  if (!availability.primary_available || !availability.embedding.available) {
    console.warn(JSON.stringify({ event: "gemini_model_check", ...availability }));
  }
  return { status: "CHECKED", ...availability };
}

/** True for the single five-minute cron run that starts each UTC day. */
export function isDailyModelCheckWindow(scheduledTime) {
  const at = new Date(Number(scheduledTime) || Date.now());
  return at.getUTCHours() === 0 && at.getUTCMinutes() < 5;
}

export function resetGeminiModelMemory() {
  remembered.clear();
}
