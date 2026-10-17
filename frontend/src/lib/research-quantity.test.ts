import {expect,it} from "vitest";
import {confirmedQuantityCapture,literalSourceSelections,numericSourceSelections} from "./research-quantity";
import {record,sourceText} from "@/test/fixtures/research-quantity";
it("maps native string matches to exact PostgreSQL codepoint spans including repeated units",()=>{
  const values=numericSourceSelections(sourceText),units=literalSourceSelections(sourceText,"kg");
  expect(values[0]).toEqual({start:8,end:13,text:"1.005",key:"8:13"});expect(units[0]).toEqual({start:14,end:16,text:"kg",key:"14:16"});expect(units).toHaveLength(2);
  for(const item of [...values,...units])expect(Array.from(sourceText).slice(item.start,item.end).join("")).toBe(item.text);
});
it("preserves decimal lexemes and bounds source selection lists",()=>{
  expect(numericSourceSelections("1e3 +1.20 -.25").map(x=>x.text)).toEqual(["1e3","+1.20","-.25"]);
  expect(numericSourceSelections("1 ".repeat(1000))).toHaveLength(200);expect(literalSourceSelections("kg ".repeat(1000),"kg")).toHaveLength(200);
});
it("does not offer fragments of grouped, locale or overlong exponent numbers",()=>{
  expect(numericSourceSelections("1,005 2,20 12e9999")).toEqual([]);
  expect(numericSourceSelections("1, 2").map(item=>item.text)).toEqual(["1","2"]);
});
it("confirms exact source contexts but never upgrades excerpt matching to claim support",()=>{
  expect(confirmedQuantityCapture(record,"plan-a")).toBe(true);expect(confirmedQuantityCapture({...record,source_state:"SUPPORTED"},"plan-a")).toBe(false);
  expect(confirmedQuantityCapture({...record,quantity:{...record.quantity,value:"2"}},"plan-a")).toBe(false);
  expect(confirmedQuantityCapture({...record,source_state:"SOURCE_UNAVAILABLE",freshness:"unavailable",quantity:null,source:null},"plan-a")).toBe(true);
});
