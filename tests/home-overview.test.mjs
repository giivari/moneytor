import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {registerHooks, createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readableMoneyMarkup} from './rendered-money.mjs';

// No environment file, database connection, HTTP Home visit or real reconciler.
const root = new URL('../', import.meta.url);
const source = path => fs.readFileSync(new URL(path, root), 'utf8');
globalThis.homeReadProbe = {snapshot: null, report: null, inputs: [], calls: [], session: true, failure: false};
const stub = code => ({format: 'module', shortCircuit: true, source: code});
registerHooks({
 resolve(specifier, context, next) {
  if (specifier === 'next/server' || specifier === 'next/link' || specifier === 'next/navigation') return next(specifier + '.js', context);
  const base = specifier.startsWith('@/') ? new URL('src/'+specifier.slice(2), root)
   : specifier.startsWith('.') && context.parentURL ? new URL(specifier, context.parentURL) : null;
  if (base && !/\.[a-z]+$/i.test(base.pathname)) for (const extension of ['.tsx','.ts']) {
   const url = new URL(base.href+extension); if (fs.existsSync(url)) return next(url.href, context);
  }
  return next(specifier, context);
 },
 load(url, context, next) {
  if (/\/src\/lib\/(home|db)\//.test(url)) throw new Error('Home presentation must not load preference storage or DB');
  if (url.endsWith('/finance/summary.ts')) return stub('export async function financeSnapshot(){ const p=globalThis.homeReadProbe; p.calls.push("snapshot"); return p.snapshot; }');
  if (url.endsWith('/analytics/service.ts')) return stub('export async function readAnalytics(input){ const p=globalThis.homeReadProbe; p.calls.push("analytics"); p.inputs.push(input); return p.report; }');
  if (url.endsWith('.css')) return stub('');
  if (url.endsWith('/automation/service.ts')) return stub('export async function reconcileAutomation(){ globalThis.homeReadProbe.calls.push("scheduled"); }');
  if (url.endsWith('/automation/composable-service.ts')) return stub('export async function reconcileGeneralAutomation(){ globalThis.homeReadProbe.calls.push("composable"); }');
  if (url.endsWith('/auth/session.ts')) return stub('export async function currentOwnerSession(){ const p=globalThis.homeReadProbe; p.calls.push("auth"); if(p.failure) throw new Error("secret database error"); return p.session ? {} : null; }');
  if (url.endsWith('/auth/store.ts')) return stub('export function deny(){throw new Error("Denied");}');
  if (url.endsWith('/components/app-link.tsx')) return stub('import React from "react"; export function AppLink(props){ return React.createElement("a",props); }');
  if (url.includes('/server-only/')) return stub('');
  if (/\.tsx?$/.test(url)) return stub(ts.transpileModule(fs.readFileSync(new URL(url),'utf8'), {compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
  return next(url, context);
 }
});
process.env.MONETA_ORIGIN = 'http://localhost:3000';
process.env.MONETA_RP_ID = 'localhost';
const {HomeOverview} = await import('../src/components/home-overview.tsx');
const {FinancialAmount} = await import('../src/components/financial-amount.tsx');
const {reportingPeriod, previousPeriod, monthKeys} = await import('../src/lib/analytics/periods.ts');
const {default: HomePage} = await import('../src/app/page.tsx');
const {GET, POST} = await import('../src/app/api/home/preferences/route.ts');
const {formatMinor} = await import('../src/lib/finance/format.ts');
const credit = await import('../src/lib/domain/credit.ts');
const postcss = createRequire(import.meta.url)('postcss');
const sheet = postcss.parse(source('src/app/home.css'));
const css = source('src/app/home.css');
const html = (snapshot,analytics=null) => readableMoneyMarkup(renderToStaticMarkup(React.createElement(HomeOverview, {snapshot,analytics,date:'Minggu, 11 Oktober 2026'})));
const section = (output, name) => output.match(new RegExp(`<section[^>]*class="[^"]*${name}[^"]*"[\\s\\S]*?</section>`))?.[0] ?? '';
const money = value => formatMinor(value,'IDR',0);
const entry = overrides => ({currency:'IDR',exponent:0,totalMinor:'23778769',netWorthMinor:'23778769',liabilitiesMinor:'0',creditDebtMinor:'0',eligibleMinor:'10767500',reservedMinor:'12000000',coveredMinor:'0',liquidMinor:'10767500',spendableMinor:'-1232500',expenseMinor:'1232500',availableMinor:'-1732500',dueMinor:'500000',uncoveredMinor:'500000',unpricedCount:1,...overrides});
const activity = (id, kind, overrides={}) => ({id,kind,currency:'IDR',exponent:0,baseAmountMinor:'100000',charges:[],note:null,categoryName:null,sourceName:'BNI',destinationName:null,recurringRuleName:null,occurredAt:'2026-10-10T17:30:00Z',...overrides});
const fixture = () => ({throughDay:'2026-11-10',planningReady:true,currencies:[entry()],assets:[{id:'account',displayName:'BNI',providerName:'Bank',assetTypeName:'Rekening',currency:'IDR',exponent:0,balanceMinor:'10767500',normallyLiquid:true,normallySpendable:true,isActive:true}],
 investment:{hasHoldings:true,totals:[{currency:'IDR',exponent:0,marketMinor:'13011269',unrealizedMinor:'-230000',unpricedCount:1}]},
 recent:[activity('e','expense',{baseAmountMinor:'80000',charges:[{amountMinor:'2000'},{amountMinor:'500'}],note:'Makan',categoryName:'Makanan',recurringRuleName:'Makan Harian'}),activity('i','income',{baseAmountMinor:'1000000'}),activity('t','transfer',{charges:[{amountMinor:'1000'}],destinationName:'Tunai'}),activity('fourth','expense',{note:'Keempat'})]});

function analyticsFixture() {
 const now=new Date('2026-10-11T08:00:00Z'), period=reportingPeriod({kind:'monthly_trend',months:6},now);
 const measures={currency:'IDR',exponent:0,incomeMinor:'1000000',expensePrincipalMinor:'1231500',spendingMinor:'1232500',netMinor:'-232500',feesMinor:'1000',taxesMinor:'0',otherChargesMinor:'0',transferFeesMinor:'1000',chargesMinor:'1000',transferPrincipalMinor:'100000',activityCount:'3',incomeCount:'1',expenseCount:'1',transferCount:'1'};
 return {version:'p6a.v1',generatedAt:now.toISOString(),period,summary:[measures],byCategory:[{...measures,key:'uncategorized',id:null,name:'Tanpa kategori',archived:false,spendingMinor:'1231500'}],byAccount:[],byOrigin:[],charges:[{currency:'IDR',exponent:0,typeId:'tf',name:'Biaya transfer',systemKey:'transfer_fee',bucket:'fee',archived:false,activityKind:'transfer',amountMinor:'1000',chargeCount:'1'}],investmentFlows:[],daily:[],
  monthly:monthKeys(period).map(key=>({...measures,key,id:null,name:key,archived:false,...(key==='2026-10'?{}:{incomeMinor:'0',spendingMinor:'0',netMinor:'0',activityCount:'0'})})),
  comparison:{period:previousPeriod({kind:'monthly_trend',months:6},period,now),currencies:[],partialComparison:true,method:'full_previous_period'},context:null};
}

test('ordinary Home lifecycle reads once, without preferences or additional reconciliation', async () => {
 const snapshot = fixture(), before = structuredClone(snapshot);
 const p = globalThis.homeReadProbe; p.snapshot=snapshot; p.calls=[];
 p.inputs=[];
 const output = renderToStaticMarkup(await HomePage());
 assert.deepEqual(p.calls,['scheduled','composable','snapshot','analytics']);
 assert.deepEqual(p.inputs,[{period:{kind:'monthly_trend',months:6},includeContext:false}]);
 assert.deepEqual(snapshot,before);
 assert.match(output,/<h1>Beranda<\/h1>/);
 assert.doesNotMatch(output,/Atur tampilan|data-density|Comfortable|Compact|Tampilan Home tersimpan|<dialog|type="radio"/);
 assert.doesNotMatch(source('src/app/page.tsx'),/preferences|refresh\(|fetch\(|use client/);
});

test('KPIs, warnings and every Beranda module show exact snapshot values and links', () => {
 const output=html(fixture());
 for (const label of ['Kekayaan bersih','Dana siap pakai','Tagihan kredit terdekat','Piutang belum kembali','Arus kas 6 bulan','Mutasi terakhir','Jatuh tempo terdekat','Akun &amp; aset','Investasi','Rincian kalkulasi']) assert.ok(output.includes(label),label);
 for (const value of ['23778769','-1732500','500000']) assert.ok(output.includes(money(value)),value);
 assert.match(output,/1 posisi tanpa harga belum termasuk/);
 assert.match(output,/Kewajiban belum tercakup cadangan/);
 assert.match(output,/Dana siap pakai negatif/);
 for (const target of ['/assets','/assets/investments','/transactions','/credit']) assert.ok(output.includes(`href="${target}"`),target);
 assert.match(section(output,'home-investments'),/posisi berharga/);
 assert.ok(section(output,'home-investments').includes(money('-230000')));
});

test('Rincian kalkulasi reconciles net worth and Dana siap pakai from the same snapshot', () => {
 const output=html(fixture());
 assert.match(output,/role="tab"[^>]*aria-selected="true"[^>]*>Ringkasan</);
 assert.match(output,/Komponen kekayaan bersih · IDR/);
 assert.match(output,/Rumus dana siap pakai · IDR/);
 // cash 10.767.500 + investments 13.011.269 − liabilities 0 = 23.778.769 (netWorthMinor)
 for (const value of ['10767500','13011269','23778769']) assert.ok(output.includes(money(value)),value);
 // eligible 10.767.500 − reserved 12.000.000 − uncovered 500.000 = −1.732.500 (availableMinor)
 for (const value of ['12000000','-1732500']) assert.ok(output.includes(money(value)),value);
 assert.match(output,/1 posisi tanpa harga tidak terhitung/);
});

test('credit bills and receivables come from asset_class, sorted by due day', () => {
 const snapshot=fixture(); snapshot.throughDay='2999-12-31';
 snapshot.assets.push(
  {...snapshot.assets[0],id:'card',displayName:'Kartu Uji',assetClass:'liability',normallyLiquid:false,normallySpendable:false,balanceMinor:'-700000',note:credit.encodeCreditNote('',true,{dueDay:1,cutoffDay:20,limitMinor:0n,carryCurrentMinor:0n,schedule:[]}),creditInstallments:[]},
  {...snapshot.assets[0],id:'loan',displayName:'Talangan Budi',assetClass:'receivable',balanceMinor:'250000'});
 const output=html(snapshot);
 assert.match(section(output,'home-due'),/Kartu Uji/);
 assert.ok(section(output,'home-due').includes(money('700000')));
 assert.doesNotMatch(output,/Tidak ada tagihan dalam 30 hari/);
 assert.ok(output.includes(money('250000')));
 assert.match(output,/1 akun<\/span> Menunggu pelunasan/);
 assert.doesNotMatch(section(output,'home-accounts'),/Kartu Uji/);
});

test('recent activity shows up to six rows; Expense includes charges once; Transfer keeps principal and fee apart', () => {
 const snapshot=fixture(), before=structuredClone(snapshot), output=section(html(snapshot),'home-recent');
 assert.equal((output.match(/<li[ >]/g)||[]).length,4);
 assert.ok(output.includes(`−${money('82500')}`));
 assert.ok(output.includes(`+${money('1000000')}`));
 assert.ok(output.includes(money('100000'))); assert.ok(output.includes(`Biaya ${money('1000')}`));
 assert.ok(!output.includes(money('101000')));
 assert.match(output,/>BNI · Otomatisasi<\/small>/);
 assert.match(output,/BNI → Tunai/);
 assert.match(output,/data-inspector-trigger/);
 assert.deepEqual(snapshot,before);
 const many=fixture(); many.recent=[...many.recent,activity('5','expense'),activity('6','expense'),activity('seventh','expense',{note:'Ketujuh'})];
 const capped=section(html(many),'home-recent');
 assert.equal((capped.match(/<li[ >]/g)||[]).length,6);
 assert.doesNotMatch(capped,/Ketujuh/);
});

test('archived accounts and genuine empty states are described accurately', () => {
 const snapshot=fixture(); snapshot.assets[0].isActive=false; snapshot.recent=[];
 assert.match(html(snapshot),/Belum ada akun aktif/);
 assert.match(html(snapshot),/Belum ada transaksi tercatat/);
 snapshot.assets=[];
 assert.match(html(snapshot),/Belum ada akun atau aset tercatat/);
 assert.doesNotMatch(html(snapshot),/Mulai dari aset pertama/); // investment-only owner
 snapshot.investment={hasHoldings:false,totals:[]}; snapshot.currencies=[];
 assert.match(html(snapshot),/Mulai dari aset pertama/);
 assert.doesNotMatch(html(snapshot),/Rp0|home-recent|ui-kpis/);
});

test('investment zero/unknown price data is never estimated', () => {
 const snapshot=fixture(); snapshot.investment.totals[0].marketMinor='0'; snapshot.investment.totals[0].unrealizedMinor='0';
 const output=html(snapshot), investments=section(output,'home-investments');
 assert.match(investments,/Rp0/); assert.match(investments,/1 posisi belum memiliki harga/);
 assert.doesNotMatch(output,/Investasi \(nilai pasar\)/); // a zero component is not listed as value
 snapshot.investment.totals=[];
 assert.match(section(html(snapshot),'home-investments'),/Catat portofolio/);
});

test('currencies remain separate, deterministic and use their exact exponent', () => {
 const snapshot=fixture(); snapshot.currencies.unshift(entry({currency:'USD',exponent:2,totalMinor:'123456',netWorthMinor:'123456',liquidMinor:'123456',eligibleMinor:'123456',reservedMinor:'0',spendableMinor:'123456',expenseMinor:'0',availableMinor:'123456',dueMinor:'0',uncoveredMinor:'0',unpricedCount:0}));
 const output=html(snapshot);
 assert.ok(output.indexOf('Ringkasan IDR')<output.indexOf('Ringkasan USD'));
 assert.ok(output.includes('USD 1.234,56'));
 assert.ok(output.includes(money('23778769')));
 assert.equal((output.match(/aria-label="Ringkasan /g)||[]).length,2);
});

test('large negative money keeps exact group tokens, without focusable scroll controls', () => {
 const snapshot=fixture(), big='-999999999999999999999999999';
 snapshot.currencies[0].netWorthMinor=big; snapshot.currencies[0].totalMinor=big;
 snapshot.assets[0].balanceMinor=big; snapshot.investment.totals[0].unrealizedMinor=big;
 const output=html(snapshot), amount=money(big);
 assert.ok(output.includes(amount));
 const kpi=section(output,'ui-kpi');
 assert.match(kpi,/data-wide="true"/);
 assert.doesNotMatch(kpi,/tabindex|<input|role="spinbutton"/);
 assert.match(section(output,'home-accounts'),/data-wide="true"/);
 assert.doesNotMatch(output,/text-overflow|title="−Rp/);
});

test('responsive contracts: container-driven KPI and column grids, no hidden modules, no scrolling amounts', () => {
 const ui=source('src/app/ui.css');
 assert.match(ui,/\.page \{ container: page \/ inline-size; \}/);
 assert.match(ui,/\.ui-kpis \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
 assert.match(ui,/@container page \(min-width: 900px\) \{\s*\.ui-kpis \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
 assert.doesNotMatch(ui,/overflow-x:\s*(auto|scroll|hidden)|user-select/);
 assert.match(css,/\.home-grid \{ grid-template-columns: minmax\(0, 7fr\) minmax\(0, 5fr\)/);
 assert.doesNotMatch(css,/overflow-x:\s*(auto|scroll|hidden)|scale\(|data-density|home-desktop-only|user-select/);
 assert.match(source('src/app/typography.css'),/financial-value\.financial-amount[^}]*overflow: visible; overflow-wrap: normal/);
 assert.match(css,/home-recent-copy strong \{[^}]*-webkit-line-clamp: 2/);
 assert.match(css,/home-recent-copy small \{[^}]*text-overflow: ellipsis; white-space: nowrap/);
 assert.match(ui,/\.ui-row-copy small \{[^}]*text-overflow: ellipsis; white-space: nowrap/);
 assert.match(source('src/app/shell.css'),/\.main-content \{ padding: var\(--space-4\) var\(--space-4\) var\(--dock-clearance\)/);
 assert.doesNotMatch(html(fixture()),/home-desktop-only/);
 let hides=false;
 for (const parsed of [sheet, postcss.parse(ui)]) parsed.walkDecls('display', decl => { if (decl.value==='none' && /(home|ui)-(investments|accounts|recent|due|kpi)(?![-\w])/.test(decl.parent.selector)) hides=true; });
 assert.equal(hides,false);
});

test('retired authenticated GET/POST never loads storage, financial readers or reconciliation', async () => {
 const p=globalThis.homeReadProbe; p.calls=[]; p.session=true; p.failure=false;
 for (const response of [await GET(),await POST(new Request('http://localhost:3000/api/home/preferences',{method:'POST',headers:{origin:'http://localhost:3000','sec-fetch-site':'same-origin'},body:JSON.stringify({action:'reset',expectedRevision:'99'})})),await POST(new Request('http://localhost:3000/api/home/preferences',{method:'POST',headers:{origin:'http://localhost:3000'},body:JSON.stringify({action:'update',config:{density:'compact',sections:[]}})}))]) {
  assert.equal(response.status,410); assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match((await response.json()).error,/telah dihentikan/);
 }
 assert.deepEqual(p.calls,['auth','auth','auth']);
});

test('retired route preserves unauthorized, origin, no-store and safe failure boundaries', async () => {
 const p=globalThis.homeReadProbe; p.session=false; p.failure=false;
 assert.equal((await GET()).status,401);
 assert.equal((await POST(new Request('http://localhost:3000/api/home/preferences',{method:'POST',headers:{origin:'http://localhost:3000'}}))).status,401);
 p.session=true; p.calls=[];
 for (const headers of [{},{origin:'https://attacker.example'},{origin:'http://localhost:3000','sec-fetch-site':'cross-site'}]) {
  const response=await POST(new Request('http://localhost:3000/api/home/preferences',{method:'POST',headers}));
  assert.equal(response.status,403); assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.deepEqual(p.calls,[]);
 p.failure=true;
 const response=await GET(); assert.equal(response.status,503);
 assert.doesNotMatch(await response.text(),/secret|database|stack/i); p.failure=false;
});

test('editor, preference client/store/registry are retired; historical migration stays byte-identical', () => {
 for (const path of ['src/components/home-workspace.tsx','src/components/home-customization.tsx','src/components/use-home-preferences.ts','src/lib/home/client.ts','src/lib/home/preferences.ts','src/lib/home/preference-store.ts','src/lib/home/sections.ts']) assert.equal(fs.existsSync(new URL(path,root)),false,path);
 assert.equal(createHash('sha256').update(fs.readFileSync(new URL('db/migrations/013_home_customization.sql',root))).digest('hex'),'a619123f7cf58cb6bf5839a2233d7e334e3a976b17d97f3c35cfb0246b9b7277');
 assert.doesNotMatch(source('src/components/home-overview.tsx'),/use client|preferences|density|refresh\(|fetch\(/);
});

test('shared amount preserves exact text with wrapping only between complete groups and no scroll semantics', () => {
 for (const value of ['−Rp999.999.999.999.999.999.999','USD 18.446.744.073.709.551,61','+Rp1.000.000','Rp0.']) {
  const raw=renderToStaticMarkup(React.createElement(FinancialAmount,{value}));
  assert.equal(raw.replace(/<[^>]+>/g,''),value);
  assert.doesNotMatch(raw,/tabindex|<input|role=|overflow/);
  const groups=[...raw.matchAll(/financial-amount-group">([^<]*)<\/span>/g)].map(m=>m[1]);
  assert.equal(groups.join(''),value);
  for(const group of groups.slice(1)) assert.match(group,/^\.\d{3}(?:,\d+)?\.?$/);
  assert.doesNotMatch(raw,/<wbr\/?><span class="financial-amount-group">\.<\/span>/);
 }
});

test('Home reuses real P6A trend/category report with visible scope and exact, isolated category denominator', () => {
 const snapshot=fixture(), report=analyticsFixture(), before=structuredClone({snapshot,report});
 const output=html(snapshot,report);
 assert.match(output,/Pemasukan &amp; belanja/); assert.match(output,/Komposisi belanja/);
 assert.match(output,/Periode berjalan/); assert.match(output,/Tanpa kategori/);
 assert.match(output,/Tren IDR/); assert.match(output,/viewBox="0 0 340 140"/); // narrow-first on the server
 assert.match(output,/pemasukan Rp1\.000\.000, belanja Rp1\.232\.500, net −Rp232\.500/i);
 assert.match(output,/total Rp1\.232\.500/); assert.match(output,/Biaya admin pada transaksi Transfer/);
 assert.match(output,/role="button" tabindex="0"/); // only chart selection is interactive
 assert.doesNotMatch(output,/home-mobile-access|insight-interval-picker|<table/);
 assert.deepEqual({snapshot,report},before);
});

test('shared foundations retain readable type and control targets without masking money overflow', () => {
 const tokens=source('src/app/tokens.css'), typography=source('src/app/typography.css'), shell=source('src/app/shell.css');
 assert.equal((tokens.match(/^:root \{/gm)||[]).length,1);
 assert.match(tokens,/--content-max-width: 1680px/);
 assert.match(tokens,/--control-target: 44px/);
 assert.match(tokens,/--surface-padding: var\(--space-[34]\)/);
 assert.match(shell,/max-width: var\(--content-max-width\)/);
 assert.match(tokens,/--text-xs: 12px/);
 assert.match(tokens,/--type-copy: var\(--text-md\)/);
 assert.match(typography,/financial-amount-group \{ white-space: nowrap/);
 assert.doesNotMatch(source('src/components/financial-amount.tsx'),/useEffect|useState|tabIndex|scrollIntoView|<input|Number\(/);
 const emptyOutput = html(fixture());
 assert.doesNotMatch(emptyOutput, /Konfirmasi transaksi otomatis/);
 const withPending = fixture();
 withPending.pendingAutomations = [{
  key: 'schedule:occ-1', id: 'occ-1', storage: 'schedule', title: 'Parkir Stasiun',
  status: 'pending', latestResultStatus: null, triggerSource: 'time', categoryId: null,
  at: '2026-10-11T01:00:00Z', amount: '10000', currency: 'IDR', exponent: 0,
  context: 'E-Money · Pengeluaran', needsAmount: false, canPost: true, canSkip: true,
  resultId: null, rootId: null, failure: null, actionMeaning: 'Pengeluaran Rp10.000 dari E-Money'
 }];
 const pendingOutput = html(withPending);
 assert.match(pendingOutput, /Konfirmasi transaksi otomatis \(1\)/);
 assert.match(pendingOutput, /Parkir Stasiun/);
 assert.match(pendingOutput, /Konfirmasi/);
 assert.match(pendingOutput, /Lewati/);
 assert.ok(pendingOutput.indexOf('home-automation-alert') < pendingOutput.indexOf('home-due'));
 const crowded = fixture();
 crowded.pendingAutomations = [1,2,3,4,5].map(n => ({...withPending.pendingAutomations[0], key:`schedule:occ-${n}`, id:`occ-${n}`, title:`Rutin ${n}`}));
 const crowdedOutput = html(crowded);
 assert.match(crowdedOutput, /Konfirmasi transaksi otomatis \(5\)/);
 assert.match(crowdedOutput, /Rutin 3/); assert.doesNotMatch(crowdedOutput, /Rutin 4/);
 assert.match(crowdedOutput, /2 lainnya di Otomatisasi/);
});

test('trend card header shows Belanja bulan ini and its difference with income from the same report', () => {
 const withReport=section(html(fixture(),analyticsFixture()),'home-trend');
 assert.match(withReport,/Belanja bulan ini/);
 assert.ok(withReport.includes(money('1232500')));
 assert.match(withReport,/Selisih dengan pemasukan/);
 assert.ok(withReport.includes(money('-232500')));
 const withoutReport=section(html(fixture()),'home-trend');
 assert.match(withoutReport,/Belanja bulan ini/);
 assert.ok(withoutReport.includes(money('1232500'))); // snapshot expenseMinor
 assert.doesNotMatch(withoutReport,/Selisih dengan pemasukan/);
 assert.doesNotMatch(html(fixture()),/ui-kpi" data-tone="[a-z]+"><header><h2>Belanja/); // not a fifth KPI
});
