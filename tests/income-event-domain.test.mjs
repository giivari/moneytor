import test from "node:test";
import assert from "node:assert/strict";
import { percentageOfIncome } from "../src/lib/automation/percentage.ts";

test("basis points use exact bigint floor arithmetic",() => {
  assert.equal(percentageOfIncome("100000",1000),"10000");
  assert.equal(percentageOfIncome("100000",250),"2500");
  assert.equal(percentageOfIncome("101",250),"2");
  assert.equal(percentageOfIncome("922337203685477",10000),"922337203685477");
  assert.throws(() => percentageOfIncome("1",250),/satu unit/);
  assert.throws(() => percentageOfIncome("10",0),/tidak valid/);
  assert.throws(() => percentageOfIncome("10",10001),/tidak valid/);
});
