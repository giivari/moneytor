import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/'))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
  return next(specifier,context);
},load(url,context,next){if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};return next(url,context);}});
const {AllocationSummaryContent}=await import('../src/components/allocation-summary.tsx');
const value={assessmentId:'private-assessment',proposalId:'private-proposal',storage:'general',instanceId:'private-instance',state:'additional',currency:'IDR',exponent:0,percentageBps:1000,
 sourceMinor:'1300000',targetMinor:'130000',recognizedMinor:'100000',differenceMinor:'30000',sourceVoided:false,reason:null,actionKind:'expense',sourceName:'BNI',destinationName:null,
 originalMinor:'100000',adjustmentMinor:'0',sourceAt:'2026-10-09T00:00:00Z',proposalStatus:'pending',confirmedFees:null};
const render=patch=>renderToStaticMarkup(React.createElement(AllocationSummaryContent,{value:{...value,...patch}}));
test('positive review explains target, recognized principal and shortage without exposing private identities',()=>{
 const output=render({});assert.match(output,/Target \(10%\)/);assert.match(output,/Kurang dialokasikan/);assert.match(output,/Rp30\.000/);assert.doesNotMatch(output,/private-|basis|UUID/);
});
test('zero difference explicitly shows alignment with original and additional effective results',()=>{
 const output=render({state:'aligned',recognizedMinor:'130000',adjustmentMinor:'30000',differenceMinor:'0'});assert.match(output,/Alokasi sesuai/);assert.match(output,/Tambahan efektif/);assert.match(output,/Rp130\.000/);
});
test('excess never advertises a negative financial action or automatic refund',()=>{
 const output=render({state:'excess',sourceMinor:'900000',targetMinor:'90000',differenceMinor:'-10000'});assert.match(output,/Kelebihan alokasi/);assert.match(output,/Rp10\.000/);assert.match(output,/Tidak ada refund atau pembatalan otomatis/);assert.doesNotMatch(output,/Catat −|<input|<button/);
});
test('source void explains preserved results and zero target',()=>{
 const output=render({state:'excess',sourceVoided:true,targetMinor:'0',differenceMinor:'-100000'});assert.match(output,/Pemasukan sumber dibatalkan/);assert.match(output,/tidak dibalik otomatis/);
  assert.match(output,/Pemasukan terakhir sebelum pembatalan/);assert.match(output,/Pemasukan efektif/);assert.match(output,/Target alokasi efektif/);
  assert.doesNotMatch(output,/Pemasukan terbaru|Pemasukan terkini/);
});
test('blocked assessment preserves a visible reason instead of false financial alignment',()=>{
 const output=render({state:'blocked',reason:'Aset alokasi tidak aktif.'});assert.match(output,/Perlu ditinjau/);assert.match(output,/Aset alokasi tidak aktif/);assert.doesNotMatch(output,/Alokasi sesuai/);
});
