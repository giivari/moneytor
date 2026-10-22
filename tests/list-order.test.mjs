import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sortTemporal, sortNamed, defaultSortDirection, temporalSortOptions, temporalOrderSql } from "../src/lib/list-order.ts";
import { orderAutomationInstances } from "../src/lib/automation/list-order.ts";
import { unifyAutomation } from "../src/lib/automation/composable-facade.ts";

const rows = [{id:"a",at:"2026-10-08T12:00:00+07:00"},{id:"b",at:"2026-10-09T12:00:00+07:00"}];
const ordered = (data,direction) => sortTemporal(data,direction,row=>row.at,row=>row.id);
const ids = data => data.map(row=>row.id);
test("recorded/actionable activity: 9 October precedes 8 October, oldest reverses it",()=>{
 assert.deepEqual(ids(ordered(rows,"desc")),["b","a"]);assert.deepEqual(ids(ordered(rows,"asc")),["a","b"]);
 assert.deepEqual(ids(rows),["a","b"]);
});
test("equal instants use direction-aware unique identity, independent of input order",()=>{
 const ties=[{id:"b",at:"2026-10-09T09:00:00+07:00"},{id:"a",at:"2026-10-09T02:00:00Z"}];
 assert.deepEqual(ids(ordered(ties,"asc")),["a","b"]);assert.deepEqual(ids(ordered([...ties].reverse(),"desc")),["b","a"]);
});
test("history defaults descending and future defaults nearest-first with contextual labels",()=>{
 assert.equal(defaultSortDirection("history"),"desc");assert.equal(defaultSortDirection("upcoming"),"asc");
 assert.deepEqual(temporalSortOptions.upcoming.map(row=>row.label),["Terdekat","Terjauh"]);
 assert.deepEqual(temporalSortOptions.history.map(row=>row.label),["Terbaru","Terlama"]);
});
test("sort complete filtered set before progressive reveal and direction switches",()=>{
 const data=Array.from({length:25},(_,n)=>({id:String(n).padStart(2,"0"),at:new Date(Date.UTC(2026,9,n+1)).toISOString(),kind:n%2?"expense":"income"}));
 const logical=data.filter(row=>row.kind==="expense");
 const newest=ordered(logical,"desc");const oldest=ordered(logical,"asc");
 assert.deepEqual(ids(newest.slice(0,2)),["23","21"]);assert.deepEqual(ids(oldest.slice(0,2)),["01","03"]);
 assert.deepEqual(ids(newest.slice(0,7)),["23","21","19","17","15","13","11"]);
 assert.deepEqual(ids(oldest),ids([...newest].reverse()));
});
test("missing dates stay last; names have a stable identity tie-breaker",()=>{
 assert.deepEqual(ids(ordered([...rows,{id:"missing",at:null}],"desc")),["b","a","missing"]);
 assert.deepEqual(ids(sortNamed([{id:"b",name:"BNI"},{id:"a",name:"bni"}],row=>row.name,row=>row.id)),["a","b"]);
});
function facade(){
 return unifyAutomation({ready:true,rules:[],occurrences:[{id:"schedule",rule_title:"Salary",scheduled_at:"2026-10-08T02:00:00Z",status:"pending_confirmation",kind:"income",currency_code:"IDR",exponent:0}]},
 {ready:true,rules:[],instances:[{id:"income",rule_title:"Allocation",status:"awaiting_confirmation",eligible_at:"2026-10-09T02:00:00Z",source_occurred_at:"2026-09-01T02:00:00Z",source_currency:"IDR",exponent:0,output_kind:"expense"}]},
 {ready:true,rules:[],categories:[],instances:[{id:"generic",title:"General",status:"awaiting_confirmation",trigger_namespace:"transaction_posted",eligible_at:"2026-10-09T03:00:00Z",trigger_snapshot:{kind:"income"},action_snapshot:{amount:{strategy:"fixed"}},currency_code:"IDR",exponent:0}]});
}
test("mixed legacy/generic facade orders by canonical event time, not adapter or source business date",()=>{
 const {instances}=facade();assert.deepEqual(ids(orderAutomationInstances(instances)),["generic","income","schedule"]);
 assert.deepEqual(ids(orderAutomationInstances(instances,"history","asc")),["schedule","income","generic"]);
 assert.equal(instances.find(row=>row.id==="income").at,"2026-10-09T02:00:00Z");
});
test("future adapter results use nearest-first and stable full-list reversal",()=>{
 const items=facade().instances.map(row=>({...row,status:"upcoming"}));
 assert.deepEqual(ids(orderAutomationInstances(items,"upcoming")),["schedule","income","generic"]);
 assert.deepEqual(ids(orderAutomationInstances(items,"upcoming","desc")),["generic","income","schedule"]);
});
test("bounded SQL order is explicit and rejects caller-provided SQL",()=>{
 assert.equal(temporalOrderSql("f.occurred_at","f.id"),"f.occurred_at DESC,f.id DESC");
 assert.equal(temporalOrderSql("scheduled_at","id","asc"),"scheduled_at ASC,id ASC");
 assert.throws(()=>temporalOrderSql("id; DROP TABLE assets","id"));
});
test("bounded transaction reads apply filter and stable order before page limit; Home keeps its fixed recent window",()=>{
 const finance=fs.readFileSync(new URL("../src/lib/finance/service.ts",import.meta.url),"utf8");
 assert.ok(finance.includes('ORDER BY ${temporalOrderSql("f.occurred_at", "f.id", ordering.direction)} LIMIT $2'));
 assert.ok(finance.includes('(f.occurred_at,f.id) ${ordering.operator}'));
 assert.match(fs.readFileSync(new URL("../src/app/transactions/page.tsx",import.meta.url),"utf8"),/listActivities\(false, 51\)/);
 assert.match(fs.readFileSync(new URL("../src/lib/finance/summary.ts",import.meta.url),"utf8"),/listActivities\(false, 4\)/);
});

test("legacy rule creation time retains subsecond precision before merging sources",()=>{
 const value=unifyAutomation({ready:true,occurrences:[],rules:[{id:"z",created_at:new Date("2026-10-09T02:00:00.100Z")}]},
 {ready:true,instances:[],rules:[{id:"a",created_at:new Date("2026-10-09T02:00:00.900Z")}]},
 {ready:true,instances:[],rules:[],categories:[]});
 assert.deepEqual(ids(sortTemporal(value.rules,"desc",row=>row.createdAt,row=>row.key)),["a","z"]);
});
