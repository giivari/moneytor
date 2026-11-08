// Kredit & Talangan presentation: figures come from the snapshot and credit domain; no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readableMoneyMarkup} from './rendered-money.mjs';

const root = new URL('../', import.meta.url);
const stub = code => ({format: 'module', shortCircuit: true, source: code});
registerHooks({
 resolve(specifier, context, next) {
  if (specifier === 'next/link' || specifier === 'next/navigation') return next(specifier + '.js', context);
  const base = specifier.startsWith('@/') ? new URL('src/'+specifier.slice(2), root)
   : specifier.startsWith('.') && context.parentURL ? new URL(specifier, context.parentURL) : null;
  if (base && !/\.[a-z]+$/i.test(base.pathname)) for (const extension of ['.tsx','.ts']) {
   const url = new URL(base.href+extension); if (fs.existsSync(url)) return next(url.href, context);
  }
  return next(specifier, context);
 },
 load(url, context, next) {
  if (/\/src\/lib\/(db|auth)\//.test(url) || url.endsWith('/finance/summary.ts')) throw new Error('Credit presentation must not load DB or auth');
  if (url.endsWith('.css')) return stub('');
  if (url.endsWith('/components/app-link.tsx')) return stub('import React from "react"; export function AppLink(props){ return React.createElement("a",props); }');
  if (/\.tsx?$/.test(url)) return stub(ts.transpileModule(fs.readFileSync(new URL(url),'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  return next(url, context);
 }
});
const {CreditOverview} = await import('../src/components/credit-overview.tsx');
const credit = await import('../src/lib/domain/credit.ts');
const {summarizeBalances} = await import('../src/lib/domain/net-worth.ts');
const {formatMinor} = await import('../src/lib/finance/format.ts');
const money = value => formatMinor(value,'IDR',0);
const html = snapshot => readableMoneyMarkup(renderToStaticMarkup(React.createElement(CreditOverview,{snapshot})));

const noteFor = (limit=0n) => credit.encodeCreditNote('',true,{dueDay:1,cutoffDay:20,limitMinor:limit,carryCurrentMinor:0n,schedule:[]});
let serial = 0;
const asset = overrides => ({id:`a${++serial}`,displayName:`Akun ${serial}`,currency:'IDR',exponent:0,assetTypeId:'t',assetTypeName:'Rekening',assetGroupId:null,assetGroupName:null,
 providerId:null,providerName:null,paymentNetworkId:null,normallyLiquid:true,normallySpendable:true,safeSuffix:null,note:null,isActive:true,openingMinor:'0',balanceMinor:'0',assetClass:'asset',...overrides});
const card = overrides => asset({assetClass:'liability',normallyLiquid:false,normallySpendable:false,assetTypeName:'Kartu kredit',note:noteFor(),creditInstallments:[],...overrides});
const nextPeriod = () => credit.creditPeriodOf(credit.nextMonthlyDueDayIso(1,1));
const rows = (activityId,count,principal,interest,start) => Array.from({length:count},(_,i)=>({activityId,seq:i+1,period:credit.addCreditPeriods(start,i),principalMinor:String(principal),interestMinor:String(interest),status:'scheduled'}));

function snapshotOf(assets) {
 const throughDay='2999-12-31';
 const entry=summarizeBalances(assets,[],throughDay).get('IDR');
 return {assets,throughDay,planningReady:true,recent:[],investment:{hasHoldings:false,totals:[]},
  currencies:[{currency:'IDR',exponent:0,liabilitiesMinor:entry.liabilities.toString(),creditDebtMinor:entry.creditDebt.toString(),netWorthMinor:entry.netWorth.toString(),totalMinor:entry.total.toString()}]};
}

test('KPIs use snapshot liabilities and credit debt; cards show status, cycle and limit', () => {
 const assets=[
  asset({displayName:'BNI',balanceMinor:'5000000'}),
  card({displayName:'Kartu Utama',balanceMinor:'-800000',note:noteFor(5000000n),creditInstallments:rows('buy',3,190000,10000,nextPeriod())}),
  card({displayName:'PayLater Lunas',balanceMinor:'0'}),
  card({displayName:'Kartu Lebih',balanceMinor:'25000'}),
  asset({displayName:'Talangan Budi',assetClass:'receivable',balanceMinor:'150000'}),
 ];
 const snapshot=snapshotOf(assets), output=html(snapshot);
 assert.ok(output.includes(money(snapshot.currencies[0].liabilitiesMinor)));
 assert.equal(snapshot.currencies[0].liabilitiesMinor,'800000');
 assert.ok(output.includes(money(snapshot.currencies[0].creditDebtMinor)));
 for (const text of ['Tagihan berjalan','Lunas','Lebih bayar','Cetak tgl 20 · Jatuh tempo tgl 1','Sisa limit']) assert.ok(output.includes(text),text);
 assert.ok(output.includes(money('4200000'))); // limit 5.000.000 − 800.000 owed
 assert.match(output,/Terpakai 16% dari limit/);
 assert.doesNotMatch(output,/>BNI</); // ordinary assets are not credit
 assert.match(output,/role="tab"[^>]*>Cicilan</);
 assert.match(output,/3 bulan/);
 assert.ok(output.includes(money('200000')) && output.includes(money('600000')));
 assert.match(output,/Talangan Budi/);
 assert.ok(output.includes(money('150000')));
 assert.match(output,/data-inspector-trigger/);
});

test('empty book explains where credit and receivable accounts come from', () => {
 const output=html(snapshotOf([asset({balanceMinor:'1000'})]));
 assert.match(output,/Belum ada akun kredit/);
 assert.match(output,/Belum ada cicilan terjadwal/);
 assert.match(output,/Belum ada piutang/);
 assert.doesNotMatch(output,/aria-label="Ringkasan kredit IDR"/);
});

test('archived facilities stay listed with their remaining debt', () => {
 const output=html(snapshotOf([card({displayName:'Kartu Lama',balanceMinor:'-120000',isActive:false})]));
 assert.match(output,/Diarsipkan/);
 assert.match(output,/Kartu Lama/);
 assert.ok(output.includes(money('120000')));
});

test('Bayar tagihan appears only on active cards with an open bill', () => {
 const output=html(snapshotOf([
  asset({displayName:'BNI',balanceMinor:'5000000'}),
  card({displayName:'Kartu Utama',balanceMinor:'-800000'}),
  card({displayName:'Kartu Lunas',balanceMinor:'0'}),
  card({displayName:'Kartu Lama',balanceMinor:'-120000',isActive:false}),
 ]));
 assert.equal(output.split('Bayar tagihan</button>').length-1,1);
 assert.match(output,/aria-label="Bayar tagihan Kartu Utama"/);
 assert.doesNotMatch(output,/aria-label="Bayar tagihan Kartu Lunas"/);
 assert.doesNotMatch(output,/aria-label="Bayar tagihan Kartu Lama"/);
});

test('the editor accepts a preset and the card passes credit account, amount and a note', () => {
 const button=fs.readFileSync(new URL('src/components/pay-bill-button.tsx',root),'utf8');
 assert.match(button,/kind: "transfer", destinationId: assetId, amount: minorToInput\(amountMinor, exponent\)/);
 const editor=fs.readFileSync(new URL('src/components/transaction-editor.tsx',root),'utf8');
 assert.match(editor,/preset\?: TransactionPreset/);
 assert.match(editor,/preset\?\.destinationId/);
});

test('Fase 3: pembuatan akun wajib memilih kelas, ubah kelas lewat asset-class-change, dan detail menampilkan jadwal cicilan serta activitySummary apa adanya', () => {
 const manager=fs.readFileSync(new URL('src/components/assets-manager.tsx',root),'utf8');
 assert.match(manager,/useState<AssetClass \| "">\(initial\?\.assetClass \?\? ""\)/);
 assert.match(manager,/Kelas akun wajib dipilih/);
 assert.match(manager,/financeRequest\("asset-class-change"/);
 assert.match(manager,/detail\.activitySummary\.expenseMinor/);
 assert.match(manager,/detail\.activitySummary\.refundMinor/);
 assert.match(manager,/detail\.activitySummary\.transferOutMinor/);
 assert.match(manager,/asset\.creditInstallments/);
 assert.doesNotMatch(manager,/balanceBig\s*-\s*openingBig/);
});
