import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {orderPlanning} from '../src/lib/planning/list-order.ts';
import {activityReadOrder} from '../src/lib/finance/activity-order.ts';
registerHooks({load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {FinancialDataTable,FinancialTable}=await import('../src/components/financial-data-table.tsx');
const today='2026-10-09';
const common={currency:'IDR',isActive:true,createdAt:'2026-10-08T00:00:00Z'};
const budget=(id,extra={})=>({...common,id,kind:'budget',limitMinor:'100',spentMinor:'0',periodStart:'2026-10-01',periodEnd:'2026-10-31',...extra});
const goal=(id,extra={})=>({...common,id,kind:'goal',targetMinor:'100',progressMinor:'0',targetOn:null,...extra});
const obligation=(id,extra={})=>({...common,id,kind:'obligation',amountMinor:'100',uncoveredMinor:'100',dueOn:'2026-10-20',status:'open',...extra});
const reserve=(id,extra={})=>({...common,id,kind:'reserve',amountMinor:'100',...extra});
const ids=(rows,mode)=>orderPlanning(rows,mode,today).map(row=>row.id);
test('budgets prioritize active period, nearest future, then most recent past',()=>{
 assert.deepEqual(ids([budget('past',{periodStart:'2026-09-01',periodEnd:'2026-09-30'}),budget('later',{periodStart:'2027-01-01',periodEnd:'2027-01-31'}),budget('active'),budget('next',{periodStart:'2026-11-01',periodEnd:'2026-11-30'})],'current'),['active','next','later','past']);
});
test('budget usage uses exact existing spent/limit ratio, including overspending',()=>{
 assert.deepEqual(ids([budget('b',{spentMinor:'80'}),budget('a',{spentMinor:'120'}),budget('c',{limitMinor:'1000000000000000000000000',spentMinor:'1100000000000000000000000'})],'usage'),['a','c','b']);
});
test('remaining monetary balance differs from percentage utilization',()=>{
 const rows=[budget('large',{limitMinor:'100000',spentMinor:'90000'}),budget('small',{limitMinor:'100',spentMinor:'50'}),budget('over',{spentMinor:'120'})];
 assert.deepEqual(ids(rows,'remaining'),['over','small','large']);assert.deepEqual(ids(rows,'usage'),['over','large','small']);
});
test('target deadline order keeps missing deadlines last in both directions',()=>{
 const rows=[goal('none'),goal('far',{targetOn:'2027-01-01'}),goal('near',{targetOn:'2026-11-01'})];
 assert.deepEqual(ids(rows,'due_asc'),['near','far','none']);assert.deepEqual(ids(rows,'due_desc'),['far','near','none']);
});
test('target completion priority is independent of deadline and creation time',()=>{
 const rows=[goal('twenty',{progressMinor:'20',targetOn:'2026-10-10'}),goal('ninety',{progressMinor:'90',targetOn:'2027-12-01'})];
 assert.deepEqual(ids(rows,'progress_desc'),['ninety','twenty']);assert.deepEqual(ids(rows,'progress_asc'),['twenty','ninety']);
});
test('zero targets, completed and archived records cannot destabilize active priorities',()=>{
 const rows=[goal('archived',{isActive:false,progressMinor:'99'}),goal('done',{progressMinor:'100'}),goal('zero',{targetMinor:'0'}),goal('open',{progressMinor:'90'})];
 assert.deepEqual(ids(rows,'progress_desc'),['open','zero','done','archived']);
});
test('overdue obligations stay before future obligations, closed stay after open',()=>{
 assert.deepEqual(ids([obligation('future'),obligation('overdue',{dueOn:'2026-10-01'}),obligation('done',{status:'settled',dueOn:'2026-01-01'})],'due_asc'),['overdue','future','done']);
});
test('obligation uncovered sort uses existing coverage result and stable zero ties',()=>{
 assert.deepEqual(ids([obligation('c',{uncoveredMinor:'0'}),obligation('b',{uncoveredMinor:'50'}),obligation('a',{uncoveredMinor:'0'})],'uncovered'),['b','a','c']);
});
test('reserve amounts remain bigint safe and incomparable currencies are grouped',()=>{
 assert.deepEqual(ids([reserve('b',{amountMinor:'9007199254740993'}),reserve('a',{amountMinor:'9007199254740994'}),reserve('usd',{currency:'USD',amountMinor:'99999999999999999'})],'amount_desc'),['a','b','usd']);
});
test('every contextual comparison has deterministic identity ties and does not mutate source',()=>{
 const rows=[reserve('b'),reserve('a')];assert.deepEqual(ids(rows,'amount_asc'),['a','b']);assert.deepEqual(rows.map(r=>r.id),['b','a']);
 assert.deepEqual(ids([goal('b',{progressMinor:'25'}),goal('a',{progressMinor:'50',targetMinor:'200'})],'progress_desc'),['a','b']);
});
test('keyset order validates direction, kind, and exact microsecond boundaries',()=>{
 assert.equal(activityReadOrder({}).operator,'<');assert.equal(activityReadOrder({direction:'asc'}).operator,'>');
 assert.equal(activityReadOrder({after:{at:'2026-10-09 02:00:00.123456+00',id:'11111111-1111-4111-8111-111111111111'}}).after.at,'2026-10-09 02:00:00.123456+00');
 assert.throws(()=>activityReadOrder({direction:'desc;drop table assets'}));assert.throws(()=>activityReadOrder({kind:'buy'}));assert.throws(()=>activityReadOrder({after:{at:'invalid',id:'no'}}));
});
test('desktop table has semantic headers, aligned numeric cells, and exactly one record',()=>{
 const records=[{id:'a',amount:'−Rp999.999.999.999.999'}];
 const html=renderToStaticMarkup(React.createElement(FinancialTable,{label:'Riwayat',records,identity:r=>r.id,columns:[{key:'identity',heading:'Aktivitas',render:r=>'Unik '+r.id},{key:'amount',heading:'Nominal',numeric:true,render:r=>r.amount}]}));
 assert.match(html,/<table/);assert.match(html,/<caption/);assert.match(html,/scope="col"/);assert.match(html,/data-numeric="true"/);assert.equal((html.match(/Unik a/g)||[]).length,1);assert.match(html,/−Rp999.999.999.999.999/);
});
test('compact presentation renders the same ordered identities once without a desktop table',()=>{
 const records=[{id:'b'},{id:'a'}];const html=renderToStaticMarkup(React.createElement(FinancialDataTable,{label:'Aktivitas',records,identity:r=>r.id,columns:[],compact:r=>React.createElement('article',null,r.id)}));
 assert.doesNotMatch(html,/<table/);assert.equal((html.match(/<article>/g)||[]).length,2);assert.ok(html.indexOf('>b<')<html.indexOf('>a<'));
});

test('Expense charges display once while Transfer principal excludes its separately shown fee',async()=>{
 const {activityValueMinor}=await import('../src/lib/record-values.ts');
 assert.equal(activityValueMinor({kind:'expense',baseAmountMinor:'10000',charges:[{amountMinor:'500'},{amountMinor:'250'}]}),'10750');
 assert.equal(activityValueMinor({kind:'transfer',baseAmountMinor:'10000',charges:[{amountMinor:'500'}]}),'10000');
 assert.equal(activityValueMinor({kind:'income',baseAmountMinor:'10000',charges:[]}),'10000');
});
test('Investment cash movement keeps purchase/sale proceeds distinct from fees and ordinary expenses',async()=>{
 const {investmentCashMinor}=await import('../src/lib/record-values.ts');
 assert.equal(investmentCashMinor({kind:'buy',grossMinor:'10000',feeMinor:'500'}),'10500');
 assert.equal(investmentCashMinor({kind:'sell',grossMinor:'10000',feeMinor:'500'}),'9500');
});
