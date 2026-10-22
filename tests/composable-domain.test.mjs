import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneralRule, capabilities, evaluateConditions, calculateAmount, percentToBps, bpsToPercent, resolveAsset, timeOccurrences, triggerRegistry } from "../src/lib/automation/composable-domain.ts";

const a="11111111-1111-4111-8111-111111111111",b="22222222-2222-4222-8222-222222222222";
const context={namespace:"transaction_posted",identity:a,rootActivityId:a,kind:"income",status:"posted",amountMinor:"10100",currency:"IDR",destinationAssetId:a,categoryId:b,occurredAt:new Date().toISOString(),origin:"manual"};
const rule=()=>({title:"General rule",trigger:{namespace:"transaction_posted",activityKind:"income"},conditionMode:"ALL",conditions:[],
  actions:[{kind:"expense",source:{strategy:"trigger_destination_asset"},amount:{strategy:"percentage_of_trigger",percentageBps:1000},charges:[]}],execution:"confirm_before_execute"});
test("compatibility: time accepts fixed and runtime, rejects derived money and automatic runtime",()=>{
  const value=rule();value.trigger={namespace:"time",schedule:{frequency:"once",startOn:"2026-10-08",localTime:"09:00"}};
  value.actions[0].source={strategy:"configured_asset",assetId:a};
  for(const amount of [{strategy:"fixed",amountMinor:"100",currency:"IDR"},{strategy:"confirm_at_runtime"}]){
    value.actions[0].amount=amount;assert.equal(normalizeGeneralRule(value).actions[0].amount.strategy,amount.strategy);
  }
  assert.throws(()=>normalizeGeneralRule({...value,execution:"automatic"}),/konfirmasi/);
  for(const amount of [{strategy:"percentage_of_trigger",percentageBps:1000},{strategy:"trigger_amount"}]){
    value.actions[0].amount=amount;assert.throws(()=>normalizeGeneralRule(value),/cocok/);
  }
  value.actions[0].amount={strategy:"fixed",amountMinor:"100",currency:"IDR"};
  assert.equal(normalizeGeneralRule({...value,execution:"automatic"}).execution,"automatic");
});
test("compatibility metadata hides invalid Income source references and service normalization rejects them",()=>{
  const value=rule();assert.deepEqual(capabilities(value).references,["configured_asset","trigger_destination_asset"]);
  value.actions[0].source={strategy:"trigger_source_asset"};assert.throws(()=>normalizeGeneralRule(value),/Referensi aset/);
  assert.throws(()=>normalizeGeneralRule({...rule(),execution:"automatic"}),/konfirmasi/);
  const any=rule();delete any.trigger.activityKind;assert.deepEqual(capabilities(any).references,["configured_asset"]);
  any.conditions=[{field:"transaction_type",operator:"equals",value:"transfer"}];
  assert.deepEqual(capabilities(any).references,["configured_asset","trigger_source_asset","trigger_destination_asset"]);
  any.conditionMode="ANY";assert.deepEqual(capabilities(any).references,["configured_asset"]);
});
test("transaction accepts percentage, trigger amount, fixed, and runtime; V1 rejects multiple actions",()=>{
  for(const amount of [{strategy:"percentage_of_trigger",percentageBps:250},{strategy:"trigger_amount"},{strategy:"fixed",amountMinor:"100",currency:"IDR"},{strategy:"confirm_at_runtime"}]){
    const value=rule();value.actions[0].amount=amount;assert.equal(normalizeGeneralRule(value).actions[0].amount.strategy,amount.strategy);
  }
  const value=rule();value.actions.push(value.actions[0]);assert.throws(()=>normalizeGeneralRule(value),/satu tindakan/);
});
test("flat conditions: zero, ALL, ANY, category, both asset roles, currency and missing fields",()=>{
  const value=rule();assert.equal(evaluateConditions(value,context).matched,true);
  value.conditions=[{field:"transaction_category",operator:"equals",value:b},{field:"destination_asset",operator:"equals",value:a}];
  assert.equal(evaluateConditions(value,context).matched,true);
  value.conditions.push({field:"source_asset",operator:"not_equals",value:b});
  assert.equal(evaluateConditions(value,context).matched,false,"missing fields never satisfy not_equals");
  value.conditionMode="ANY";assert.equal(evaluateConditions(value,context).matched,true);
  value.conditionMode="ALL";value.conditions=[{field:"source_asset",operator:"equals",value:b},{field:"currency",operator:"equals",value:"IDR"}];
  assert.equal(evaluateConditions(value,{...context,kind:"expense",sourceAssetId:b}).matched,false,"trigger subtype also gates matches");
  value.trigger.activityKind="expense";assert.equal(evaluateConditions(value,{...context,kind:"expense",sourceAssetId:b}).matched,true);
});
for(const [operator,value,upperValue,expected] of [["equals","10100",undefined,true],["not_equals","10100",undefined,false],
  ["greater_than","10000",undefined,true],["greater_or_equal","10100",undefined,true],["less_than","10200",undefined,true],
  ["less_or_equal","10100",undefined,true],["between","10000","10100",true],["between","10101","20000",false],["greater_than","0",undefined,true],["equals","0",undefined,false]]){
  test(`amount condition ${operator} has exact boundaries`,()=>{
    const input=rule();input.conditions=[{field:"base_amount",operator,value,upperValue,currency:"IDR"}];
    assert.equal(evaluateConditions(normalizeGeneralRule(input),context).matched,expected);
    assert.equal(evaluateConditions(input,{...context,currency:"USD"}).matched,false);
  });
}
test("safe percentage parsing and exact bigint flooring, zero rejection, runtime and fixed",()=>{
  assert.equal(percentToBps("10"),1000);assert.equal(percentToBps("2.5"),250);assert.equal(percentToBps("2,50"),250);
  assert.equal(bpsToPercent(250),"2.5");assert.throws(()=>percentToBps("0"));assert.throws(()=>percentToBps("100.01"));assert.throws(()=>percentToBps("2.501"));
  assert.equal(calculateAmount({strategy:"percentage_of_trigger",percentageBps:250},{...context,amountMinor:"101"}),"2");
  assert.equal(calculateAmount({strategy:"percentage_of_trigger",percentageBps:1000},{...context,amountMinor:"100000"}),"10000");
  assert.equal(calculateAmount({strategy:"trigger_amount"},context),"10100");
  assert.equal(calculateAmount({strategy:"fixed",amountMinor:"99",currency:"IDR"},context),"99");
  assert.equal(calculateAmount({strategy:"confirm_at_runtime"},context),undefined);
  assert.equal(calculateAmount({strategy:"confirm_at_runtime"},context,"777"),"777");
  assert.throws(()=>calculateAmount({strategy:"percentage_of_trigger",percentageBps:250},{...context,amountMinor:"1"}));
  assert.equal(calculateAmount({strategy:"percentage_of_trigger",percentageBps:10000},{...context,amountMinor:"9223372036854775807"}),"9223372036854775807");
});
test("typed references require available context and never infer Income source",()=>{
  assert.equal(resolveAsset({strategy:"trigger_destination_asset"},context),a);
  assert.throws(()=>resolveAsset({strategy:"trigger_source_asset"},context));
  assert.equal(resolveAsset({strategy:"configured_asset",assetId:b},context),b);
});
test("time adapter preserves Jakarta-to-UTC identities and all six patterns",()=>{
  const base={startOn:"2026-10-01",localTime:"09:00"};
  assert.deepEqual(timeOccurrences({...base,frequency:"once"},"2026-10-01","2026-10-08"),["2026-10-01T02:00:00.000Z"]);
  assert.equal(timeOccurrences({...base,frequency:"daily"},"2026-10-01","2026-10-08").length,8);
  assert.equal(timeOccurrences({...base,frequency:"weekdays"},"2026-10-01","2026-10-08").length,6);
  assert.equal(timeOccurrences({...base,frequency:"weekly",weekday:1},"2026-10-01","2026-10-08").length,1);
  assert.equal(timeOccurrences({...base,frequency:"monthly_day",monthDay:8},"2026-10-01","2026-10-31").length,1);
  assert.deepEqual(timeOccurrences({...base,frequency:"monthly_last_day"},"2026-10-01","2026-10-31"),["2026-10-31T02:00:00.000Z"]);
  assert.equal(triggerRegistry.transaction_posted.getStableTriggerIdentity(context),a);
});
