import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {classifyRadarChange,normalizeRadarText} from "../../apps/gateway/src/radar-materiality.js";
const cases=JSON.parse(await readFile(new URL("../fixtures/radar-materiality.json",import.meta.url),"utf8"));
for(const value of cases)test(`Radar contextual materiality: ${value.name}`,()=>{
  const result=classifyRadarChange(value.before,value.after);
  assert.equal(result.changed,normalizeRadarText(value.before)!==normalizeRadarText(value.after));
  assert.equal(result.materiality,value.materiality);assert.deepEqual(result.matched_signals,value.signals);
});
test("repeated unchanged quota context leaves unrelated editorial numbers editorial",()=>{
  const repeated="Quota: 100 requests per day. ".repeat(5000);
  assert.equal(classifyRadarChange(repeated+"Page count: 12.",repeated+"Page count: 13.").materiality,"EDITORIAL");
});
test("an absent comparison is not silently treated as unchanged",()=>{
  assert.throws(()=>classifyRadarChange(null,"Quota: 10."),TypeError);
});
test("normalization preserves BOM and matches all existing whitespace",()=>{
  const whitespace=[...Array.from({length:5},(_,i)=>i+9),...Array.from({length:5},(_,i)=>i+28),133,160,5760,
    ...Array.from({length:11},(_,i)=>i+8192),8232,8233,8239,8287,12288];
  for(const codepoint of whitespace){const separator=String.fromCodePoint(codepoint);
    assert.equal(normalizeRadarText(separator+"Quota"+separator+"100"+separator),"Quota 100",`U+${codepoint.toString(16)}`);}
  assert.equal(normalizeRadarText("\ufeffQuota 100\ufeff"),"\ufeffQuota 100\ufeff");
});
test("exact large decimal within complete comparison projection is not rounded",()=>{
  const prefix="Quota: "+"9".repeat(65000);
  assert.equal(classifyRadarChange(prefix+"1.",prefix+"2.").materiality,"OPERATIONAL");
});
