import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const databaseName = process.env.MONEYTOR_EVENT_DB_TEST;
const enabled = databaseName === "moneytor_p51b_verify" || /^moneytor_composable_verify_\d+$/.test(databaseName ?? "");
test("P5.1B Income events on isolated PostgreSQL schema",{skip:!enabled},async(t)=>{
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname,"127.0.0.1");assert.equal(target.port,"55433");assert.equal(target.pathname,`/${databaseName}`);
  const admin = new pg.Client({connectionString:target.toString()});await admin.connect();
  const schema=`p51b_test_${randomUUID().replaceAll("-","")}`;
  let pool, hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query("CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)");
    const migrations=await Promise.all((await readdir(new URL("../db/migrations/",import.meta.url))).filter((file)=>file.endsWith(".sql")).sort()
      .map(async(file)=>({file,sql:await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8")})));
    assert.equal(migrations.at(-1).file,"013_home_customization.sql");
    for(const {file,sql} of migrations){await admin.query(sql);await admin.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",[file,createHash("sha256").update(sql).digest("hex")]);}
    target.searchParams.set("options",`-c search_path=${schema}`);process.env.DATABASE_URL=target.toString();
    hooks=registerHooks({resolve(specifier,context,next){
      if(specifier==="@/lib/auth/session")return {url:"data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__incomeEventAuthorized)throw Error('Unauthorized');return {credentialId:'disposable'}}",shortCircuit:true};
      if(specifier.startsWith("@/"))return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if(specifier.startsWith(".")&&!/\.[a-z]+$/i.test(specifier))return next(new URL(`${specifier}.ts`,context.parentURL).href,context);
      return next(specifier,context);
    }});
    const events=await import("../src/lib/automation/income-events.ts");
    const recurring=await import("../src/lib/automation/service.ts");
    const finance=await import("../src/lib/finance/service.ts");
    const {insertAssetWithOpening,listAssets}=await import("../src/lib/repositories/assets.ts");
    const assets=await import("../src/lib/repositories/assets.ts");
    const catalogs=await import("../src/lib/repositories/catalogs.ts");
    const {database}=await import("../src/lib/db/pool.ts");pool=database();
    await assert.rejects(events.readIncomeEvents(),/Unauthorized/);
    globalThis.__incomeEventAuthorized=true;
    const type=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const source=await insertAssetWithOpening({displayName:"Event source",currency:"IDR",assetTypeId:type,normallyLiquid:true,normallySpendable:true,
      openingAmountMinor:1000000n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
    const targetAsset=await insertAssetWithOpening({displayName:"Event target",currency:"IDR",assetTypeId:type,normallyLiquid:true,normallySpendable:true,
      openingAmountMinor:0n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
    const expenseRule=(title="Event expense",percentageBps=1000)=>({title,percentageBps,outputKind:"expense",charges:[]});
    const income=(amount="10000",asset=source)=>finance.postActivity({kind:"income",amountMinor:amount,destinationAssetId:asset,occurredAt:new Date().toISOString()},randomUUID());
    const instance=async(ruleId,rootId)=>(await admin.query("SELECT * FROM income_event_instances WHERE rule_id=$1 AND root_activity_id=$2",[ruleId,rootId])).rows[0];
    const drain=async()=>{for(let i=0;i<8;i++){const result=await events.reconcileIncomeEvents();if(result.created<50&&result.refreshed<50)return;}throw Error("Reconciliation failed to drain");};
    await t.test("new rules do not match earlier Income; exact snapshot and two-rule identity",async()=>{
      const older=await income("10000");
      const key=randomUUID();
      const first=await events.saveIncomeEventRule(expenseRule(),undefined,key);
      assert.equal(await events.saveIncomeEventRule(expenseRule(),undefined,key),first);
      const second=await events.saveIncomeEventRule(expenseRule("Another rule",250));
      await drain();assert.equal(await instance(first,older),undefined);
      const root=await income("10001");
      await Promise.all([events.reconcileIncomeEvents(),events.reconcileIncomeEvents()]);await drain();
      const a=await instance(first,root),b=await instance(second,root);
      assert.equal(a.proposed_amount_minor,"1000");assert.equal(b.proposed_amount_minor,"250");
      assert.equal(a.source_asset_id,source);assert.equal(a.status,"awaiting_confirmation");
      assert.notEqual(a.id,b.id);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances WHERE root_activity_id=$1",[root])).rows[0].n,2);
      await events.reconcileIncomeEvents();
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances WHERE rule_id=$1 AND root_activity_id=$2",[first,root])).rows[0].n,1);
      await events.setIncomeEventRuleStatus(second,"paused");
      {
        const before=(await listAssets()).find((item)=>item.id===source).balanceMinor;
        const [one,two]=await Promise.all([events.postIncomeEvent(a.id),events.postIncomeEvent(a.id)]);
        assert.equal(one,two);
        assert.equal((await admin.query("SELECT kind FROM financial_activities WHERE id=$1",[one])).rows[0].kind,"expense");
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[a.id])).rows[0].n,1);
        const after=(await listAssets()).find((item)=>item.id===source).balanceMinor;
        assert.equal(BigInt(after)-BigInt(before),-1000n);
        const activity=(await finance.listActivities()).find((item)=>item.id===one);
        assert.equal(activity.recurringRuleName,"Event expense");assert.equal(activity.eventSourceIncomeId,root);assert.equal(activity.eventInstanceId,a.id);
        assert.equal((await events.readIncomeEvents()).instances.some((item)=>item.id===a.id && item.latest_result_status==="posted"),true);
        const corrected=await finance.replaceActivity(one,{kind:"expense",amountMinor:"900",sourceAssetId:source,occurredAt:new Date().toISOString()},randomUUID());
        assert.equal((await finance.listActivities()).find((item)=>item.id===corrected).eventInstanceId,a.id);
        await finance.voidActivity(corrected,randomUUID());
        assert.equal((await finance.listActivities(true)).find((item)=>item.id===corrected).eventInstanceId,a.id);
      }
    });
    await t.test("skip writes no finance operation or ledger movement",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Skip rule"));
      const root=await income("4000");await drain();const row=await instance(rule,root);
      const before=(await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n;
      await events.skipIncomeEvent(row.id);await events.skipIncomeEvent(row.id);
      assert.equal((await instance(rule,root)).status,"skipped");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n,before);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[row.id])).rows[0].n,0);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("pause, resume, archive, restore use active-at-source periods",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Lifecycle"));
      await events.setIncomeEventRuleStatus(rule,"paused");const paused=await income("1000");
      await events.setIncomeEventRuleStatus(rule,"active");const resumed=await income("1000");
      await events.setIncomeEventRuleStatus(rule,"archived");const archived=await income("1000");
      await events.setIncomeEventRuleStatus(rule,"active");const restored=await income("1000");await drain();
      assert.equal(await instance(rule,paused),undefined);assert.ok(await instance(rule,resumed));
      assert.equal(await instance(rule,archived),undefined);assert.ok(await instance(rule,restored));
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("edit changes future unmatched Income, not historical rule version",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Before edit"));
      const before=await income("10000");
      await events.saveIncomeEventRule(expenseRule("After edit",250),rule);
      const after=await income("10000");await drain();
      assert.equal((await instance(rule,before)).proposed_amount_minor,"1000");
      assert.equal((await instance(rule,after)).proposed_amount_minor,"250");
      assert.equal((await instance(rule,before)).rule_version,1);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("Income correction refreshes one pending candidate and source void prevents posting",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Source edits"));
      const root=await income("10000");await drain();const first=await instance(rule,root);
      assert.equal(first.root_activity_id,root);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances WHERE rule_id=$1",[rule])).rows[0].n,1);
      const replacement=await finance.replaceActivity(root,{kind:"income",amountMinor:"20000",destinationAssetId:source,occurredAt:new Date().toISOString()},randomUUID());
      assert.notEqual(replacement,root);
      assert.equal((await admin.query("SELECT replaces_activity_id FROM financial_activities WHERE id=$1",[replacement])).rows[0].replaces_activity_id,root);
      await drain();const refreshed=await instance(rule,root);
      assert.equal(refreshed.id,first.id);assert.equal(refreshed.effective_activity_id,replacement);
      assert.equal(refreshed.root_activity_id,root);
      assert.equal(refreshed.proposed_amount_minor,"2000");
      // Inspect both identities and the entire rule, so an additional replacement candidate cannot hide behind the original.
      for(let replay=0;replay<2;replay++){
        await drain();
        assert.deepEqual((await admin.query("SELECT root_activity_id FROM income_automation_sources WHERE root_activity_id=ANY($1::uuid[])",[[root,replacement]])).rows,[{root_activity_id:root}]);
        assert.deepEqual((await admin.query("SELECT id,root_activity_id,effective_activity_id FROM income_event_instances WHERE rule_id=$1",[rule])).rows,
          [{id:first.id,root_activity_id:root,effective_activity_id:replacement}]);
        assert.equal(await instance(rule,replacement),undefined);
      }
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instance_revisions WHERE instance_id=$1",[first.id])).rows[0].n,1);
      await finance.voidActivity(replacement,randomUUID());
      await assert.rejects(events.postIncomeEvent(first.id));
      await drain();assert.equal((await instance(rule,root)).status,"superseded");
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("posted result remains intact after source correction or void",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Review source"));
      const root=await income("10000");await drain();const row=await instance(rule,root);
      const result=await events.postIncomeEvent(row.id);
      const replacement=await finance.replaceActivity(root,{kind:"income",amountMinor:"12000",destinationAssetId:source,occurredAt:new Date().toISOString()},randomUUID());
      await drain();assert.equal((await instance(rule,root)).status,"review_required");
      assert.equal((await admin.query("SELECT status FROM financial_activities WHERE id=$1",[result])).rows[0].status,"posted");
      await finance.voidActivity(replacement,randomUUID());await drain();
      assert.equal((await admin.query("SELECT status FROM financial_activities WHERE id=$1",[result])).rows[0].status,"posted");
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("transfer uses source Income asset, configured destination and P3 fee",async()=>{
      const rule=await events.saveIncomeEventRule({title:"Transfer percentage",percentageBps:250,outputKind:"transfer",destinationAssetId:targetAsset,transferFeeMinor:"20"});
      const root=await income("10000");await drain();const row=await instance(rule,root);
      assert.equal(row.source_asset_id,source);assert.equal(row.proposed_amount_minor,"250");
      const result=await events.postIncomeEvent(row.id);
      const activity=(await admin.query("SELECT kind,source_asset_id,destination_asset_id FROM financial_activities WHERE id=$1",[result])).rows[0];
      assert.equal(activity.kind,"transfer");assert.equal(activity.source_asset_id,source);assert.equal(activity.destination_asset_id,targetAsset);
      const movements=(await admin.query("SELECT component,amount_minor::text FROM ledger_movements WHERE activity_id=$1",[result])).rows;
      assert.equal(movements.filter((item)=>item.component==="principal").reduce((n,item)=>n+BigInt(item.amount_minor),0n),0n);
      assert.equal(movements.filter((item)=>item.component==="charge").reduce((n,item)=>n+BigInt(item.amount_minor),0n),-20n);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("a transfer candidate cannot send money to its Income source asset",async()=>{
      const rule=await events.saveIncomeEventRule({title:"Same-asset guard",percentageBps:1000,outputKind:"transfer",destinationAssetId:source});
      const root=await income("10000");await drain();const row=await instance(rule,root);
      assert.equal(row.status,"failed");assert.equal(row.proposed_amount_minor,null);
      await assert.rejects(events.postIncomeEvent(row.id));
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[row.id])).rows[0].n,0);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("expense charge template uses P3 and referenced catalogs remain protected",async()=>{
      const category=await catalogs.insertCustomCategory("Event expense category","expense");
      const charge=await catalogs.insertCustomCatalogItem("chargeTypes","Event expense charge");
      const rule=await events.saveIncomeEventRule({title:"Expense with charge",percentageBps:1000,outputKind:"expense",
        categoryId:category.id,charges:[{typeId:charge.id,amountMinor:"25"}]});
      const root=await income("10000");await drain();const row=await instance(rule,root);
      const result=await events.postIncomeEvent(row.id);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM activity_charges WHERE activity_id=$1 AND charge_type_id=$2",[result,charge.id])).rows[0].n,1);
      assert.equal((await admin.query("SELECT amount_minor::text FROM ledger_movements WHERE activity_id=$1 AND component='charge'",[result])).rows[0].amount_minor,"-25");
      await catalogs.archiveCustomCatalogItem("transactionCategories",category.id);
      await catalogs.archiveCustomCatalogItem("chargeTypes",charge.id);
      assert.equal((await catalogs.listCatalog("transactionCategories",true)).find((item)=>item.id===category.id).canDelete,false);
      assert.equal((await catalogs.listCatalog("chargeTypes",true)).find((item)=>item.id===charge.id).canDelete,false);
      await assert.rejects(catalogs.deleteCustomCatalogItem("transactionCategories",category.id));
      await assert.rejects(catalogs.deleteCustomCatalogItem("chargeTypes",charge.id));
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("failed P3 posting retries with the same instance identity",async()=>{
      const rule=await events.saveIncomeEventRule({title:"Retry destination",percentageBps:1000,outputKind:"transfer",destinationAssetId:targetAsset});
      const root=await income("10000");await drain();const row=await instance(rule,root);
      await assets.archiveAsset(targetAsset);
      await assert.rejects(events.postIncomeEvent(row.id));
      assert.equal((await instance(rule,root)).status,"failed");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[row.id])).rows[0].n,0);
      await assets.restoreAsset(targetAsset);
      const result=await events.postIncomeEvent(row.id);
      assert.equal(result,await events.postIncomeEvent(row.id));
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[row.id])).rows[0].n,1);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("zero minor result is blocked without a zero-value P3 activity",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Tiny percentage",1));
      const root=await income("1");await drain();const row=await instance(rule,root);
      assert.equal(row.status,"failed");assert.equal(row.proposed_amount_minor,null);
      await assert.rejects(events.postIncomeEvent(row.id));
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[row.id])).rows[0].n,0);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
    await t.test("P5.1A posted Income triggers P5.1B and output does not recurse",async()=>{
      const rule=await events.saveIncomeEventRule(expenseRule("Recurring Income trigger"));
      const yesterday=(await import("../src/lib/automation/schedule.ts")).addDays(new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),-1);
      const recurringRule=await recurring.saveRule({title:"Scheduled salary",kind:"income",amountMode:"fixed",amountMinor:"4000",
        executionMode:"auto_post",destinationAssetId:source,frequency:"daily",localTime:"23:59",startOn:yesterday,endOn:yesterday,charges:[]});
      await recurring.reconcileAutomation();
      const root=(await admin.query("SELECT activity_id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='posted'",[recurringRule])).rows[0].activity_id;
      await drain();const row=await instance(rule,root);assert.ok(row);assert.equal(row.proposed_amount_minor,"400");
      const instanceCount=(await admin.query("SELECT count(*)::int AS n FROM income_event_instances")).rows[0].n;
      const sourceCount=(await admin.query("SELECT count(*)::int AS n FROM income_automation_sources")).rows[0].n;
      const resultId=await events.postIncomeEvent(row.id);
      const posted=await instance(rule,root);
      assert.ok(posted.result_activity_id);assert.equal(posted.result_activity_id,resultId);assert.equal(posted.status,"posted");
      const result=(await admin.query("SELECT id,kind,status FROM financial_activities WHERE id=$1",[posted.result_activity_id])).rows[0];
      assert.deepEqual(result,{id:resultId,kind:"expense",status:"posted"});
      const provenance=(await finance.listActivities()).find((item)=>item.id===resultId);
      assert.equal(provenance.eventInstanceId,row.id);assert.equal(provenance.eventSourceIncomeId,root);
      assert.equal(provenance.recurringRuleName,"Recurring Income trigger");
      const activityCount=(await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n;
      for(let replay=0;replay<2;replay++){
        await drain();
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_automation_sources WHERE root_activity_id=$1",[resultId])).rows[0].n,0);
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances WHERE root_activity_id=$1 OR effective_activity_id=$1",[resultId])).rows[0].n,0);
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances")).rows[0].n,instanceCount);
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_automation_sources")).rows[0].n,sourceCount);
        assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n,activityCount);
      }
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM income_event_instances WHERE rule_id=$1 AND root_activity_id=$2",[rule,root])).rows[0].n,1);
      await events.setIncomeEventRuleStatus(rule,"archived");
    });
  } finally {
    hooks?.deregister();if(pool)await pool.end();await admin.query("RESET search_path");
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();
  }
});
