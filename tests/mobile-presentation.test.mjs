import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readableMoneyMarkup} from './rendered-money.mjs';

registerHooks({
 resolve(specifier, context, next) {
  const url = specifier.startsWith('@/') ? new URL('../src/'+specifier.slice(2),import.meta.url)
   : specifier.startsWith('.') && context.parentURL ? new URL(specifier,context.parentURL) : null;
  if(url && !/\.[a-z]+$/i.test(url.pathname)) for(const extension of ['.tsx','.ts']) {
   const file = new URL(url.href+extension); if(fs.existsSync(file)) return next(file.href,context);
  }
  return next(specifier,context);
 },
 load(url, context, next) {
  if(url.endsWith('.tsx')) return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
  return next(url,context);
 }
});
const {CompactFinancialRow} = await import('../src/components/compact-financial-row.tsx');
const {MoneyMovementRow} = await import('../src/components/money-movement-row.tsx');
const {ListFilterControl} = await import('../src/components/list-filter-control.tsx');
const {ListToolbar} = await import('../src/components/list-toolbar.tsx');
const {ListSortControl} = await import('../src/components/list-sort-control.tsx');
const {AutomationConfirmButton} = await import('../src/components/automation-confirm-button.tsx');
const html = (component,props) => readableMoneyMarkup(renderToStaticMarkup(React.createElement(component,props)));

test('record anatomy keeps one signed value beside identity, with supporting context afterwards',()=>{
 const output=html(MoneyMovementRow,{kind:'expense',title:'Makan',context:'BNI',amount:'−Rp100.000',date:'9 Okt'});
 assert.match(output,/compact-financial-row--record/);
 assert.ok(output.indexOf('>Makan<')<output.indexOf('−Rp100.000'));
 assert.ok(output.indexOf('−Rp100.000')<output.indexOf('BNI'));
 assert.equal(output.split('−Rp100.000').length-1,1);
 assert.doesNotMatch(output,/<table|<td|<button/);
});
test('mobile movement metadata uses account and Automation label without expanding full provenance',()=>{
 const output=html(MoneyMovementRow,{kind:'income',title:'Gaji',context:'Gaji · BNI',compactContext:'BNI',provenance:'Alokasi pendapatan panjang',amount:'+Rp1.100.000',date:'9 Okt'});
 assert.match(output,/BNI · Otomatisasi · 9 Okt/);
 assert.doesNotMatch(output,/Alokasi pendapatan panjang|Gaji · BNI/);
});
test('large negative values remain intact and request the wide money slot',()=>{
 const amount='−Rp999.999.999.999.999.999.999';
 const output=html(MoneyMovementRow,{kind:'expense',title:'Pengeluaran panjang',amount,date:'9 Okt'});
 assert.match(output,/data-wide-value="true"/); assert.ok(output.includes(amount));
 assert.doesNotMatch(output,/<wbr/);
});
test('confirmation decision flow still places details after input/value and decisions',()=>{
 for(const runtime of [false,true]) {
  const output=html(CompactFinancialRow,{desktopLayout:'confirmation',identity:'Aturan',context:'9 Okt',value:'Rp110.000',
   amountControl:runtime?React.createElement('label',null,'Nominal (IDR)',React.createElement('input',{name:'amount'})):undefined,
   controls:React.createElement('button',null,'Konfirmasi & catat'),secondaryActions:React.createElement('button',null,'Lewati'),details:React.createElement('details',null,React.createElement('summary',null,'Rincian aktivitas'))});
  assert.ok(output.indexOf(runtime?'Nominal (IDR)':'Akan dicatat')<output.indexOf('Konfirmasi &amp; catat'));
  assert.ok(output.indexOf('Konfirmasi &amp; catat')<output.indexOf('Lewati'));
  assert.ok(output.indexOf('Lewati')<output.indexOf('Rincian aktivitas'));
  assert.equal((output.match(/<input/g)||[]).length,runtime?1:0);
 }
});
test('mobile filter renders one labeled native control, with all existing choices reachable',()=>{
 const output=html(ListFilterControl,{value:'expense',onChange:()=>{},label:'Jenis',options:[{value:'all',label:'Semua'},{value:'expense',label:'Pengeluaran'},{value:'income',label:'Pemasukan'},{value:'transfer',label:'Transfer'}]});
 assert.equal((output.match(/<select/g)||[]).length,1); assert.doesNotMatch(output,/<button/);
 assert.equal((output.match(/<option/g)||[]).length,4); assert.match(output,/selected=""[^>]*>Pengeluaran/);
 assert.match(output,/<label[^>]*for=/);
});

test('allocation review uses the same decision anatomy with a contextual amount label',()=>{
 const output=html(CompactFinancialRow,{desktopLayout:'confirmation',identity:'Alokasi pendapatan',context:'8 Okt · Pemasukan · 10%',
  amountLabel:'Tambahan',value:'Rp30.000',footer:'Perlu penyesuaian',controls:React.createElement('button',null,'Catat tambahan')});
 assert.ok(output.indexOf('8 Okt')<output.indexOf('Perlu penyesuaian'));
 assert.ok(output.indexOf('Perlu penyesuaian')<output.indexOf('Tambahan'));
 assert.ok(output.indexOf('Tambahan')<output.indexOf('Rp30.000'));
 assert.ok(output.indexOf('Rp30.000')<output.indexOf('Catat tambahan'));
 assert.equal((output.match(/Rp30\.000/g)||[]).length,1);
 assert.doesNotMatch(output,/Akan dicatat|<input/);
});
test('toolbar keeps current sort visible and exposes active secondary options in closed summary',()=>{
 const output=html(ListToolbar,{label:'Filter transaksi',activeOptions:'Koreksi ditampilkan',options:React.createElement('label',null,React.createElement('input',{type:'checkbox',defaultChecked:true}),'Koreksi'),children:React.createElement(ListSortControl,{direction:'asc',setDirection:()=>{}})});
 assert.ok(output.indexOf('<select')<output.indexOf('Opsi tampilan'));
 assert.match(output,/selected=""[^>]*>Terlama/); assert.match(output,/Koreksi ditampilkan/);
 assert.match(output,/aria-expanded="false"/); assert.equal((output.match(/type="checkbox"/g)||[]).length,1);
});

test('one visibility checkbox stays directly visible alongside sorting without a disclosure',()=>{
 const output=html(ListToolbar,{label:'Riwayat',visibility:React.createElement('label',{className:'finance-history-toggle'},React.createElement('input',{type:'checkbox',defaultChecked:true}),'Tampilkan koreksi & pembatalan'),children:React.createElement(ListSortControl,{direction:'desc',setDirection:()=>{}})});
 assert.equal((output.match(/type="checkbox"/g)||[]).length,1);
 assert.match(output,/checked=""/); assert.match(output,/selected=""[^>]*>Terbaru/);
 assert.doesNotMatch(output,/Opsi tampilan|disclosure-content|aria-expanded/);
});

test('complex toolbar options still disclose rather than being automatically flattened',()=>{
 const output=html(ListToolbar,{label:'Riwayat',options:React.createElement(React.Fragment,null,
  React.createElement('label',null,React.createElement('input',{type:'checkbox'}),'Koreksi'),
  React.createElement('label',null,React.createElement('input',{type:'checkbox'}),'Detail tambahan'))});
 assert.match(output,/Opsi tampilan/); assert.match(output,/aria-expanded="false"/);
 assert.equal((output.match(/type="checkbox"/g)||[]).length,2);
});

test('mobile confirmation has concise text, descriptive accessible name and native button safety props',()=>{
 const output=html(AutomationConfirmButton,{disabled:true,onClick:()=>{}});
 assert.match(output,/type="button"/); assert.match(output,/disabled=""/);
 assert.match(output,/aria-label="Konfirmasi dan catat transaksi"/);
 assert.match(output,/>Konfirmasi<\/button>/); assert.doesNotMatch(output,/Konfirmasi &amp; catat/);
});

test('confirmation keeps supplied loading and retry feedback',()=>{
 assert.match(html(AutomationConfirmButton,{children:React.createElement('span',{role:'status'},'Mencatat…')}),/role="status"[^>]*>Mencatat…/);
 assert.match(html(AutomationConfirmButton,{children:'Coba lagi'}),/>Coba lagi<\/button>/);
});
