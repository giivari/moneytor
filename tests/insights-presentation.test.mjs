import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readableMoneyMarkup} from './rendered-money.mjs';
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('@/')) {
    const base=new URL('../src/'+specifier.slice(2),import.meta.url);
    return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);
  }
  if(context.parentURL?.includes('/src/')&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){
    const base=new URL(specifier,context.parentURL);
    return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);
  }
  return next(specifier,context);
},load(url,context,next){
  if(url.endsWith('.tsx') || url.endsWith('/use-insights-viewport.ts')){
    let source=fs.readFileSync(new URL(url),'utf8');
    // SSR coverage of explicitly opened details; default-closed and real toggle
    // transitions are tested separately, without a production test-only prop.
    if(url.endsWith('/insights-disclosure.tsx'))source=source.replace('useState(false)','useState(globalThis.insightsExpandedTest ?? false)');
    if(url.endsWith('/use-insights-viewport.ts'))source=source.replace('() => true','() => globalThis.insightsMobileTest ?? true');
    if(url.endsWith('/insights-detail-pair.tsx'))source=source.replace('useState<string | null>(null)','useState<string | null>(globalThis.insightsDetailTest?.[label] ?? null)');
    return {format:'module',shortCircuit:true,source:ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
  }
  return next(url,context);
}});
const p=await import('../src/lib/analytics/presentation.ts');
const {reportingPeriod,previousPeriod}=await import('../src/lib/analytics/periods.ts');
const {InsightsReportView}=await import('../src/components/insights-report.tsx');
const {InsightsWorkspace,InsightsLoadState}=await import('../src/components/insights-workspace.tsx');
const now=new Date('2026-10-11T08:00:00Z');
const measures=(extra={})=>({currency:'IDR',exponent:0,incomeMinor:'1000000',expensePrincipalMinor:'100000',feesMinor:'2000',taxesMinor:'3000',otherChargesMinor:'4000',transferFeesMinor:'1000',chargesMinor:'9000',spendingMinor:'109000',netMinor:'891000',transferPrincipalMinor:'500000',activityCount:'3',incomeCount:'1',expenseCount:'1',transferCount:'1',...extra});
const row=(key,extra={})=>({...measures(),key,id:key,name:key,archived:false,...extra});
function fixture(){
 const period=reportingPeriod({kind:'current_month'},now);
 return {version:'p6a.v1',generatedAt:now.toISOString(),period,summary:[measures()],
 byCategory:[row('uncategorized',{id:null,name:'Tanpa kategori',spendingMinor:'108000'}),row('old',{name:'Kategori lama',archived:true,spendingMinor:'0'})],
 byAccount:[row('cash',{name:'Rekening lama',archived:true})],byOrigin:[row('manual',{spendingMinor:'1000'}),row('automation',{incomeMinor:'0',spendingMinor:'100000'}),row('allocation_adjustment',{incomeMinor:'0',spendingMinor:'8000'})],
 monthly:[row('2026-09',{incomeMinor:'0',spendingMinor:'0',netMinor:'0'}),row('2026-10')],daily:[row('2026-10-08')],
 charges:[{currency:'IDR',exponent:0,typeId:'admin',name:'Admin',systemKey:'admin_fee',bucket:'fee',archived:false,activityKind:'expense',amountMinor:'1000',chargeCount:'1'},
 {currency:'IDR',exponent:0,typeId:'transfer',name:'Transfer fee',systemKey:'transfer_fee',bucket:'fee',archived:false,activityKind:'transfer',amountMinor:'1000',chargeCount:'1'},
 {currency:'IDR',exponent:0,typeId:'tax',name:'Pajak',systemKey:'tax',bucket:'tax',archived:false,activityKind:'expense',amountMinor:'3000',chargeCount:'1'},
 {currency:'IDR',exponent:0,typeId:'custom',name:'Biaya khusus',systemKey:null,bucket:'other',archived:true,activityKind:'expense',amountMinor:'4000',chargeCount:'1'}],
 investmentFlows:[{currency:'IDR',exponent:0,purchasePrincipalMinor:'10000',saleProceedsMinor:'3000',feesMinor:'15',netCashMinor:'-7015',tradeCount:'2'}],
 comparison:{period:previousPeriod({kind:'current_month'},period,now),partialComparison:true,method:'full_previous_period',currencies:[{currency:'IDR',income:{differenceMinor:'1000000',percentageChangeBps:null},spending:{differenceMinor:'9000',percentageChangeBps:'900'},net:{differenceMinor:'991000',percentageChangeBps:null}}]},
 context:{scope:'current_snapshot_not_period_end',throughDay:'2026-11-10',planningReady:true,currencies:[{currency:'IDR',exponent:0,totalMinor:'2000000',liquidMinor:'1000000',spendableMinor:'-1000',availableMinor:'-2000',unpricedCount:1}],
 investments:[{currency:'IDR',exponent:0,marketMinor:'0',costBasisMinor:'10000',pricedCostBasisMinor:'0',unrealizedMinor:'0',realizedMinor:'993',unpricedCount:1}]}};
}
const html=(r=fixture(),currency='IDR',periodKind='current_month',expanded=true)=>{
 globalThis.insightsExpandedTest=expanded;
 try{return readableMoneyMarkup(renderToStaticMarkup(React.createElement(InsightsReportView,{report:r,currency,periodKind})));}finally{delete globalThis.insightsExpandedTest;}
};
const desktopHtml=(r=fixture(),details={})=>{
 globalThis.insightsMobileTest=false;globalThis.insightsDetailTest=details;
 try{return html(r);}finally{delete globalThis.insightsMobileTest;delete globalThis.insightsDetailTest;}
};

test('overview renders canonical income/spending/net and transfer principal separately',()=>{
 const output=html();assert.match(output,/Rp1\.000\.000/);assert.match(output,/Rp109\.000/);assert.match(output,/Rp891\.000/);assert.match(output,/Transfer:.*Rp500\.000/);assert.match(output,/bukan pertumbuhan total aset/);
 assert.equal(BigInt(fixture().summary[0].incomeMinor)-BigInt(fixture().summary[0].spendingMinor),BigInt(fixture().summary[0].netMinor));
});
test('category shares use Expense-attached costs, not summary spending including transfer fees',()=>{
 const r=fixture(),shares=p.categoryShares(r.byCategory);assert.equal(shares.totalMinor,'108000');assert.equal(shares.rows[0].shareBps,'10000');assert.match(html(r),/100,00%/);assert.match(html(r),/Biaya Transfer tidak termasuk/);
 assert.throws(()=>p.categoryShares([...r.byCategory,row('usd',{currency:'USD'})]),/mata uang/);
});
test('uncategorized and archived account/category/charge labels remain visible',()=>{
 const output=html();for(const label of ['Tanpa kategori','Kategori lama','Rekening lama','Biaya khusus','Diarsipkan'])assert.match(output,new RegExp(label));
});
test('transfer charges partition fee buckets without subtracting taxes or custom costs from services',()=>{
 const r=fixture();r.charges.push({...r.charges[2],activityKind:'transfer',amountMinor:'20000'});
 assert.deepEqual(p.feePartition(r.charges),{serviceMinor:'1000',transferMinor:'1000'});assert.match(html(r),/bukan tambahan lagi/);assert.match(html(r),/Biaya lainnya/);
});
test('all three canonical origins retain meaning; assessment/proposal exclusion is explicit',()=>{
 const output=html();for(const label of ['Manual','Automation','Penyesuaian alokasi'])assert.match(output,new RegExp(label));assert.match(output,/proposal|Proposal/);assert.match(output,/Setiap hasil P3 dihitung sekali/);
});
test('P4 trades and lifetime realized P/L are separate; unknown prices are not valued at cost',()=>{
 const output=html();assert.match(output,/P\/L terealisasi sepanjang riwayat/);assert.match(output,/Rp993/);assert.match(output,/Biaya perdagangan P4/);assert.match(output,/Rp15/);assert.match(output,/1 posisi belum memiliki harga/);assert.match(output,/bukan nilai pada akhir periode/);
});
test('partial periods and comparison basis are explicit, null percentages do not become numeric growth',()=>{
 const output=html();assert.match(output,/Periode berjalan/);assert.match(output,/Blok kalender sebelumnya secara penuh/);assert.match(output,/Berjalan/);assert.doesNotMatch(output,/NaN|Infinity/);assert.equal(p.percentageLabel(null),'—');assert.equal(p.percentageLabel('-1234',true),'−12,34%');
 const r=fixture();r.period=reportingPeriod({kind:'custom',startDay:'2026-09-05',endDay:'2026-09-12'},now);r.comparison.period=previousPeriod({kind:'custom'},r.period,now);r.comparison.partialComparison=false;
 const custom=html(r,'IDR','custom');assert.match(custom,/Interval sebelumnya dengan jumlah hari yang sama/);assert.doesNotMatch(custom,/Periode berjalan/);assert.match(custom,/28 Agu 2026.*4 Sep 2026/);
});
test('currency selection never sums currencies and respects exponent',()=>{
 const r=fixture();r.summary.push(measures({currency:'USD',exponent:2,incomeMinor:'12345',spendingMinor:'100',netMinor:'12245'}));r.monthly.push(row('2026-10',{currency:'USD',exponent:2,incomeMinor:'12345',spendingMinor:'100',netMinor:'12245'}));
 const output=html(r,'USD');assert.match(output,/USD 123,45/);assert.doesNotMatch(output,/Rp1\.000\.000|Rekening lama|Rp993/);assert.equal(p.insightsCurrency(r,'USD').categories.rows.length,0);
 assert.match(html(r,'XYZ'),/Belum ada akun/);
});
test('large negative/positive amounts keep exact digits; geometry alone is bounded Number data',()=>{
 const r=fixture();r.summary[0].incomeMinor='18446744073709551614';r.summary[0].netMinor='-18446744073709551614';
 const output=html(r);assert.match(output,/18\.446\.744\.073\.709\.551\.614/);assert.match(output,/−Rp18\.446/);assert.match(output,/tabindex="0"/);
 assert.equal(p.plotPercent('18446744073709551614',18446744073709551614n),100);assert.equal(p.plotPercent('0',0n),0);assert.equal(p.percentageLabel('9223372036854775807'),'92233720368547758,07%');
});
test('true empty reports have zero bars, useful empty states and no fictional values',()=>{
 const r=fixture();r.summary=[measures(Object.fromEntries(Object.keys(measures()).filter(k=>k.endsWith('Minor')||k.endsWith('Count')).map(k=>[k,'0'])))];r.byCategory=[];r.byAccount=[];r.byOrigin=[];r.charges=[];r.investmentFlows=[];r.monthly=[row('2026-10',r.summary[0])];r.daily=[];r.context=null;
 const output=html(r);assert.match(output,/Belum ada transaksi P3 efektif/);assert.match(output,/Belum ada belanja Expense/);assert.match(output,/height="0"/);assert.doesNotMatch(output,/Pratinjau|ilustrasi|39\.900\.000/);assert.equal(p.categoryShares([]).totalMinor,'0');
});
test('charts expose exact tooltips, keyboard targets, text table and month selection',()=>{
 const output=html();assert.match(output,/role="button" tabindex="0"/);assert.match(output,/aria-pressed=/);assert.match(output,/<title>Okt 2026, Berjalan: pemasukan Rp1\.000\.000/);assert.match(output,/<caption>/);assert.match(output,/scope="col"/);assert.match(output,/Rincian bulan/);assert.match(output,/<details/);
});
test('annual SSR selects current month with calendar descriptions and single disclosure indicators',()=>{
 const r=fixture();r.period=reportingPeriod({kind:'current_year'},now);r.monthly=Array.from({length:12},(_,i)=>row(`2026-${String(i+1).padStart(2,'0')}`,{incomeMinor:i===9?'1000000':'0',spendingMinor:i===9?'109000':'0',netMinor:i===9?'891000':'0',activityCount:i===9?'2':'0'}));
 const output=html(r);assert.match(output,/<option value="2026-10" selected="">Okt 2026 · Berjalan/);assert.match(output,/Nov 2026 · Belum dimulai/);assert.match(output,/Sep 2026 · Selesai/);assert.doesNotMatch(output,/Belum selesai/);
 const css=fs.readFileSync(new URL('../src/app/insights/insights.css',import.meta.url),'utf8');assert.doesNotMatch(css,/insight-disclosure[^\n]*::after/);assert.match(css,/summary::-webkit-details-marker \{ display: none/);
});
test('Transfer sentence punctuation stays inside the exact value instead of an orphan text node',()=>{
 const output=html();assert.match(output,/insight-transfer-meta">Transfer: <span[^>]*>Rp500\.000\.<\/span><\/span>/);assert.doesNotMatch(output,/Rp500\.000<\/span>\./);
});
test('filter controls serialize validated inclusive ranges and trend limits',()=>{
 assert.equal(p.insightsQuery({kind:'custom',currency:'USD',start:'2026-02-01',end:'2026-02-28',months:'6'}),'period=custom&currency=USD&start=2026-02-01&end=2026-02-28');
 for(const draft of [{kind:'monthly_trend',months:'37'},{kind:'monthly_trend',months:'0'},{kind:'custom',start:'2026-02-30',end:'2026-03-01'},{kind:'custom',start:'2026-10-12',end:'2026-10-11'},{kind:'custom',start:'2020-01-01',end:'2026-10-11'}])assert.throws(()=>p.insightsQuery({currency:'IDR',start:'2026-10-01',end:'2026-10-31',months:'6',...draft}));
 assert.equal(p.inclusiveEndDay('2027-01-01'),'2026-12-31');assert.equal(p.insightsDraft('period=monthly_trend&months=36&currency=USD','',now).months,'36');
});
test('SSR workspace shows real report without loading flash and accessible native controls',()=>{
 const output=renderToStaticMarkup(React.createElement(InsightsWorkspace,{initial:fixture(),initialQuery:'period=current_month&currency=IDR',initialError:'',currencies:[{currency:'IDR',exponent:0},{currency:'USD',exponent:2}]}));
 assert.match(output,/Terapkan/);assert.match(output,/Tahun ini/);assert.match(output,/Tren bulanan/);assert.match(output,/aria-busy="false"/);assert.doesNotMatch(output,/Memuat laporan/);assert.match(output,/Rp891\.000/);
});
test('loading/error rendering cannot claim empty financial results and provides retry',()=>{
 const loading=renderToStaticMarkup(React.createElement(InsightsLoadState,{loading:true,error:'',retry:()=>{}}));assert.match(loading,/Memuat laporan/);assert.doesNotMatch(loading,/Belum ada/);
 const error=renderToStaticMarkup(React.createElement(InsightsLoadState,{loading:false,error:'Sesi berakhir',retry:()=>{}}));assert.match(error,/role="alert"/);assert.match(error,/Coba lagi/);assert.doesNotMatch(error,/Memuat|Belum ada/);
});
test('responsive CSS confines chart overflow and preserves global dock/navigation styles',()=>{
 const css=fs.readFileSync(new URL('../src/app/insights/insights.css',import.meta.url),'utf8');assert.match(css,/@media \(max-width: 700px\)/);assert.match(css,/grid-template-columns: minmax\(0, 1fr\)/);assert.match(css,/overflow-x: auto/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/:focus-visible/);assert.doesNotMatch(css,/\.bottom-dock|\.app-header|\.main-content/);
 const page=fs.readFileSync(new URL('../src/app/insights/page.tsx',import.meta.url),'utf8');assert.match(page,/await requireOwnerSession\(\)/);assert.match(page,/force-dynamic/);assert.doesNotMatch(page,/demo-data|postActivity|reconcile/);
});

test('V2 SSR exposes essential metrics before one carousel and collapses filters/secondary details',()=>{
 const output=renderToStaticMarkup(React.createElement(InsightsWorkspace,{initial:fixture(),initialQuery:'period=current_month&currency=IDR',initialError:'',currencies:[{currency:'IDR',exponent:0}]}));
 assert.equal((output.match(/aria-label="Tiga analisis keuangan"/g)||[]).length,1);assert.equal((output.match(/class="surface insight-panel insight-slide"/g)||[]).length,3);
 assert.ok(output.indexOf('Ringkasan keuangan')<output.indexOf('Tiga analisis keuangan'));assert.match(output,/1 dari 3/);assert.match(output,/Analisis berikutnya/);assert.match(output,/Komposisi belanja/);assert.match(output,/Asal belanja/);assert.match(output,/Rincian minggu/);
 assert.doesNotMatch(output,/<details[^>]*\bopen(?:=|\s|>)/);for(const label of ['Biaya &amp; pajak','Aktivitas menurut akun','Aset &amp; investasi saat ini','Rincian angka bulanan'])assert.ok(output.includes(label));
});
test('fresh secondary disclosures do not eagerly render complete tables; expanded monthly table has no nested toggle',()=>{
 const fresh=html(fixture(),'IDR','current_month',false);assert.equal((fresh.match(/class="surface insight-panel insight-disclosure"/g)||[]).length,4);assert.doesNotMatch(fresh,/insight-disclosure-content|insight-chart-scroll|Rekening lama|P\/L terealisasi sepanjang riwayat|Tabel angka bulanan/);assert.match(fresh,/Ada posisi investasi tanpa harga/);
 const opened=html();assert.match(opened,/insight-disclosure" open=""/);assert.match(opened,/Rekening lama/);assert.match(opened,/<div class="insight-table-disclosure"><div class="insight-chart-scroll"[^>]*>/);assert.doesNotMatch(opened,/<summary>Tabel angka bulanan<\/summary>/);
});
test('rendering initial and expanded Insights emits no React title or markup warnings',()=>{
 const errors=[],previousError=console.error,previousWarn=console.warn;console.error=(...args)=>errors.push(args);console.warn=(...args)=>errors.push(args);
 try{html();html(fixture(),'IDR','current_month',false);desktopHtml();desktopHtml(fixture(),{'Biaya dan akun':'fees','Angka bulanan dan investasi':'investments'});}finally{console.error=previousError;console.warn=previousWarn;}
 assert.deepEqual(errors,[]);
});
test('desktop renders three summary pairs plus standalone origin, without duplicate mobile controls or IDs',()=>{
 const output=desktopHtml();assert.equal((output.match(/class="insight-detail-pair"/g)||[]).length,3);assert.equal((output.match(/class="surface insight-panel insight-summary-card"/g)||[]).length,6);assert.equal((output.match(/class="surface insight-panel insight-origin-section"/g)||[]).length,1);
 assert.doesNotMatch(output,/insight-carousel-track|insight-carousel-controls|insight-secondary-grid|insight-disclosure-content|class="insight-detail-content"/);assert.match(output,/insight-fit-chart/);assert.match(output,/insight-composition/);assert.match(output,/insight-origin-bar/);
 const ids=[...output.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]);assert.equal(ids.length,new Set(ids).size);
 const controls=[...output.matchAll(/aria-controls="([^"]+)"/g)].map(match=>match[1]);assert.equal(controls.length,6);assert.equal(new Set(controls).size,3);for(const id of controls)assert.ok(ids.includes(id));assert.equal((output.match(/aria-expanded="false"/g)||[]).length,6);
});

test('P6C desktop previews show genuine cost, account-spending and P4 flow charts with exact scopes',()=>{
 const r=fixture(),before=JSON.stringify(r),output=desktopHtml(r);
 assert.equal((output.match(/class="insight-cost-bars"/g)||[]).length,3);
 assert.match(output,/Layanan \(termasuk Transfer\)/); assert.match(output,/Belanja per akun pembayar/);
 assert.match(output,/Rekening lama · Diarsipkan/); assert.match(output,/Pokok beli P4/); assert.match(output,/Hasil jual P4/);
 assert.match(output,/Arus perdagangan terpisah dari belanja P3/);
 assert.doesNotMatch(output,/<caption>|class="insight-detail-content"|class="insight-dimensions"/);
 assert.equal(JSON.stringify(r),before);
});

test('P6C zero secondary data stays concise rather than generating decorative bar charts',()=>{
 const r=fixture(); r.summary[0]={...r.summary[0],feesMinor:'0',taxesMinor:'0',otherChargesMinor:'0',chargesMinor:'0'};
 r.charges=[];r.byAccount=[];r.investmentFlows=[];
 const output=desktopHtml(r);assert.doesNotMatch(output,/class="insight-cost-bars"/);
 assert.match(output,/Tidak ada biaya atau pajak P3/);assert.match(output,/Belum ada belanja pada akun/);assert.match(output,/Tidak ada perdagangan P4/);
});

test('P6C money has visible grouping fallback; only charts/tables and carousel retain explicit horizontal scrolling',()=>{
 const css=fs.readFileSync(new URL('../src/app/insights/insights.css',import.meta.url),'utf8');
 assert.match(css,/\.insight-money \{[^}]*overflow: visible; white-space: normal/);
 assert.doesNotMatch(css,/\.insight-(?:money|small-values dd)[^}]*overflow-x: auto/);
 assert.match(css,/\.insight-chart-scroll \{[^}]*overflow-x: auto/);
 assert.match(css,/\.insight-carousel-track \{[^}]*scroll-snap-type: x mandatory/);
});
test('primary expanded details are siblings; switching interval/category changes only their shared full-width content',()=>{
 const closed=desktopHtml(),intervals=desktopHtml(fixture(),{'Grafik pemasukan dan kategori':'intervals'}),categories=desktopHtml(fixture(),{'Grafik pemasukan dan kategori':'categories'});
 const summaries=output=>(output.match(/<section class="surface insight-panel insight-summary-card"[\s\S]*?<\/section>/g)||[]).map(card=>card.replaceAll('aria-expanded="true"','aria-expanded="false"'));
 assert.deepEqual(summaries(intervals),summaries(closed));assert.deepEqual(summaries(categories),summaries(closed));assert.equal((intervals.match(/class="insight-detail-content"/g)||[]).length,1);assert.match(intervals,/insight-interval-table/);assert.doesNotMatch(categories,/insight-interval-table/);assert.match(categories,/Persentase memakai total cakupan kategori/);assert.match(categories,/Tanpa kategori/);assert.match(categories,/Kategori lama/);assert.match(categories,/100,00%/);
});
test('desktop fees/account/monthly/investment details preserve financial content with one active detail per pair',()=>{
 const r=fixture(),before=JSON.stringify(r);
 const monthly=desktopHtml(r,{'Biaya dan akun':'accounts','Angka bulanan dan investasi':'monthly'});assert.match(monthly,/Rekening lama/);assert.match(monthly,/Pemasukan, belanja, dan net operasional \(IDR\)/);assert.match(monthly,/Rincian bulan/);assert.match(monthly,/Berjalan/);assert.equal((monthly.match(/<caption>/g)||[]).length,1);assert.doesNotMatch(monthly,/insight-disclosure-content|P\/L terealisasi sepanjang riwayat/);
 const investments=desktopHtml(r,{'Biaya dan akun':'fees','Angka bulanan dan investasi':'investments'});for(const label of ['Biaya khusus','Biaya layanan pada Transfer','P/L terealisasi sepanjang riwayat','Rp993','Biaya perdagangan P4','Rp15','Total aset diketahui','Dana likuid','Dapat digunakan','Setelah kewajiban','1 posisi belum memiliki harga'])assert.ok(investments.includes(label),label);
 assert.doesNotMatch(investments,/<caption>|class="insight-dimensions"/);assert.match(investments,/Rekening lama/);assert.equal((investments.match(/class="insight-detail-content"/g)||[]).length,2);assert.equal(JSON.stringify(r),before);
});
test('responsive branches retain the accepted mobile carousel/disclosures without hidden desktop interactive content',()=>{
 const output=html(fixture(),'IDR','current_month',false);assert.equal((output.match(/class="surface insight-panel insight-slide"/g)||[]).length,3);assert.equal((output.match(/class="surface insight-panel insight-disclosure"/g)||[]).length,4);assert.doesNotMatch(output,/insight-detail-pair|insight-detail-panel|insight-detail-trigger/);assert.match(output,/Ada posisi investasi tanpa harga/);assert.match(output,/Rp1\.000\.000/);assert.match(output,/Rp109\.000/);assert.match(output,/Rp891\.000/);
});
test('V2 warnings remain visible outside collapsed detail and visual rendering never mutates report values',()=>{
 const r=fixture(),before=JSON.stringify(r),output=html(r);assert.equal(JSON.stringify(r),before);assert.ok(output.indexOf('Ada posisi investasi tanpa harga')<output.indexOf('Tiga analisis keuangan'));assert.ok(output.indexOf('Periode berjalan')<output.indexOf('Tiga analisis keuangan'));
 assert.equal(r.byOrigin.reduce((sum,row)=>sum+BigInt(row.spendingMinor),0n),BigInt(r.summary[0].spendingMinor));assert.match(output,/Pemasukan tidak masuk denominator/);assert.match(output,/P\/L terealisasi sepanjang riwayat/);
});
test('V2 zero costs and no trades render concise text without empty cost charts or valuation history',()=>{
 const r=fixture();r.charges=[];r.investmentFlows=[];r.summary[0]={...r.summary[0],feesMinor:'0',taxesMinor:'0',otherChargesMinor:'0',chargesMinor:'0'};const output=html(r);
 assert.doesNotMatch(output,/class="insight-cost-bars"/);assert.match(output,/Tidak ada biaya atau pajak P3/);assert.match(output,/Tidak ada perdagangan P4/);assert.doesNotMatch(output,/Riwayat pertumbuhan aset|demo-data/);
});
