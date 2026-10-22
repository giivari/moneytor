import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = ["moneytor_p51a_verify","moneytor_p51b_verify"].includes(process.env.MONEYTOR_AUTOMATION_DB_TEST) || /^moneytor_composable_verify_\d+$/.test(process.env.MONEYTOR_AUTOMATION_DB_TEST ?? "");
test("P5.1A recurring transactions on isolated PostgreSQL schema",{skip:!enabled},async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname,"127.0.0.1"); assert.equal(target.port,"55433"); assert.equal(target.pathname,`/${process.env.MONEYTOR_AUTOMATION_DB_TEST}`);
  const admin = new pg.Client({connectionString:target.toString()});
  await admin.connect();
  const schema = `p51a_test_${randomUUID().replaceAll("-","")}`;
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query("CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)");
    const migrations = await Promise.all((await readdir(new URL("../db/migrations/",import.meta.url))).filter((file)=>file.endsWith(".sql")).sort()
      .map(async (file)=>({file,sql:await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8")})));
    assert.equal(migrations.at(-1).file,"013_home_customization.sql");
    for (let pass=0;pass<2;pass++) for (const {file,sql} of migrations) {
      const checksum=createHash("sha256").update(sql).digest("hex");
      const prior=await admin.query("SELECT checksum FROM schema_migrations WHERE name=$1",[file]);
      if (prior.rowCount) { assert.equal(prior.rows[0].checksum,checksum); continue; }
      await admin.query(sql); await admin.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",[file,checksum]);
    }
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n,13);
    assert.ok((await admin.query("SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE 'recurring_%'",[schema])).rows[0].n>=3);
    assert.ok((await admin.query("SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace=$1::regnamespace AND contype='f' AND conrelid::regclass::text LIKE 'recurring_%'",[schema])).rows[0].n>=6);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM recurring_mutation_requests")).rows[0].n,0);
    target.searchParams.set("options",`-c search_path=${schema}`); process.env.DATABASE_URL=target.toString();
    const hooks=registerHooks({resolve(specifier,context,next) {
      if (specifier==="@/lib/auth/session") return {url:"data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__automationTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}",shortCircuit:true};
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`,context.parentURL).href,context);
      return next(specifier,context);
    }});
    const automation=await import("../src/lib/automation/service.ts");
    const { insertAssetWithOpening,listAssets }=await import("../src/lib/repositories/assets.ts");
    const catalogs=await import("../src/lib/repositories/catalogs.ts");
    const { replaceActivity,voidActivity }=await import("../src/lib/finance/service.ts");
    const { database }=await import("../src/lib/db/pool.ts"); pool=database();
    await assert.rejects(automation.readAutomation(),/Unauthorized/);
    globalThis.__automationTestAuthorized=true;
    const type=(await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const source=await insertAssetWithOpening({displayName:"Disposable source",currency:"IDR",assetTypeId:type,normallyLiquid:true,normallySpendable:true,
      openingAmountMinor:1000000n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
    const dest=await insertAssetWithOpening({displayName:"Disposable dest",currency:"IDR",assetTypeId:type,normallyLiquid:true,normallySpendable:true,
      openingAmountMinor:0n,openingEffectiveAt:new Date("2026-01-01T00:00:00Z")});
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    const yesterday=(await import("../src/lib/automation/schedule.ts")).addDays(today,-1);
    const base={title:"Disposable recurring",kind:"expense",amountMode:"fixed",amountMinor:"1000",executionMode:"auto_post",
      sourceAssetId:source,frequency:"daily",localTime:"23:59",startOn:yesterday,charges:[]};
    await t.test("rule creation is idempotent under concurrent request retry",async()=>{
      const key=randomUUID();
      const future=(await import("../src/lib/automation/schedule.ts")).addDays(today,60);
      const draft={...base,title:"Future idempotent",startOn:future};
      const [first,second]=await Promise.all([automation.saveRule(draft,undefined,key),automation.saveRule(draft,undefined,key)]);
      assert.equal(first,second);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM recurring_transaction_rules WHERE id=$1",[first])).rows[0].n,1);
      await assert.rejects(automation.saveRule({...draft,title:"Changed"},undefined,key),/Kunci/);
    });
    await t.test("automatic posting is once-only under concurrent visits",async()=>{
      const rule=await automation.saveRule(base);
      await Promise.all([automation.reconcileAutomation(),automation.reconcileAutomation()]);
      const rows=(await admin.query("SELECT id,activity_id,status,attempted_at,posted_at FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[rule,yesterday])).rows;
      assert.equal(rows.length,1); assert.equal(rows[0].status,"posted");
      assert.ok(rows[0].attempted_at); assert.ok(rows[0].posted_at);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM finance_operations WHERE idempotency_key=$1",[rows[0].id])).rows[0].n,1);
      assert.equal((await listAssets()).find((item)=>item.id===source).balanceMinor,"999000",JSON.stringify((await admin.query("SELECT local_date,scheduled_at,status FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='posted' ORDER BY scheduled_at",[rule])).rows));
      await automation.reconcileAutomation();
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n,1);
      await voidActivity(rows[0].activity_id,randomUUID());
      await automation.reconcileAutomation();
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n,1);
      assert.equal((await automation.readAutomation()).occurrences.some((item)=>item.id===rows[0].id && item.latest_activity_status==="voided"),true);
    });
    await t.test("confirm amount, skip, correction, and void keep history",async()=>{
      const rule=await automation.saveRule({...base,title:"Variable",amountMode:"confirm_amount",amountMinor:undefined,
        executionMode:"confirm_before_post",frequency:"weekly",weekday:new Date(`${yesterday}T00:00:00Z`).getUTCDay() || 7});
      await automation.reconcileAutomation();
      const row=(await admin.query("SELECT id,status FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[rule,yesterday])).rows[0];
      assert.equal(row.status,"pending_confirmation");
      const activity=await automation.processOccurrence(row.id,"2500");
      assert.equal(await automation.processOccurrence(row.id,"2500"),activity);
      const replacement=await replaceActivity(activity,{kind:"expense",amountMinor:"3000",sourceAssetId:source,occurredAt:new Date().toISOString()},randomUUID());
      assert.equal((await automation.readAutomation()).occurrences.some((item)=>item.id===row.id && item.latest_activity_status==="posted"),true);
      await automation.voidOccurrence(row.id);
      await automation.voidOccurrence(row.id);
      assert.equal((await admin.query("SELECT status FROM financial_activities WHERE id=$1",[replacement])).rows[0].status,"voided");
      assert.equal((await admin.query("SELECT status FROM recurring_transaction_occurrences WHERE id=$1",[row.id])).rows[0].status,"voided");
      const future=(await admin.query("SELECT id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='upcoming' ORDER BY scheduled_at LIMIT 1",[rule])).rows[0];
      assert.ok(future);
      await automation.skipOccurrence(future.id);
      await automation.skipOccurrence(future.id);
      const skipped=(await admin.query("SELECT status,skipped_at FROM recurring_transaction_occurrences WHERE id=$1",[future.id])).rows[0];
      assert.equal(skipped.status,"skipped"); assert.ok(skipped.skipped_at);
    });
    await t.test("pause/edit/archive preserve posted occurrence identity",async()=>{
      const rule=(await admin.query("SELECT id FROM recurring_transaction_rules WHERE title='Disposable recurring'")).rows[0].id;
      const before=(await admin.query("SELECT id,activity_id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='posted'",[rule])).rows[0];
      await automation.setRuleStatus(rule,"paused");
      await automation.saveRule({...base,title:"Edited recurring",amountMinor:"2000"},rule);
      await automation.setRuleStatus(rule,"active");
      await automation.setRuleStatus(rule,"archived");
      await automation.setRuleStatus(rule,"active");
      const after=(await admin.query("SELECT id,activity_id FROM recurring_transaction_occurrences WHERE id=$1",[before.id])).rows[0];
      assert.deepEqual(after,before);
    });
    await t.test("income and transfer templates use the ordinary P3 ledger",async()=>{
      const income=await automation.saveRule({...base,title:"Disposable income",kind:"income",sourceAssetId:undefined,destinationAssetId:dest,amountMinor:"400"});
      const transfer=await automation.saveRule({...base,title:"Disposable transfer",kind:"transfer",destinationAssetId:dest,amountMinor:"300",transferFeeMinor:"20"});
      await automation.reconcileAutomation();
      const incomeActivity=(await admin.query("SELECT activity_id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[income,yesterday])).rows[0].activity_id;
      const transferActivity=(await admin.query("SELECT activity_id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[transfer,yesterday])).rows[0].activity_id;
      assert.equal((await admin.query("SELECT kind FROM financial_activities WHERE id=$1",[incomeActivity])).rows[0].kind,"income");
      const movements=(await admin.query("SELECT component,amount_minor::text FROM ledger_movements WHERE activity_id=$1",[transferActivity])).rows;
      assert.equal(movements.filter((row)=>row.component==="principal").reduce((sum,row)=>sum+BigInt(row.amount_minor),0n),0n);
      assert.equal(movements.filter((row)=>row.component==="charge").reduce((sum,row)=>sum+BigInt(row.amount_minor),0n),-20n);
    });
    await t.test("a referenced custom category cannot be hard-deleted",async()=>{
      const category=await catalogs.insertCustomCategory("Disposable recurring category","expense");
      await automation.saveRule({...base,title:"Category holder",categoryId:category.id,executionMode:"confirm_before_post"});
      await catalogs.archiveCustomCatalogItem("transactionCategories",category.id);
      const archived=(await catalogs.listCatalog("transactionCategories",true)).find((item)=>item.id===category.id);
      assert.equal(archived.canDelete,false);
      await assert.rejects(catalogs.deleteCustomCatalogItem("transactionCategories",category.id),/referensi|riwayat/);
    });
    await t.test("invalid references and failed posting never write partial ledger",async()=>{
      await assert.rejects(automation.saveRule({...base,sourceAssetId:randomUUID()}));
      const rule=await automation.saveRule({...base,title:"Fails after asset archive",frequency:"weekly",weekday:new Date(`${yesterday}T00:00:00Z`).getUTCDay() || 7});
      await admin.query("UPDATE assets SET is_active=false WHERE id=$1",[source]);
      const result=await automation.reconcileAutomation(); assert.equal(result.ready,true);
      const row=(await admin.query("SELECT status,activity_id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[rule,yesterday])).rows[0];
      assert.equal(row.status,"failed"); assert.equal(row.activity_id,null);
      await admin.query("UPDATE assets SET is_active=true WHERE id=$1",[source]);
      const due=(await admin.query("SELECT id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND local_date=$2",[rule,yesterday])).rows[0].id;
      assert.ok(await automation.processOccurrence(due));
    });
    hooks.deregister();
  } finally {
    if (pool) await pool.end();
    await admin.query("RESET search_path");
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
