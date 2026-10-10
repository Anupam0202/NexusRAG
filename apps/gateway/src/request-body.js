// Bound untrusted request allocation and elapsed time before JSON admission.
// No raw input, parser exception, token or private field is reflected.
const problem = (code, message, status) =>
  Object.assign(new Error(message), { code, status });
const tooLarge = maxBytes => problem("PAYLOAD_TOO_LARGE",
  `The request body exceeds the ${maxBytes}-byte limit. Reduce input size and retry.`, 413);

async function nextChunk(reader, signal, deadline) {
  let timer, onAbort;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() =>
      reject(problem("REQUEST_TIMEOUT", "The request timed out. Retry when ready.", 408)),
    Math.max(1, deadline - Date.now()));
    onAbort = () => reject(problem("REQUEST_ABORTED", "The request was cancelled.", 400));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  try {
    return await Promise.race([reader.read(), interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function readBoundedJsonObject(
  request, { maxBytes = 100_000, timeoutMs = 5_000, objectStatus = 400 } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
      ![400, 422].includes(objectStatus))
    throw new TypeError("Body limits must be positive integers.");
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^[0-9]+$/.test(declared) || !Number.isSafeInteger(Number(declared)))
      throw problem("INVALID_REQUEST", "The request length is invalid.", 400);
    if (Number(declared) > maxBytes)
      throw tooLarge(maxBytes);
  }
  const aborted = () => problem("REQUEST_ABORTED", "The request was cancelled.", 400);
  if (request.signal?.aborted) throw aborted();
  const reader = request.body?.getReader();
  if (!reader) throw problem("INVALID_REQUEST", "A JSON object is required.", 400);
  const bytes = new Uint8Array(maxBytes);
  const deadline = Date.now() + timeoutMs;
  let size = 0, fragments = 0;
  try {
    for (;;) {
      // A flood of immediately resolved/empty chunks must not starve the timer
      // or accumulate one array allocation per transport fragment.
      if (Date.now() >= deadline)
        throw problem("REQUEST_TIMEOUT", "The request timed out. Retry when ready.", 408);
      const { value, done } = await nextChunk(reader, request.signal, deadline);
      if (Date.now() >= deadline)
        throw problem("REQUEST_TIMEOUT", "The request timed out. Retry when ready.", 408);
      if (done) break;
      // Worker clocks may advance only on I/O. Bound microtask-only transport
      // work independently so a frozen clock cannot permit an endless flood.
      if (++fragments > 2_048)
        throw problem("CAPACITY_REACHED",
          "The request transport is too fragmented. Retry with buffered JSON.", 413);
      if (!(value instanceof Uint8Array))
        throw problem("INVALID_REQUEST", "A UTF-8 JSON object is required.", 400);
      size += value.byteLength;
      if (size > maxBytes)
        throw tooLarge(maxBytes);
      bytes.set(value, size - value.byteLength);
    }
  } catch (error) {
    if (["INVALID_REQUEST", "PAYLOAD_TOO_LARGE", "REQUEST_TIMEOUT", "REQUEST_ABORTED", "CAPACITY_REACHED"]
      .includes(error?.code)) throw error;
    throw problem("INVALID_REQUEST", "The request body could not be read.", 400);
  } finally {
    // Never await an attacker-controlled/stalled cancellation hook.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Best-effort transport cleanup. */ }
  }
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } catch {
    throw problem("INVALID_REQUEST", "A valid UTF-8 JSON object is required.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw problem(objectStatus === 422 ? "INVALID_SCOPE" : "INVALID_REQUEST",
      "A JSON object is required.", objectStatus);
  return value;
}