// The search index (Qdrant) as the gateway sees it: where it lives, one light probe that doubles as the daily
// keep-alive (D15 in docs/completion/MASTER_PROMPT.md), and failures that say what is actually wrong.
//
// Qdrant suspends a free cluster after a week without requests and deletes it four weeks later. A suspended
// cluster and one that is restarting look the same from here (no answer, or a 5xx from its load balancer), so
// that state is called NOT_ANSWERING and its message names both causes.

export const DEFAULT_INDEX_COLLECTION = "nexusrag-v6-preview";
const PROBE_TIMEOUT_MS = 4_000;
const remembered = new Map(); // collection address -> { at, result }; per isolate

export function indexCollection(env) {
  return String(env?.QDRANT_COLLECTION || DEFAULT_INDEX_COLLECTION);
}

/** What an HTTP status from the index proves. 0 stands for no answer at all. */
export function indexStateFor(status) {
  if (status >= 200 && status < 300) return "READY";
  if (status === 404) return "EMPTY";
  if (status === 401 || status === 403) return "KEY_REJECTED";
  if (status === 429) return "RATE_LIMITED";
  if (!status || status >= 500) return "NOT_ANSWERING";
  return "REJECTED";
}

// state -> [error code, HTTP status for the caller, whether waiting helps, message]. The messages are shown to
// people who use the app, so they say whose problem it is and never name the provider or echo its response.
const FAILURES = Object.freeze({
  NOT_CONFIGURED: ["CONFIGURATION_ERROR", 503, false, "The search index is not configured."],
  KEY_REJECTED: ["INDEX_KEY_REJECTED", 503, false, "The search index refused the service's own key. Nothing is wrong with your account or your documents; the service operator has to correct the key."],
  EMPTY: ["INDEX_EMPTY", 503, false, "The search index is empty: it was reset or never filled. Your documents are still stored, but they have to be indexed again before they can be searched."],
  RATE_LIMITED: ["PROVIDER_QUOTA_EXHAUSTED", 429, true, "The search index is rate limited or out of quota. Try again in a few minutes."],
  NOT_ANSWERING: ["INDEX_NOT_ANSWERING", 503, true, "The search index is not answering. It may be restarting, or it was paused after a week without use, in which case the service operator has to wake it. Your documents are safe. Try again in a few minutes."],
});

export function indexFailure(state, httpStatus = 0) {
  const [code, status, retryable, message] = FAILURES[state]
    || ["PROVIDER_UNAVAILABLE", 503, true, `The search index is unavailable right now (HTTP ${httpStatus}). Try again shortly.`];
  return Object.assign(new Error(message), { code, status, retryable, indexState: state, providerStatus: httpStatus });
}

/** Address and headers of this environment's collection. */
export function indexEndpoint(env) {
  if (!env?.QDRANT_URL || !env?.QDRANT_API_KEY) throw indexFailure("NOT_CONFIGURED");
  return {
    base: `${String(env.QDRANT_URL).replace(/\/+$/, "")}/collections/${encodeURIComponent(indexCollection(env))}`,
    headers: { "content-type": "application/json", "api-key": env.QDRANT_API_KEY },
  };
}

/**
 * `fetch` for the index with a deadline. No answer becomes a NOT_ANSWERING failure; a caller that cancelled its
 * own request gets its own abort back, because that is not the index's fault.
 */
export async function indexFetch(url, init = {}, timeoutMs = 8_000, fetchImpl = fetch) {
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw indexFailure("NOT_ANSWERING", 0);
  }
}

/**
 * Asks the index to describe this environment's collection: one light request that shows whether the cluster
 * is awake, whether the key works and how many points it holds. It never throws. The first cron run of each
 * day calls it, and that request is what keeps a free cluster from being suspended. With `maxAgeMs`, an answer
 * this isolate got that recently is reused instead of asking again.
 */
export async function probeIndex(env, { fetchImpl = fetch, now = Date.now(), maxAgeMs = 0 } = {}) {
  const collection = indexCollection(env);
  const result = (state, httpStatus, facts = {}) => ({
    state, collection, points: null, vector_size: null, ...facts, http_status: httpStatus, checked_at: new Date(now).toISOString(),
  });
  let endpoint;
  try { endpoint = indexEndpoint(env); } catch { return result("NOT_CONFIGURED", null); }
  const last = remembered.get(endpoint.base);
  if (maxAgeMs > 0 && last && now >= last.at && now - last.at < maxAgeMs) return last.result;
  let probed;
  try {
    const response = await indexFetch(endpoint.base, { headers: endpoint.headers }, PROBE_TIMEOUT_MS, fetchImpl);
    const state = indexStateFor(response.status);
    if (state !== "READY") {
      await response.body?.cancel().catch(() => {});
      probed = result(state, response.status);
    } else {
      // A 200 that does not describe a collection (a proxy page, a wrong address) proves nothing about the index.
      const described = (await response.json().catch(() => null))?.result;
      const whole = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
      probed = described && typeof described === "object"
        ? result("READY", response.status, { points: whole(described.points_count), vector_size: whole(described.config?.params?.vectors?.size) })
        : result("REJECTED", response.status);
    }
  } catch {
    probed = result("NOT_ANSWERING", 0);
  }
  remembered.set(endpoint.base, { at: now, result: probed });
  return probed;
}

/**
 * The part of a probe anyone may see. Counts stay out: a total that changes with every upload would let one
 * tenant watch the activity of the others.
 */
export function indexSummary(probe) {
  return {
    state: probe.state, collection: probe.collection, populated: probe.points === null ? null : probe.points > 0,
    http_status: probe.http_status, checked_at: probe.checked_at,
  };
}

/** True when uploads and searches can use the index: it answered, or it is new and the first upload creates it. */
export function indexUsable(state) {
  return state === "READY" || state === "EMPTY";
}

/**
 * The daily keep-alive: one probe, written to the Worker's log, which only the operator can read. That line is
 * where the point count is kept; a problem is logged as a warning.
 */
export async function keepIndexAwake(env, options = {}) {
  const probe = await probeIndex(env, options);
  if (probe.state === "NOT_CONFIGURED") return probe;
  const line = JSON.stringify({
    event: "search_index_keepalive", state: probe.state, http_status: probe.http_status,
    collection: probe.collection, points: probe.points, vector_size: probe.vector_size,
  });
  if (indexUsable(probe.state)) console.log(line); else console.warn(line);
  return probe;
}

export function resetIndexProbeMemory() {
  remembered.clear();
}
