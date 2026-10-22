import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

registerHooks({
 resolve(specifier,context,next) {
  if(specifier==='./finance-feedback' && context.parentURL?.includes('automation-activity-details'))return {shortCircuit:true,url:'data:text/javascript,export function useFinanceFeedback(){return {refresh(){},notify(){}}} export function useMutationPending(){return {pending:false,begin(){return true},finish(){}}}'};
  if(specifier==='next/link' || specifier==='next/navigation') return next(specifier+'.js',context);
  const url=specifier.startsWith('@/')?new URL('../src/'+specifier.slice(2),import.meta.url)
   :specifier.startsWith('.') && context.parentURL?new URL(specifier,context.parentURL):null;
  if(url && !/\.[a-z]+$/i.test(url.pathname)) for(const extension of ['.tsx','.ts']) {
   const file=new URL(url.href+extension); if(fs.existsSync(file)) return next(file.href,context);
  }
  return next(specifier,context);
 },
 load(url,context,next) {
  if(url.endsWith('.tsx')) return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{
   compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}
  }).outputText};
  return next(url,context);
 }
});
const {AutomationActivityDetails,AutomationActivityDetailsContent,AutomationActivityTimeline}=await import('../src/components/automation-activity-details.tsx');
const {FinancialTable}=await import('../src/components/financial-data-table.tsx');
const item={key:'private-key',id:'private-instance',storage:'general',title:'Alokasi pendapatan',status:'review_required',latestResultStatus:'posted',
 triggerSource:'transaction_posted',categoryId:null,at:'2026-10-08T15:34:00Z',amount:'100000',currency:'IDR',exponent:0,
 context:'Transaksi Pemasukan',sourceAmount:'1000000',sourceCurrency:'IDR',sourceExponent:0,sourceKind:'income',sourceAt:'2026-10-08T15:34:00Z',
 percentageBps:1000,needsAmount:false,canPost:false,canSkip:false,resultId:'private-result',rootId:'private-root',failure:null,actionMeaning:'Pengeluaran'};
const allocation={assessmentId:'private-assessment',proposalId:'private-proposal',storage:'general',instanceId:item.id,state:'additional',currency:'IDR',exponent:0,
 percentageBps:1000,sourceMinor:'1300000',targetMinor:'130000',recognizedMinor:'100000',differenceMinor:'30000',sourceVoided:false,reason:'Transaksi pemicu berubah.',
 actionKind:'expense',sourceName:'BNI',destinationName:null,originalMinor:'100000',adjustmentMinor:'0',sourceAt:item.sourceAt,proposalStatus:'pending',confirmedFees:null};
const render=(patch={},status='Perlu penyesuaian')=>renderToStaticMarkup(React.createElement(AutomationActivityDetailsContent,{item:{...item,...patch},status}));

test('read-only popup preserves allocation review amounts and provenance without editing or exposing identifiers',()=>{
 const output=render({allocation});
 for(const text of ['Rp1.300.000','Rp130.000','Rp100.000','Rp30.000','Target (10%)','Terhubung dengan transaksi pemicu.','riwayat koreksi']) assert.ok(output.includes(text),text);
 assert.doesNotMatch(output,/private-|<input|<button|<details|<summary|<form/);
});

test('all Automation sources share read-only runtime details; skipped unknown amounts stay non-editable',()=>{
 for(const storage of ['schedule','income_event','general']) {
  const pending=render({storage,amount:null,needsAmount:true,canPost:true},'Perlu konfirmasi');
  assert.match(pending,/Diisi saat konfirmasi/); assert.doesNotMatch(pending,/<input|<form/);
  const skipped=render({storage,status:'skipped',amount:null,needsAmount:true,canPost:false},'Dilewati');
  assert.match(skipped,/Dilewati/); assert.doesNotMatch(skipped,/Diisi saat konfirmasi|<input/);
 }
});

test('detail popup is a labelled native dialog with a close control, not an inline disclosure',()=>{
 const output=renderToStaticMarkup(React.createElement(AutomationActivityDetails,{item:{...item,status:'pending_confirmation',resultId:null},status:'Perlu konfirmasi',onClose:()=>{}}));
 assert.match(output,/<dialog[^>]*aria-labelledby="automation-activity-detail-title"/);
 assert.match(output,/id="automation-activity-detail-title"[^>]*>Alokasi pendapatan/);
 assert.match(output,/aria-label="Tutup rincian aktivitas"/);
 assert.doesNotMatch(output,/<details|<summary|Konfirmasi &amp; catat|Lewati/);
});

test('clicking activity context opens details, while nested decisions, input labels and links remain independent',()=>{
 const activated=[];
 const tree=FinancialTable({label:'Aktivitas',records:[item],identity:value=>value.key,columns:[],rowAction:{onActivate:value=>activated.push(value.id)}});
 const row=tree.props.children.props.children[2].props.children[0];
 const target=ancestors=>({closest:selector=>ancestors.find(tag=>selector.split(',').map(part=>part.trim()).includes(tag))??null});
 row.props.onClick({target:target(['small','td','tr'])});
 assert.deepEqual(activated,[item.id]);
 for(const ancestors of [['span','button'],['input','label'],['span','label'],['a'],['summary'],['select'],['textarea']]) row.props.onClick({target:target(ancestors)});
 assert.deepEqual(activated,[item.id]);
});

test('a pending refresh prevents row detail activation',()=>{
 const tree=FinancialTable({label:'Aktivitas',records:[item],identity:value=>value.key,columns:[],rowAction:{disabled:true,onActivate:()=>assert.fail('Must not activate')}});
 const row=tree.props.children.props.children[2].props.children[0];
 row.props.onClick({target:{closest:()=>null}});
 assert.equal(row.props['data-actionable'],false);
});

test('acknowledged source void keeps cancellation, original amount and unresolved excess readable',()=>{
 const output=render({review:{financialState:'source_voided',attention:'reviewed',reviewedAt:'2026-10-10T03:00:00Z',decision:'acknowledged',sourceStatus:'voided',originalSourceMinor:'1000000',ruleVersion:1},
  allocation:{...allocation,state:'excess',sourceMinor:'1100000',sourceVoided:true,targetMinor:'0',recognizedMinor:'140000',adjustmentMinor:'40000',differenceMinor:'-140000'}});
 for(const text of ['Sumber dibatalkan','Sudah ditinjau','Pemasukan awal','Rp1.000.000','Pemasukan terakhir sebelum pembatalan','Rp1.100.000','Pemasukan efektif','Rp0','Rp140.000'])assert.ok(output.includes(text),text);
 assert.doesNotMatch(output,/Alokasi sesuai|Pemasukan terkini|Dana dikembalikan/);
 assert.match(output,/Tidak ada refund atau pembatalan otomatis/);
});

test('timeline separates persisted source, financial, assessment and review events in a collapsed disclosure',()=>{
 const timeline=[{id:'source',at:'2026-10-08T15:34:00Z',kind:'source',title:'Pemasukan sumber dicatat',description:'Rp1.000.000'},
  {id:'posting',at:'2026-10-08T15:35:00Z',kind:'financial',title:'Hasil awal dicatat',description:'Rp100.000'},
  {id:'assessment',at:'2026-10-10T02:00:00Z',kind:'assessment',title:'Alokasi dinilai',description:'Bukan pergerakan kas.'},
  {id:'review',at:'2026-10-10T03:00:00Z',kind:'review',title:'Sudah ditinjau',description:'Tidak mengubah transaksi.'}];
 const output=renderToStaticMarkup(React.createElement(AutomationActivityTimeline,{detail:{timeline,timelineNote:'Hanya peristiwa tersimpan.'}}));
 assert.match(output,/aria-expanded="false"/);assert.match(output,/data-expanded="false"/);
 assert.ok(output.indexOf('Pemasukan sumber dicatat')<output.indexOf('Hasil awal dicatat'));
 assert.ok(output.indexOf('Hasil awal dicatat')<output.indexOf('Alokasi dinilai'));
 assert.ok(output.indexOf('Alokasi dinilai')<output.indexOf('Sudah ditinjau'));
 for(const text of ['Riwayat aktivitas','Peristiwa sumber','Transaksi keuangan','Assessment / usulan','Tinjauan owner','Hanya peristiwa tersimpan.'])assert.ok(output.includes(text),text);
});

test('source changed after assessment shows live source separately from historical assessment amounts',()=>{
 const output=render({allocation,review:{financialState:'assessment_stale',attention:'needs_review',assessmentStale:true,originalSourceMinor:'1000000',lastSourceMinor:'1400000',sourceStatus:'posted',sourceCurrency:'IDR',sourceExponent:0}});
 for(const text of ['Nominal sumber terkini','Rp1.400.000','Pemasukan saat assessment','Rp1.300.000','Target saat assessment','Selisih saat assessment','sebelum perubahan terbaru'])assert.ok(output.includes(text),text);
 assert.doesNotMatch(output,/Pemasukan terkini|Alokasi sesuai/);
});
