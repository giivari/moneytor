import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {registerHooks} from 'node:module';
import fs from 'node:fs';
import ts from 'typescript';
import pg from 'pg';
const name=process.env.MONEYTOR_ANALYTICS_DB_TEST;
test('P6A analytics on strictly disposable PostgreSQL',{skip:!/^moneytor_composable_verify_\d+$/.test(name??'')},async t=>{
  const url=new URL(process.env.DATABASE_URL);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55433');assert.equal(url.pathname,`/${name}`);
  const admin=new pg.Client({connectionString:url.toString()});await admin.connect();
  assert.equal((await admin.query('SELECT current_database() AS name')).rows[0].name,name);
  const schema=`analytics_${randomUUID().replaceAll('-','')}`;let pool,hooks;
  try{
    await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
    for(const file of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL(`../db/migrations/${file}`,import.meta.url),'utf8'));
    url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
    hooks=registerHooks({resolve(specifier,context,next){
      if(specifier==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
      if(specifier==='@/lib/auth/session')return {url:"data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__analyticsAuthorized)throw Error('Unauthorized');return {credentialId:'disposable'}} export async function currentOwnerSession(){return globalThis.__analyticsAuthorized?{credentialId:'disposable'}:null}",shortCircuit:true};
      if(specifier==='next/server')return next('next/server.js',context);
      if(specifier.startsWith('@/')){const base=new URL(`../src/${specifier.slice(2)}`,import.meta.url);return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);}
      if(context.parentURL?.includes('/src/')&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)){const base=new URL(specifier,context.parentURL);return next(base.href+(fs.existsSync(new URL(base.href+'.tsx'))?'.tsx':'.ts'),context);}
      return next(specifier,context);
    },load(url,context,next){
      if(url.endsWith('.css'))return {format:'module',shortCircuit:true,source:'export {}'};
      if(url.endsWith('.tsx'))return {format:'module',shortCircuit:true,source:ts.transpileModule(fs.readFileSync(new URL(url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
      return next(url,context);
    }});
    const {readAnalytics,analyticsCurrencyOptions}=await import('../src/lib/analytics/service.ts');
    let renderReport,Page,renderPage;
    if(process.env.MONEYTOR_INSIGHTS_RENDER_TEST==='1'){
      const React=await import('react'),{renderToStaticMarkup}=await import('react-dom/server');
      const {InsightsReportView}=await import('../src/components/insights-report.tsx');
      Page=(await import('../src/app/insights/page.tsx')).default;
      renderReport=(report,currency='IDR')=>renderToStaticMarkup(React.createElement(InsightsReportView,{report,currency}));
      renderPage=renderToStaticMarkup;
    }
    const route=await import('../src/app/api/analytics/route.ts');
    const {NextRequest}=await import('next/server.js');
    const finance=await import('../src/lib/finance/service.ts'),assets=await import('../src/lib/repositories/assets.ts'),catalogs=await import('../src/lib/repositories/catalogs.ts');
    const {financeSnapshot,monthlyExpenses}=await import('../src/lib/finance/summary.ts');
    const investments=await import('../src/lib/investments/service.ts'),planning=await import('../src/lib/planning/repository.ts');
    const engine=await import('../src/lib/automation/composable-service.ts'),legacy=await import('../src/lib/automation/income-events.ts'),allocation=await import('../src/lib/automation/allocation-service.ts');
    pool=(await import('../src/lib/db/pool.ts')).database();
    const at='2026-10-01T08:00:00.000Z',now=new Date('2026-10-11T08:00:00.000Z');
    const read=(options={})=>readAnalytics({period:{kind:'current_month'},...options},now);
    const idr=r=>r.summary.find(c=>c.currency==='IDR');
    const type=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const makeAsset=(displayName,currency='IDR')=>assets.insertAssetWithOpening({displayName,currency,assetTypeId:type,normallyLiquid:true,normallySpendable:true,openingAmountMinor:10000000n,openingEffectiveAt:new Date(at)});
    const income=(asset,amountMinor,occurredAt=at)=>({kind:'income',destinationAssetId:asset,amountMinor,occurredAt});
    const expense=(asset,amountMinor,extra={})=>({kind:'expense',sourceAssetId:asset,amountMinor,occurredAt:at,...extra});
    const fingerprint=async()=>createHash('sha256').update((await admin.query(`SELECT COALESCE(jsonb_agg(v ORDER BY v::text),'[]')::text AS value FROM
      (SELECT jsonb_build_object('table',table_name,'row',row) v FROM (
        SELECT 'financial_activities' AS table_name,to_jsonb(f) AS row FROM financial_activities f UNION ALL
        SELECT 'ledger_movements',to_jsonb(l) FROM ledger_movements l UNION ALL SELECT 'activity_charges',to_jsonb(c) FROM activity_charges c
      ) records) q`)).rows[0].value).digest('hex');
    await t.test('authentication guards reader and HTTP before any report access',async()=>{
      await assert.rejects(read(),/Unauthorized/);
      await assert.rejects(analyticsCurrencyOptions(),/Unauthorized/);
      if(Page)await assert.rejects(Page({searchParams:Promise.resolve({})}),/Unauthorized/);
      assert.equal((await route.GET(new NextRequest('http://localhost/api/analytics'))).status,401);
    });
    globalThis.__analyticsAuthorized=true;
    const cash=await makeAsset('Analytics cash'),destination=await makeAsset('Analytics destination'),usd=await makeAsset('Analytics USD','USD');
    await t.test('Insights currency controls use the same used-currency universe, with no writes',async()=>{
      const before=await fingerprint();assert.deepEqual(await analyticsCurrencyOptions(),[{currency:'IDR',exponent:0},{currency:'USD',exponent:2}]);assert.equal(await fingerprint(),before);
    });
    const category=await catalogs.insertCustomCategory('Editable category','expense');
    const tax=(await admin.query("SELECT id FROM additional_charge_types WHERE system_key='tax'")).rows[0].id;
    const adminFee=(await admin.query("SELECT id FROM additional_charge_types WHERE system_key='admin_fee'")).rows[0].id;
    const custom=(await catalogs.insertCustomCatalogItem('chargeTypes','Custom charge')).id;
    const charges=[{typeId:tax,amountMinor:'2000'},{typeId:adminFee,amountMinor:'1000'},{typeId:custom,amountMinor:'3000'}];
    let source,spending;
    await t.test('empty data, opening balances excluded and zero-filled months per currency',async()=>{
      const r=await read();assert.equal(idr(r).incomeMinor,'0');assert.equal(idr(r).activityCount,'0');assert.equal(r.byCategory.length,0);
      assert.equal(r.monthly.length,2);assert.equal(r.context.currencies.find(c=>c.currency==='IDR').totalMinor,'20000000');
      assert.equal(r.comparison.currencies[0].income.percentageChangeBps,null);
    });
    await t.test('principal, multiple charge catalogs and transfer fee counted exactly once',async()=>{
      source=await finance.postActivity(income(cash,'5000000'),randomUUID());
      spending=await finance.postActivity(expense(cash,'100000',{categoryId:category.id,charges}),randomUUID());
      await finance.postActivity({kind:'transfer',sourceAssetId:cash,destinationAssetId:destination,amountMinor:'1000000',transferFeeMinor:'1000',occurredAt:at},randomUUID());
      const r=await read(),s=idr(r);
      assert.equal(s.incomeMinor,'5000000');assert.equal(s.expensePrincipalMinor,'100000');assert.equal(s.feesMinor,'2000');assert.equal(s.taxesMinor,'2000');assert.equal(s.otherChargesMinor,'3000');assert.equal(s.transferFeesMinor,'1000');
      assert.equal(s.spendingMinor,'107000');assert.equal(s.netMinor,'4893000');assert.equal(s.transferPrincipalMinor,'1000000');assert.equal(s.activityCount,'3');
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM ledger_movements')).rows[0].n,8);
      assert.equal(r.charges.reduce((sum,c)=>sum+BigInt(c.amountMinor),0n),7000n);
      assert.equal(r.charges.find(c=>c.typeId===custom).bucket,'other');
    });
    if(renderReport)await t.test('real disposable report renders exact totals, compatible category shares, custom charges and no demo data',async()=>{
      const before=await fingerprint(),r=await read(),output=renderReport(r);
      assert.match(output,/Rp107\.000/);assert.match(output,/Rp4\.893\.000/);assert.match(output,/Rp106\.000/);assert.match(output,/100,00%/);assert.match(output,/Custom charge/);assert.doesNotMatch(output,/Pratinjau ilustrasi|39\.900\.000/);assert.equal(await fingerprint(),before);
    });
    await t.test('category/account rankings, editable names, and archived references retained',async()=>{
      await catalogs.renameCustomCatalogItem('transactionCategories',category.id,'Renamed category');
      await catalogs.archiveCustomCatalogItem('transactionCategories',category.id);
      const r=await read(),cat=r.byCategory[0];assert.equal(cat.name,'Renamed category');assert.equal(cat.archived,true);assert.equal(cat.spendingMinor,'106000');
      assert.equal(r.byAccount.find(c=>c.id===cash).spendingMinor,'107000');
      const old=await makeAsset('Archived account');await finance.postActivity(expense(old,'5'),randomUUID());await assets.archiveAsset(old);
      const archived=(await read()).byAccount.find(c=>c.id===old);assert.equal(archived.archived,true);assert.equal(archived.spendingMinor,'5');
    });
    await t.test('correction chains, effective dates and voids exclude all old amounts and charges',async()=>{
      source=await finance.replaceActivity(source,income(cash,'1300000','2026-09-30T17:00:00.000Z'),randomUUID());
      source=await finance.replaceActivity(source,income(cash,'1400000','2026-09-30T16:59:59.999Z'),randomUUID());
      assert.equal(idr(await read()).incomeMinor,'0');
      assert.equal(idr(await read({period:{kind:'previous_month'}})).incomeMinor,'1400000');
      assert.deepEqual((await read()).comparison.currencies.find(c=>c.currency==='IDR').income,{differenceMinor:'-1400000',percentageChangeBps:'-10000'});
      await finance.voidActivity(source,randomUUID());await finance.voidActivity(spending,randomUUID());
      const s=idr(await read());assert.equal(s.expensePrincipalMinor,'5');assert.equal(s.chargesMinor,'1000');assert.equal(s.activityCount,'2');
    });
    await t.test('uncategorized rows and deterministic day/month time aggregation',async()=>{
      await finance.postActivity(expense(cash,'2500'),randomUUID());
      const r=await read();assert.equal(r.byCategory.find(c=>c.id===null).expensePrincipalMinor,'2505');
      assert.equal(r.daily.find(c=>c.currency==='IDR').key,'2026-10-01');assert.equal(r.monthly.find(c=>c.currency==='IDR').spendingMinor,idr(r).spendingMinor);
    });
    await t.test('currency separation and exact sums beyond PostgreSQL bigint range',async()=>{
      await finance.postActivity(income(usd,'12345'),randomUUID());
      for(let i=0;i<2;i++)await finance.postActivity(income(destination,'9223372036854775807'),randomUUID());
      const r=await read();assert.equal(idr(r).incomeMinor,'18446744073709551614');assert.equal(r.summary.find(c=>c.currency==='USD').incomeMinor,'12345');
      assert.equal((await read({currency:'USD'})).summary.length,1);assert.equal((await read({currency:'USD'})).context.currencies.length,1);
    });
    await t.test('HTTP serializes money safely, validates filters and never leaks runtime errors',async()=>{
      const response=await route.GET(new NextRequest('http://localhost/api/analytics?period=custom&start=2026-10-01&end=2026-10-31&context=false'));
      assert.equal(response.status,200);assert.equal((await response.json()).summary.find(c=>c.currency==='IDR').incomeMinor,'18446744073709551614');
      assert.equal(response.headers.get('cache-control'),'no-store');
      for(const query of ['currency=XXX','period=custom&start=2020-01-01&end=2026-01-01','period=invalid','context=false&context=true'])assert.equal((await route.GET(new NextRequest(`http://localhost/api/analytics?${query}`))).status,400);
      await assert.rejects(read({currency:'idr'}),/Filter/);await assert.rejects(read({includeContext:'false'}),/Filter/);
    });
    await t.test('investment buys/sells/fees remain separate; unpriced holdings and P/L reuse P4',async()=>{
      const typeId=await investments.createInstrumentType('Analytics security');
      const portfolioId=await investments.createPortfolio({displayName:'Analytics portfolio',currency:'IDR'});
      const instrumentId=await investments.createInstrument({displayName:'Unpriced security',currency:'IDR',typeId});
      const trade=(kind,quantity,unitPrice,feeMinor)=>({kind,quantity,unitPrice,feeMinor,portfolioId,instrumentId,cashAssetId:cash,occurredAt:at});
      const before=idr(await read());
      const buy=await investments.postInvestmentTrade(trade('buy','10','1000','10'),randomUUID());
      await investments.postInvestmentTrade(trade('sell','2','1500','5'),randomUUID());
      const r=await read(),flow=r.investmentFlows[0];assert.deepEqual(idr(r),before);
      assert.equal(flow.purchasePrincipalMinor,'10000');assert.equal(flow.saleProceedsMinor,'3000');assert.equal(flow.feesMinor,'15');assert.equal(flow.netCashMinor,'-7015');
      const total=r.context.investments[0];assert.equal(total.unpricedCount,1);assert.equal(total.marketMinor,'0');assert.equal(total.realizedMinor,'993');
      const corrected=await investments.replaceInvestmentTrade(buy,trade('buy','10','900','10'),randomUUID());
      assert.equal((await read()).investmentFlows[0].purchasePrincipalMinor,'9000');
      // A buy supporting a sell cannot be voided; correction replay already proves inactive trade exclusion.
      assert.ok(corrected);
    });
    await t.test('Planning reserves/targets/obligations are context, never spending',async()=>{
      const data=await planning.listPlanning();const label=data.labels.find(l=>l.kind==='reserve').id;
      const before=idr(await read());
      await planning.mutatePlanning('save-reserve',{title:'Analytics reserve',currency:'IDR',labelId:label,amountMinor:'100000',purpose:'emergency'},randomUUID());
      const r=await read();assert.deepEqual(idr(r),before);assert.equal(r.context.currencies.find(c=>c.currency==='IDR').reservedMinor,'100000');
    });
    await t.test('canonical Home/P3/P4/P5 consistency in a shared read snapshot',async()=>{
      const r=await read(),home=await financeSnapshot({includeRecent:false});assert.deepEqual(r.context.currencies,home.currencies);assert.deepEqual(r.context.investments,home.investment.totals);
      assert.equal(idr(r).spendingMinor,(await monthlyExpenses()).find(c=>c.currency==='IDR').expenseMinor);
    });
    for(const storage of ['general','income_event'])await t.test(`${storage}: actual Automation expense and allocation adjustments counted once, including corrected provenance`,async()=>{
      const live=new Date().toISOString();
      const rule=storage==='general'?await engine.saveGeneralRule({title:'Analytics 10%',trigger:{namespace:'transaction_posted',activityKind:'income'},conditionMode:'ALL',conditions:[],execution:'confirm_before_execute',actions:[{kind:'expense',source:{strategy:'trigger_destination_asset'},amount:{strategy:'percentage_of_trigger',percentageBps:1000},charges:[]}]}):await legacy.saveIncomeEventRule({title:'Analytics legacy 10%',percentageBps:1000,outputKind:'expense'});
      const root=await finance.postActivity(income(cash,'1000000',live),randomUUID());
      if(storage==='general')await engine.reconcileGeneralAutomation();else await legacy.reconcileIncomeEvents();
      const table=storage==='general'?'automation_instances':'income_event_instances';
      const instance=(await admin.query(`SELECT id FROM ${table} WHERE rule_id=$1 AND root_activity_id=$2`,[rule,root])).rows[0].id;
      if(storage==='general')await engine.confirmGeneralInstance(instance);else await legacy.postIncomeEvent(instance);
      const effective=await finance.replaceActivity(root,income(cash,'1300000',live),randomUUID());
      const assessment=await allocation.assessAllocation(storage,instance);assert.equal(assessment.differenceMinor,'30000');
      const before=await readAnalytics();const result=await allocation.confirmAllocation(assessment.proposalId);
      const after=await readAnalytics();
      assert.equal(BigInt(idr(after).expensePrincipalMinor)-BigInt(idr(before).expensePrincipalMinor),30000n);
      assert.equal(BigInt(after.byOrigin.find(c=>c.key==='allocation_adjustment').expensePrincipalMinor)-BigInt(before.byOrigin.find(c=>c.key==='allocation_adjustment')?.expensePrincipalMinor??'0'),30000n);
      const current=await finance.replaceActivity(result.id,expense(cash,'40000',{occurredAt:live}),randomUUID());
      const corrected=await readAnalytics();assert.ok(corrected.byOrigin.find(c=>c.key==='allocation_adjustment').expensePrincipalMinor);
      assert.equal(BigInt(idr(corrected).expensePrincipalMinor)-BigInt(idr(after).expensePrincipalMinor),10000n);
      assert.equal((await finance.listActivities()).find(f=>f.id===current).allocationAdjustmentId,assessment.proposalId);
      await finance.voidActivity(effective,randomUUID());await allocation.assessAllocation(storage,instance);
      const stable=await fingerprint();await readAnalytics();assert.equal(await fingerprint(),stable);
      if(storage==='general')await engine.setGeneralRuleStatus(rule,'paused');else await legacy.setIncomeEventRuleStatus(rule,'paused');
    });
    await t.test('reads preserve all financial records and run under READ ONLY without reconciliation',async()=>{
      const before=await fingerprint();for(let i=0;i<2;i++)await read();assert.equal(await fingerprint(),before);
      const ready=await read({includeContext:false});assert.equal(ready.context,null);
      globalThis.__analyticsAuthorized=false;await assert.rejects(read(),/Unauthorized/);globalThis.__analyticsAuthorized=true;
    });
    if(renderReport)await t.test('P4, Planning and Automation disposable report reaches real Insights without financial mutation',async()=>{
      const before=await fingerprint(),r=await readAnalytics(),output=renderReport(r);
      for(const label of ['Automation','Penyesuaian alokasi','P/L terealisasi sepanjang riwayat','posisi belum memiliki harga','Biaya perdagangan P4'])assert.ok(output.includes(label));
      const page=renderPage(await Page({searchParams:Promise.resolve({period:'current_month',currency:'USD'})}));
      assert.match(page,/USD/);assert.doesNotMatch(page,/Rp107\.000|Rp993|Memuat laporan/);
      const invalid=renderPage(await Page({searchParams:Promise.resolve({period:'monthly_trend',months:'37'})}));assert.match(invalid,/Tren dibatasi/);assert.doesNotMatch(invalid,/Net operasional/);
      assert.equal(await fingerprint(),before);
    });
  }finally{if(pool)await pool.end();hooks?.deregister();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
