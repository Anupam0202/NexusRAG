import test from "node:test";
import assert from "node:assert/strict";
import { parseModelJson, replyShape } from "../../apps/gateway/src/model-json.js";

// Live on 2026-11-21, Gemini wrapped every JSON reply in a Markdown code fence (issue #29).
test("a reply is read as JSON as it stands or inside one surrounding code fence", () => {
  const value = { cells: [{ document_id: "a", answer: "30 days [S1]" }] }, text = JSON.stringify(value);
  for (const reply of [text, `  ${text}\n`, "```json\n" + text + "\n```", "```JSON\r\n" + text + "\r\n```", "```\n" + text + "\n```",
    "```json\n" + JSON.stringify(value, null, 2) + "\n  ```"])
    assert.deepEqual(parseModelJson(reply), value, reply);
});

test("anything else is refused: prose around a fence, two fences, or text that is not JSON", () => {
  const text = '{"queries":["a"]}';
  for (const reply of ["Here is the JSON:\n```json\n" + text + "\n```", "```json\n" + text + "\n```\n```json\n" + text + "\n```",
    "```json\n" + text, "The answer is 30 days.", "", undefined, null])
    assert.throws(() => parseModelJson(reply), SyntaxError, String(reply));
});

test("the shape of a reply keeps its structure and drops its text", () => {
  const reply = "```json\n" + JSON.stringify({
    schema_version: "research-calculation-wire/1",
    quantities: [{ label: "Unit price", value: "420", anchor: ["S1", 10, 40], unit: ["EUR", "million"], period: null, ok: true }, {}, {}, {}],
    "The supplier shall deliver within 30 days": 1,
    nested: { a: { b: { c: { d: "deep text" } } } },
  }) + "\n```";
  const shape = replyShape(reply);
  assert.deepEqual(shape, { parsed: true, shape: {
    schema_version: "string(27)",
    quantities: { length: 4, first: [{ label: "string(10)", value: "string(3)", anchor: { length: 3, first: ["string(2)", "number", "number"] },
      unit: { length: 2, first: ["string(3)", "string(7)"] }, period: "null", ok: "boolean" }, {}, {}] },
    "key(41)": "number",
    nested: { a: { b: { c: "object" } } },
  } });
  const logged = JSON.stringify(shape);
  for (const text of ["Unit price", "420", "EUR", "supplier", "deep text"]) assert.ok(!logged.includes(text), text);
});

test("a reply that is not JSON is described by its length and whether it starts with a fence", () => {
  assert.deepEqual(replyShape("The supplier shall deliver within 30 days."), { parsed: false, characters: 42, fenced: false });
  const cut = "```json\n{\"cells\": [\n```";
  assert.deepEqual(replyShape(cut), { parsed: false, characters: Array.from(cut).length, fenced: true });
  assert.deepEqual(replyShape(undefined), { parsed: false, characters: 0, fenced: false });
});
