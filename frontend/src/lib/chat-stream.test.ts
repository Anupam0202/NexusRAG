import { afterEach, describe, expect, it, vi } from "vitest";

const getApiHeaders = vi.hoisted(() => vi.fn(async () => ({ Authorization: "Bearer synthetic", "Content-Type": "application/json" })));
vi.mock("@/lib/api-context", () => ({ getApiHeaders }));
vi.mock("@/lib/backend-url", () => ({ buildBackendUrl: (path: string) => `https://gateway.invalid${path}` }));

import { ApiRequestError, chatQuery } from "./api";

const context = { workspaceId: "workspace-a", expectedUserId: "user-a" };
const question = { question: "What is the retention period?", non_sensitive_attested: true };
const final = { answer: "Retention is 47 days. [S1]", sources: [], query_type: "hybrid", confidence: 0, response_time_seconds: 1, metadata: { session_revision: 2 } };

// A server-sent event response whose bytes arrive in the given pieces, which need not end at event boundaries.
function streamed(pieces: string[], status = 200) {
  const encoder = new TextEncoder();
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next >= pieces.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(pieces[next++]));
    },
  });
  const fetch = vi.fn().mockResolvedValue(new Response(body, { status, headers: { "content-type": "text/event-stream; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("chatQuery with a token callback", () => {
  it("passes each piece on as it arrives and returns the checked answer", async () => {
    const whole = event("token", { content: "Retention is " }) + event("token", { content: "47 days. [S1]" }) + event("done", final);
    const fetch = streamed([whole.slice(0, 17), whole.slice(17, 60), whole.slice(60)]);
    const tokens: string[] = [];
    await expect(chatQuery(question, context, (token) => tokens.push(token))).resolves.toEqual(final);
    expect(tokens).toEqual(["Retention is ", "47 days. [S1]"]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://gateway.invalid/api/v1/chat");
    expect(init.method).toBe("POST");
    expect(init.headers.Accept).toBe("text/event-stream");
    expect(init.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(init.body)).toEqual(question);
    expect(getApiHeaders).toHaveBeenCalledWith(context);
  });

  it("reports an error the gateway sends after the answer started, with its code", async () => {
    streamed([event("token", { content: "Retention" }), event("error", { code: "PROVIDER_UNAVAILABLE", message: "Gemini did not answer in time. Try again shortly.", status: 503, retryable: true })]);
    const failure = await chatQuery(question, context, () => {}).catch((error) => error);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect(failure).toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503, message: "Gemini did not answer in time. Try again shortly." });
  });

  it("does not treat a stream that ends without its final event as an answer", async () => {
    streamed([event("token", { content: "Retention is" })]);
    await expect(chatQuery(question, context, () => {})).rejects.toMatchObject({ code: "STREAM_INTERRUPTED" });
  });

  it("fails like any request when the gateway refuses before answering", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "PROVIDER_CREDIT_EXHAUSTED", message: "No prepaid credit left." } }),
      { status: 402, headers: { "content-type": "application/json" } })));
    await expect(chatQuery(question, context, () => {})).rejects.toMatchObject({ code: "PROVIDER_CREDIT_EXHAUSTED", status: 402 });
  });

  it("accepts a whole JSON answer from a gateway that does not stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(final), { headers: { "content-type": "application/json" } })));
    const tokens: string[] = [];
    await expect(chatQuery(question, context, (token) => tokens.push(token))).resolves.toEqual(final);
    expect(tokens).toEqual([]);
  });
});
