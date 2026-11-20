import test from "node:test";
import assert from "node:assert/strict";
import { readBoundedJsonObject } from "../../apps/gateway/src/request-body.js";

const encoded = text => new TextEncoder().encode(text);
const request = (body, headers = {}, signal) => new Request("https://gateway.invalid/test", {
  method: "POST", body, headers, signal, ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
});
const chunks = values => new ReadableStream({
  start(controller) {
    for (const value of values) controller.enqueue(value);
    controller.close();
  },
});
const rejects = (promise, code, status) => assert.rejects(promise, error =>
  error.code === code && error.status === status &&
  !error.message.includes("synthetic-private-marker"));

test("JSON object and split UTF-8 survive the exact byte limit", async () => {
  const bytes = encoded('{"name":"é","number":1}');
  const values = Array.from(bytes, byte => new Uint8Array([byte]));
  assert.deepEqual(await readBoundedJsonObject(request(chunks(values)), {
    maxBytes: bytes.length,
  }), { name: "é", number: 1 });
  await rejects(readBoundedJsonObject(request(chunks(values)), {
    maxBytes: bytes.length - 1,
  }), "PAYLOAD_TOO_LARGE", 413);
});

for (const declared of ["-1", "1.5", "unknown", "1, 2", "99999999999999999999"]) {
  test(`invalid declared request length is rejected before reading: ${declared}`, async () => {
    let opened = false;
    const fake = {
      headers: new Headers({ "content-length": declared }),
      body: { getReader() { opened = true; throw new Error("must not read"); } },
    };
    await rejects(readBoundedJsonObject(fake), "INVALID_REQUEST", 400);
    assert.equal(opened, false);
  });
}

test("oversized declared length is rejected without opening the body", async () => {
  let opened = false;
  const fake = {
    headers: new Headers({ "content-length": "100001" }),
    body: { getReader() { opened = true; throw new Error("must not read"); } },
  };
  await rejects(readBoundedJsonObject(fake), "PAYLOAD_TOO_LARGE", 413);
  assert.equal(opened, false);
});

test("lying small Content-Length cannot permit oversized streamed content", async () => {
  await rejects(readBoundedJsonObject(
    request(chunks([encoded('{"x":"'), encoded("a".repeat(100_001))]), {
      "content-length": "2",
    }),
  ), "PAYLOAD_TOO_LARGE", 413);
});

for (const text of ["null", "[]", "1", '"synthetic-private-marker"', "{synthetic-private-marker"]) {
  test(`non-object or malformed private input is safely rejected: ${text.slice(0, 8)}`, async () => {
    await rejects(readBoundedJsonObject(request(text)), "INVALID_REQUEST", 400);
  });
}

test("invalid UTF-8 is denied rather than silently replacing evidence text", async () => {
  await rejects(readBoundedJsonObject(request(chunks([
    encoded('{"text":"'), new Uint8Array([0xff]), encoded('"}'),
  ]))), "INVALID_REQUEST", 400);
});

test("schema422 compatibility does not turn malformed JSON into schema success", async () => {
  for (const text of ["null", "[]"])
    await rejects(readBoundedJsonObject(request(text), { objectStatus: 422 }), "INVALID_SCOPE", 422);
  await rejects(readBoundedJsonObject(request("{"), { objectStatus: 422 }), "INVALID_REQUEST", 400);
});

test("stalled read and stalled cancellation cannot extend the deadline", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  await rejects(readBoundedJsonObject(request(stream), { timeoutMs: 10 }), "REQUEST_TIMEOUT", 408);
  assert.equal(cancelled, true);
});

test("oversized denial does not await a stalled cancellation hook", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoded("a".repeat(101))); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  await rejects(readBoundedJsonObject(request(stream), { maxBytes: 100 }), "PAYLOAD_TOO_LARGE", 413);
  assert.equal(cancelled, true);
});

test("pre-aborted and mid-read cancelled requests fail safely", async () => {
  const first = new AbortController();
  first.abort();
  await rejects(readBoundedJsonObject(request("{}", {}, first.signal)), "REQUEST_ABORTED", 400);
  const second = new AbortController();
  const stream = new ReadableStream({ pull() { second.abort(); } });
  await rejects(readBoundedJsonObject(request(stream, {}, second.signal)), "REQUEST_ABORTED", 400);
});

test("transport exception cannot expose private input", async () => {
  const stream = new ReadableStream({
    pull(controller) { controller.error(new Error("synthetic-private-marker")); },
  });
  await rejects(readBoundedJsonObject(request(stream)), "INVALID_REQUEST", 400);
});

test("empty chunks cannot starve the elapsed-time bound", async t => {
  let clock = 0;
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array()); },
  });
  const req = request(stream);
  t.mock.method(Date, "now", () => clock += 1_000);
  await rejects(readBoundedJsonObject(req), "REQUEST_TIMEOUT", 408);
  assert.ok(reads < 10);
});

test("a frozen Worker clock cannot permit an unbounded fragment flood", async t => {
  let reads = 0;
  const stream = new ReadableStream({
    pull(controller) { reads++; controller.enqueue(new Uint8Array()); },
  });
  const req = request(stream);
  t.mock.method(Date, "now", () => 0);
  await rejects(readBoundedJsonObject(req), "CAPACITY_REACHED", 413);
  assert.ok(reads <= 2_050);
});

test("missing body and invalid internal limits fail without reading", async () => {
  await rejects(readBoundedJsonObject(request(null)), "INVALID_REQUEST", 400);
  for (const options of [{ maxBytes: 0 }, { maxBytes: 1.5 }, { timeoutMs: -1 }])
    await assert.rejects(readBoundedJsonObject(request("{}"), options), TypeError);
});