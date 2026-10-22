import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {registerHooks} from 'node:module';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const name=process.env.MONEYTOR_PRESENTATION_DB_TEST;
test('Presentation reads on disposable PostgreSQL',{skip:!/^moneytor_composable_verify_\d+$/.test(name??'')},async t=>{
 const url=new URL(process.env.DATABASE_URL);assert.equal(url.pathname,'/'+name);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55433');
 const admin=new pg.Client({connectionString:url.toString()});await admin.connect();const schema='presentation_'+randomUUID().replaceAll('-','');let pool,hooks;
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await admin.query(`SET search_path TO ${schema}`);
  for(const file of (await readdir(new URL('../db/migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));
  url.searchParams.set('options','-c search_path='+schema);process.env.DATABASE_URL=url.toString();
  hooks=registerHooks({resolve(specifier,context,next){
   if(specifier==='@/lib/auth/session')return {url:'data:text/javascript,export async function requireOwnerSession(){return {credentialId:"disposable"}}',shortCircuit:true};
   if(specifier.startsWith('@/'))return next(new URL('../src/'+specifier.slice(2)+'.ts',import.meta.url).href,context);
   if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(new URL(specifier+'.ts',context.parentURL).href,context);return next(specifier,context);
  }});
  const finance=await import('../src/lib/finance/service.ts'),recurring=await import('../src/lib/automation/service.ts'),income=await import('../src/lib/automation/income-events.ts'),general=await import('../src/lib/automation/composable-service.ts');
  const {readAutomationHistoryPage}=await import('../src/lib/automation/history-page.ts');
  const {insertAssetWithOpening}=await import('../src/lib/repositories/assets.ts');pool=(await import('../src/lib/db/pool.ts')).database();
  const type=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
  const source=await insertAssetWithOpening({displayName:'Disposable',currency:'IDR',assetTypeId:type,normallyLiquid:true,normallySpendable:true,openingAmountMinor:1000000n,openingEffectiveAt:new Date('2026-01-01')});
  const post=(kind='income',time='2026-10-09T02:00:00.000Z')=>finance.postActivity({kind,amountMinor:'10000',occurredAt:time,...(kind==='income'?{destinationAssetId:source}:{sourceAssetId:source})},randomUUID());
  await t.test('keyset pages sort complete filtered records and preserve tie identity in both directions',async()=>{
   for(let i=0;i<55;i++)await post(i%2?'expense':'income');
   for(const direction of ['asc','desc']){
    const expected=await finance.listActivities(false,100,{direction});const first=await finance.listActivities(false,20,{direction});
    const last=first.at(-1);const second=await finance.listActivities(false,100,{direction,after:{at:last.cursorTime,id:last.id}});
    assert.deepEqual([...first,...second].map(r=>r.id),expected.map(r=>r.id));assert.equal(new Set([...first,...second].map(r=>r.id)).size,55);
    const expense=await finance.listActivities(false,100,{direction,kind:'expense'});assert.ok(expense.every(r=>r.kind==='expense'));assert.equal(expense.length,27);
   }
  });
  await t.test('correction/void visibility and lineage survive paged reads',async()=>{
   const original=await post();const replacement=await finance.replaceActivity(original,{kind:'income',amountMinor:'20000',destinationAssetId:source,occurredAt:'2026-10-09T02:00:00.000Z'},randomUUID());
   await finance.voidActivity(replacement,randomUUID());const active=await finance.listActivities(false,100),all=await finance.listActivities(true,100);
   assert.ok(!active.some(r=>[original,replacement].includes(r.id)));assert.equal(all.find(r=>r.id===original).status,'superseded');assert.equal(all.find(r=>r.id===replacement).replacesActivityId,original);
  });
  const eventRule=await income.saveIncomeEventRule({title:'Event',percentageBps:1000,outputKind:'expense',charges:[]});
  const category=await general.saveAutomationCategory('Organization');
  const generic=await general.saveGeneralRule({title:'Generic',automationCategoryId:category,trigger:{namespace:'transaction_posted',activityKind:'income'},conditionMode:'ALL',conditions:[],execution:'confirm_before_execute',actions:[{kind:'expense',source:{strategy:'trigger_destination_asset'},amount:{strategy:'percentage_of_trigger',percentageBps:1000},charges:[]}]});
  for(let i=0;i<6;i++)await post('income',new Date().toISOString());
  for(let i=0;i<4;i++){await income.reconcileIncomeEvents();await general.reconcileGeneralAutomation();}
  const events=(await income.readIncomeEvents()).instances.filter(r=>r.rule_id===eventRule),genericItems=(await general.readGeneralAutomation()).instances.filter(r=>r.rule_id===generic);
  for(const item of events.slice(0,4))await income.skipIncomeEvent(item.id);for(const item of genericItems.slice(0,4))await general.skipGeneralInstance(item.id);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const schedule=await recurring.saveRule({title:'Schedule',kind:'expense',amountMode:'fixed',amountMinor:'100',executionMode:'confirm_before_post',sourceAssetId:source,frequency:'daily',startOn:today,localTime:'23:59',charges:[]});
  await recurring.reconcileAutomation();const occurrence=(await recurring.readAutomation()).occurrences.find(r=>r.rule_id===schedule);assert.ok(occurrence);await recurring.skipOccurrence(occurrence.id);
  await t.test('history union pages mixed legacy/generic records before revealing, in both directions',async()=>{
   const all=[];for(const direction of ['desc','asc']){
    const first=await readAutomationHistoryPage({direction,limit:5,source:'',category:''});assert.equal(first.items.length,5);assert.equal(first.remaining,4);assert.ok(first.next);
    const next=await readAutomationHistoryPage({direction,limit:5,source:'',category:'',after:first.next});assert.equal(next.items.length,4);assert.equal(next.next,null);
    const keys=[...first.items,...next.items].map(r=>r.key);assert.equal(new Set(keys).size,9);all.push(keys);
   }assert.deepEqual(all[0],[...all[1]].reverse());
  });
  await t.test('trigger/category filters apply before the history page, legacy rows are not duplicated',async()=>{
   const byCategory=await readAutomationHistoryPage({direction:'desc',limit:10,source:'',category});assert.equal(byCategory.items.length,4);assert.ok(byCategory.items.every(r=>r.storage==='general'));
   const byTime=await readAutomationHistoryPage({direction:'asc',limit:10,source:'time',category:''});assert.deepEqual(byTime.items.map(r=>r.storage),['schedule']);
   const initial=[await recurring.readAutomation([]),await income.readIncomeEvents([]),await general.readGeneralAutomation([])];
   assert.ok(initial[0].occurrences.every(r=>!['posted','skipped','voided','superseded'].includes(r.status)));assert.ok(initial[1].instances.every(r=>r.status!=='skipped'));assert.ok(initial[2].instances.every(r=>r.status!=='skipped'));
  });
  await t.test('history queries and collapsed initial reads have zero financial writes',async()=>{
   const before=(await admin.query('SELECT count(*)::text count,md5(string_agg(to_jsonb(f)::text,\'\' ORDER BY id)) hash FROM financial_activities f')).rows;
   await readAutomationHistoryPage({direction:'desc',limit:10,source:'',category:''});await finance.listActivities(true,51);await general.readGeneralAutomation([]);
   const after=(await admin.query('SELECT count(*)::text count,md5(string_agg(to_jsonb(f)::text,\'\' ORDER BY id)) hash FROM financial_activities f')).rows;assert.deepEqual(after,before);
  });
 }finally{if(pool)await pool.end();if(hooks)hooks.deregister();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
