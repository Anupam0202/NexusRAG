import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { modelLimits, resetGeminiModelMemory } from "../../apps/gateway/src/gemini-models.js";
import { docxText, extractFileText, READ_TIME_LIMITS } from "../../apps/gateway/src/worker-lifecycle.js";
import { chunkText, TOO_LONG_TO_INDEX } from "../../apps/gateway/src/worker-pipeline.js";
import { whileHoldingLease } from "../../apps/gateway/src/worker-jobs.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_URL: "https://supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-only", GOOGLE_API_KEY: "synthetic-gemini-only" };
const context = { workspaceId, priority: "background", dataClassification: "non_sensitive" };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const read = (text, finishReason = "STOP") => json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] });
const pdf = (bytes = 2_000) => new File([`%PDF-1.7 ${"x".repeat(bytes - 9)}`], "policy.pdf", { type: "application/pdf" });

// A healthy quota ledger; `gemini` answers each read in turn. Every reservation and request is kept.
function provider(...answers) {
  const calls = { reserved: [], requests: [] };
  let sequence = 0;
  const fetch = async (rawUrl, init = {}) => {
    const url = String(rawUrl);
    if (url.endsWith("/rpc/v6_reserve_many")) {
      const dimensions = JSON.parse(init.body).p_dimensions;
      calls.reserved.push(dimensions);
      return json({ state: "READY", reservations: Object.values(dimensions).map((amount) => ({ id: `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`, amount })) });
    }
    if (url.endsWith("/rpc/v6_settle_many")) return json({ state: JSON.parse(init.body).p_provider_called ? "SETTLED" : "RELEASED" });
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      const body = JSON.parse(init.body);
      calls.requests.push({ model: decodeURIComponent(new URL(url).pathname.split("/models/")[1].split(":")[0]),
        maxOutputTokens: body.generationConfig.maxOutputTokens, file: body.contents[0].parts[1].inlineData, signal: init.signal });
      const answer = answers[Math.min(calls.requests.length, answers.length) - 1];
      return typeof answer === "function" ? answer(init) : answer.clone();
    }
    throw new Error(`unexpected request: ${url}`);
  };
  return { fetch, calls };
}
function gateway(t, ...answers) {
  resetGeminiModelMemory();
  const world = provider(...answers);
  t.mock.method(globalThis, "fetch", world.fetch);
  return world.calls;
}

test("the pinned models' published limits are used, and an unlisted model gets limits safe for any model", () => {
  assert.deepEqual(modelLimits("gemini-3.5-flash-lite"), { inputTokens: 1_048_576, outputTokens: 65_536 });
  assert.deepEqual(modelLimits("gemini-3.1-flash-lite"), { inputTokens: 1_048_576, outputTokens: 65_536 });
  for (const unlisted of ["gemini-flash-latest", "gemini-9-ultra", ""]) assert.deepEqual(modelLimits(unlisted), { inputTokens: 2_097_152, outputTokens: 8_192 });
});

test("a short PDF is read in one small call and counted at that size", async (t) => {
  const calls = gateway(t, read("[PAGE 1] Retention is 30 days."));
  const extracted = await extractFileText(env, pdf(), context);
  assert.equal(extracted.text, "[PAGE 1] Retention is 30 days.");
  assert.deepEqual([extracted.method, extracted.manifest], ["gemini-pdf-extraction-v1", { model: "gemini-3.5-flash-lite", mime_type: "application/pdf" }]);
  assert.deepEqual(calls.requests.map((call) => call.maxOutputTokens), [8_192]);
  assert.deepEqual(calls.reserved, [{ requests: 1, input_tokens: 2_256, output_tokens: 8_192 }]);
});

test("a PDF cut off at the small size is read again with the model's full limit", async (t) => {
  const calls = gateway(t, read("[PAGE 1] The first pages", "MAX_TOKENS"), read("[PAGE 1] The first pages ... [PAGE 80] The last page."));
  const extracted = await extractFileText(env, pdf(), context);
  assert.equal(extracted.text, "[PAGE 1] The first pages ... [PAGE 80] The last page.", "nothing of the cut-off read is kept");
  assert.deepEqual(extracted.manifest, { model: "gemini-3.5-flash-lite", mime_type: "application/pdf", read: "full" });
  assert.deepEqual(calls.requests.map((call) => call.maxOutputTokens), [8_192, 65_536]);
  assert.deepEqual(calls.requests[0].file, calls.requests[1].file, "the same file is sent both times");
  // Only the long read is counted at the full limit.
  assert.deepEqual(calls.reserved.map((dimensions) => dimensions.output_tokens), [8_192, 65_536]);
});

test("a document too long even for the full read fails whole and says how long one may be", async (t) => {
  const calls = gateway(t, read("start", "MAX_TOKENS"), read("start and more", "MAX_TOKENS"));
  await assert.rejects(extractFileText(env, pdf(), context), (error) => {
    assert.equal(error.code, "EXTRACTION_INCOMPLETE");
    assert.equal(error.message, "This document holds more text than can be read in one pass (roughly 100 pages). Split it into smaller files and upload them separately; nothing of it was indexed.");
    return !error.retryable;
  });
  assert.equal(calls.requests.length, 2);

  // A model whose limit is not published has only the small read; it is not asked twice for the same thing.
  const unlisted = gateway(t, read("start", "MAX_TOKENS"));
  await assert.rejects(extractFileText({ ...env, GEMINI_MODEL: "gemini-9-ultra" }, pdf(), context),
    (error) => error.code === "EXTRACTION_INCOMPLETE" && error.message.includes("roughly 10 pages"));
  assert.deepEqual(unlisted.requests.map((call) => [call.model, call.maxOutputTokens]), [["gemini-9-ultra", 8_192]]);
});

test("a read that Gemini ends for another reason is named, never indexed in part and not repeated", async (t) => {
  for (const [reason, expected] of [
    ["RECITATION", "Gemini stopped reading this document before its end (RECITATION), so nothing of it was indexed. It does that with text it recognises as published elsewhere."],
    ["SAFETY", "Gemini stopped reading this document before its end (SAFETY), so nothing of it was indexed."],
    ["<script>alert(1)</script>", "Gemini stopped reading this document before its end (UNKNOWN), so nothing of it was indexed."],
  ]) {
    const calls = gateway(t, read("Half of the text", reason));
    await assert.rejects(extractFileText(env, pdf(), context), (error) => error.code === "EXTRACTION_INCOMPLETE" && error.message === expected, reason);
    assert.equal(calls.requests.length, 1, reason);
    t.mock.restoreAll();
  }
  gateway(t, read("   "));
  await assert.rejects(extractFileText(env, pdf(), context), { code: "EMPTY_DOCUMENT" });
});

test("a large file is never counted at more input than a request to its model can be", async (t) => {
  let calls = gateway(t, read("text"));
  await extractFileText(env, pdf(3_000_000), context);
  assert.equal(calls.reserved[0].input_tokens, 1_048_576, "the pinned model's input limit, not three million");
  t.mock.restoreAll();
  calls = gateway(t, read("text"));
  await extractFileText({ ...env, GEMINI_MODEL: "gemini-9-ultra" }, pdf(3_000_000), context);
  assert.equal(calls.reserved[0].input_tokens, 2_097_152);
  t.mock.restoreAll();
  // A scanned page is read the same way.
  calls = gateway(t, read("Scanned text"));
  const image = await extractFileText(env, new File(["synthetic image bytes"], "scan.png", { type: "image/png" }), context);
  assert.deepEqual([image.method, calls.reserved[0].input_tokens, calls.requests[0].file.mimeType], ["gemini-ocr-v1", 21 + 256, "image/png"]);
});

test("a first read has time for a multi-page PDF, and a full read for a long one", () => {
  // Live on the preview, 20 November: a 30-page PDF, whose text fits the first read, ran past the old 55-second
  // limit on all three attempts and failed. The job's lease is renewed while a read runs, so neither limit is tied
  // to the lease; each only bounds a read that never answers.
  assert.ok(READ_TIME_LIMITS.first >= 180_000, `first read limit ${READ_TIME_LIMITS.first} ms`);
  assert.ok(READ_TIME_LIMITS.full >= READ_TIME_LIMITS.first);
});

test("every read is logged with its model, size and outcome, and never with the document's text", async (t) => {
  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(JSON.parse(line)));
  gateway(t, json({ candidates: [{ content: { parts: [{ text: "[PAGE 1] Retention is 30 days." }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 1290, candidatesTokenCount: 14, thoughtsTokenCount: 0 } }));
  await extractFileText(env, pdf(), context);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].event, "gemini_read");
  assert.deepEqual([logs[0].model, logs[0].read, logs[0].outcome, logs[0].status, logs[0].finish, logs[0].output_tokens, logs[0].input_tokens],
    ["gemini-3.5-flash-lite", "first", "ok", 200, "STOP", 14, 1290]);
  assert.ok(Number.isSafeInteger(logs[0].ms) && logs[0].ms >= 0);
  assert.ok(!JSON.stringify(logs).includes("Retention"), "no document text in the log");
  t.mock.restoreAll();

  // A refused read keeps Gemini's own reason, so an operator can tell an overload from anything else.
  const failed = [];
  t.mock.method(console, "log", (line) => failed.push(JSON.parse(line)));
  gateway(t, json({ error: { code: 503, message: "The model is overloaded. Please try again later.", status: "UNAVAILABLE" } }, 503));
  await assert.rejects(extractFileText(env, pdf(), context), (error) => error.code === "EXTRACTION_FAILED" && error.retryable === true);
  assert.deepEqual([failed[0].event, failed[0].outcome, failed[0].status, failed[0].reason, failed[0].detail],
    ["gemini_read", "failed", 503, "UNAVAILABLE", "The model is overloaded. Please try again later."]);
  t.mock.restoreAll();

  // No answer at all is logged as such.
  const silent = [];
  t.mock.method(console, "log", (line) => silent.push(JSON.parse(line)));
  gateway(t, () => { throw new TypeError("synthetic network failure"); });
  await assert.rejects(extractFileText(env, pdf(), context), (error) => error.code === "EXTRACTION_FAILED");
  assert.deepEqual([silent[0].event, silent[0].outcome], ["gemini_read", "no_answer"]);
});

test("no answer in time is a failure worth retrying; a job that gave the read up gets its own abort back", async (t) => {
  gateway(t, () => { throw new TypeError("synthetic network failure"); });
  await assert.rejects(extractFileText(env, pdf(), context), (error) =>
    error.code === "EXTRACTION_FAILED" && error.retryable === true && error.message === "Gemini did not finish reading this document in time. Try again shortly.");
  t.mock.restoreAll();

  const givenUp = new AbortController();
  const calls = gateway(t, (init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason))));
  const pending = extractFileText(env, pdf(), { ...context, signal: givenUp.signal });
  await new Promise((resolve) => setImmediate(resolve));
  givenUp.abort(new Error("lease lost"));
  await assert.rejects(pending, { message: "lease lost" });
  assert.equal(calls.requests.length, 1);
});

// A .docx is a ZIP whose word/document.xml holds the text.
function zip(entries) {
  const parts = [];
  for (const { name, content, deflate = false } of entries) {
    const raw = Buffer.from(content), data = deflate ? deflateRawSync(raw) : raw, header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(Buffer.byteLength(name), 26);
    parts.push(header, Buffer.from(name), data);
  }
  return Buffer.concat(parts);
}
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const body = (inner) => `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="w" xmlns:wp="wp" xmlns:mc="mc" xmlns:m="m"><w:body>${inner}</w:body></w:document>`;
const paragraph = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.join("")}</w:p>`;
const run = (text) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

test("a Word document's text is what the document shows, paragraph by paragraph", () => {
  const xml = body([
    paragraph(run("Retention policy")),
    paragraph(run("Records are kept for "), run("47 days"), "<w:r><w:tab/><w:t>then erased.</w:t></w:r>"),
    paragraph(run("First line"), "<w:r><w:br/><w:t>second line</w:t></w:r>", '<w:r><w:br w:type="page"/><w:t>next page</w:t></w:r>'),
    paragraph(run("Smith &amp; Jones &lt;legal&gt; say &quot;no&quot; &#8212; it&#x2019;s final &apos;now&apos;")),
    paragraph(run("non"), "<w:r><w:noBreakHyphen/><w:t>breaking</w:t></w:r>"),
  ].join(""));
  assert.equal(docxText(xml), [
    "Retention policy",
    "Records are kept for 47 days\tthen erased.",
    "First line\nsecond line\nnext page",
    "Smith & Jones <legal> say \"no\" — it’s final 'now'",
    "non-breaking",
  ].join("\n"));
});

test("what Word stores but does not show stays out of the text", () => {
  const xml = body([
    // A page-number field: its instruction is not text, its shown result is.
    paragraph('<w:r><w:fldChar w:fldCharType="begin"/></w:r>', "<w:r><w:instrText> PAGE \\* MERGEFORMAT </w:instrText></w:r>", run("Page 3")),
    // A tracked deletion and its replacement.
    paragraph("<w:del><w:r><w:delText>90 days</w:delText></w:r></w:del>", "<w:ins>" + run("47 days") + "</w:ins>"),
    // A text box: Word stores the same text a second time as a fallback, with drawing coordinates beside it.
    paragraph(`<mc:AlternateContent><mc:Choice Requires="wps"><wp:anchor><wp:positionH><wp:posOffset>914400</wp:posOffset></wp:positionH>${run("Boxed note")}</wp:anchor></mc:Choice><mc:Fallback><w:pict>${run("Boxed note")}</w:pict></mc:Fallback></mc:AlternateContent>`),
    // An equation, and an attribute that contains an angle bracket.
    paragraph('<m:oMath><m:r><m:t>a &lt; b</m:t></m:r></m:oMath><w:r><w:rPr><w:rStyle w:val="a>b"/></w:rPr><w:t> holds</w:t></w:r>'),
    paragraph("<w:r><w:t>An unknown &entity; and &#0; stay as written</w:t></w:r>"),
  ].join(""));
  assert.equal(docxText(xml), ["Page 3", "47 days", "Boxed note", "a < b holds", "An unknown &entity; and &#0; stay as written"].join("\n"));
  assert.equal(docxText(body("<w:p><w:r><w:instrText>TOC</w:instrText></w:r></w:p><w:p/>")), "");
});

test("a .docx file is read from its archive, stored or compressed, and an empty one is refused", async () => {
  const xml = body(paragraph(run("Clause 1. ")) + paragraph(run("The supplier pays within 30 days.")));
  for (const deflate of [false, true]) {
    const file = new File([zip([{ name: "[Content_Types].xml", content: "<Types/>" }, { name: "word/document.xml", content: xml, deflate }])], "contract.docx", { type: DOCX });
    const extracted = await extractFileText(env, file, context);
    assert.deepEqual([extracted.text, extracted.method, extracted.manifest], ["Clause 1.\nThe supplier pays within 30 days.", "worker-docx-xml-v2", { archive_entries: 2 }]);
  }
  const empty = new File([zip([{ name: "word/document.xml", content: body("<w:p/>") }])], "empty.docx", { type: DOCX });
  await assert.rejects(extractFileText(env, empty, context), { code: "EMPTY_DOCUMENT" });
  const other = new File([zip([{ name: "word/styles.xml", content: "<w:styles/>" }])], "broken.docx", { type: DOCX });
  await assert.rejects(extractFileText(env, other, context), { code: "DOCX_INVALID" });
});

test("a document too long to index says so in plain words", () => {
  assert.throws(() => chunkText("word ".repeat(120_000)), (error) => error.code === "CAPACITY_REACHED" && error.message === TOO_LONG_TO_INDEX);
  assert.match(TOO_LONG_TO_INDEX, /roughly 300 pages.*Split it into smaller files/);
  assert.equal(chunkText("word ".repeat(100_000)).length <= 400, true);
});

test("the lease is renewed while a long read runs, and the read is given up when the lease is gone", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const claim = { job: { id: "22222222-2222-4222-8222-222222222222", lifecycle_epoch: 1 }, owner: "cfq:synthetic", generation: 3 };
  const renewals = [];
  let held = true, databaseUp = true;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(String(url), /\/rest\/v1\/ingestion_jobs\?id=eq\.22222222-2222-4222-8222-222222222222&status=eq\.processing&lease_owner=eq\.cfq%3Asynthetic&lease_generation=eq\.3/);
    renewals.push(Object.keys(JSON.parse(init.body)).sort());
    if (!databaseUp) return new Response("unavailable", { status: 503 });
    return json(held ? [{ id: claim.job.id }] : []);
  });
  const settle = async () => { for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

  let finish, signal;
  const work = whileHoldingLease(env, claim, (given) => { signal = given; return new Promise((resolve) => { finish = resolve; }); });
  t.mock.timers.tick(119_999);
  await settle();
  assert.equal(renewals.length, 0);
  t.mock.timers.tick(1);
  await settle();
  t.mock.timers.tick(120_000);
  await settle();
  assert.deepEqual(renewals, [["heartbeat_at", "lease_expires_at"], ["heartbeat_at", "lease_expires_at"]]);
  assert.equal(signal.aborted, false);

  // The database not answering once is not a lost lease.
  databaseUp = false;
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(signal.aborted, false);
  // The job was cancelled or taken over: the read is told to stop.
  databaseUp = true; held = false;
  t.mock.timers.tick(120_000);
  await settle();
  assert.equal(signal.aborted, true);

  finish("extracted");
  assert.equal(await work, "extracted");
  const before = renewals.length;
  t.mock.timers.tick(600_000);
  await settle();
  assert.equal(renewals.length, before, "no renewal after the read has ended");

  // A read that fails still stops the renewals.
  await assert.rejects(whileHoldingLease(env, claim, async () => { throw new Error("read failed"); }), { message: "read failed" });
  t.mock.timers.tick(600_000);
  await settle();
  assert.equal(renewals.length, before);
});
