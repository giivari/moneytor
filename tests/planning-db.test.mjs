import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = ["moneytor_p5_verify","moneytor_p51a_verify","moneytor_p51b_verify"].includes(process.env.MONEYTOR_P5_DB_TEST) || /^moneytor_composable_verify_\d+$/.test(process.env.MONEYTOR_P5_DB_TEST ?? "");
test("P5 planning and Home on a disposable PostgreSQL database", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname,"127.0.0.1"); assert.equal(target.port,"55433"); assert.equal(target.pathname,`/${process.env.MONEYTOR_P5_DB_TEST}`);
  const schema = `p5_test_${randomUUID().replaceAll("-","")}`;
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect(); let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
    await admin.query("CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)");
    const migrations = await Promise.all((await readdir(new URL("../db/migrations/",import.meta.url))).filter((item) => item.endsWith(".sql")).sort()
      .map(async (file) => ({ file,sql: await readFile(new URL(`../db/migrations/${file}`,import.meta.url),"utf8") })));
    assert.equal(migrations.at(-1).file,"013_home_customization.sql");
    for (let pass=0;pass<2;pass++) for (const { file,sql } of migrations) {
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = await admin.query("SELECT checksum FROM schema_migrations WHERE name=$1",[file]);
      if (previous.rowCount) { assert.equal(previous.rows[0].checksum,checksum); continue; }
      await admin.query(sql); await admin.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",[file,checksum]);
    }
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n,13);
    assert.deepEqual((await admin.query("SELECT count(*)::int AS n FROM planning_budgets")).rows[0].n,0);
    assert.deepEqual((await admin.query("SELECT count(*)::int AS n FROM planning_goals")).rows[0].n,0);
    assert.deepEqual((await admin.query("SELECT count(*)::int AS n FROM planning_reserves")).rows[0].n,0);
    assert.deepEqual((await admin.query("SELECT count(*)::int AS n FROM planning_obligations")).rows[0].n,0);
    target.searchParams.set("options",`-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    const hooks = registerHooks({ resolve(specifier,context,next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__planningTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}",shortCircuit:true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`,import.meta.url).href,context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`,context.parentURL).href,context);
      return next(specifier,context);
    } });
    const planning = await import("../src/lib/planning/repository.ts");
    const { planningPosition,horizonDay } = await import("../src/lib/domain/planning.ts");
    const { insertAssetWithOpening } = await import("../src/lib/repositories/assets.ts");
    const { postActivity,replaceActivity,voidActivity } = await import("../src/lib/finance/service.ts");
    const catalogs = await import("../src/lib/repositories/catalogs.ts");
    const { financeSnapshot } = await import("../src/lib/finance/summary.ts");
    const { database } = await import("../src/lib/db/pool.ts"); pool = database();
    const mutate = (action,body,key=randomUUID()) => planning.mutatePlanning(action,body,key);
    await assert.rejects(planning.listPlanning(),/Unauthorized/);
    await assert.rejects(mutate("save-goal",{},randomUUID()),/Unauthorized/);
    globalThis.__planningTestAuthorized = true;
    const assetType = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const makeAsset = (name,currency,opening,liquid=true,spendable=true) => insertAssetWithOpening({
      displayName:name,currency,assetTypeId:assetType,normallyLiquid:liquid,normallySpendable:spendable,
      openingAmountMinor:BigInt(opening),openingEffectiveAt:new Date("2026-10-01T00:00:00Z") });
    const cash = await makeAsset("Disposable IDR cash","IDR","10000000");
    const inactiveSource = await makeAsset("Disposable restricted","IDR","1000000",false,false);
    const usd = await makeAsset("Disposable USD cash","USD","50000");
    const labels = (await planning.listPlanning()).labels;
    const label = (kind) => labels.find((row) => row.kind === kind).id;
    const common = (kind,title,currency="IDR") => ({ labelId:label(kind),title,currency });
    const now = new Intl.DateTimeFormat("en-US",{ timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit" }).formatToParts(new Date());
    const today = `${now.find((p)=>p.type==="year").value}-${now.find((p)=>p.type==="month").value}-${now.find((p)=>p.type==="day").value}`;
    const monthStart = `${today.slice(0,7)}-01`, periodEnd = horizonDay(monthStart,30);
    const occurredAt = new Date(`${monthStart}T12:00:00+07:00`).toISOString();
    const category = (await admin.query("SELECT id FROM transaction_categories WHERE applies_to='expense' LIMIT 1")).rows[0].id;
    const incomeCategory = (await admin.query("SELECT id FROM transaction_categories WHERE applies_to='income' LIMIT 1")).rows[0].id;
    const feeType = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='admin_fee'")).rows[0].id;
    const get = async () => planning.listPlanning();
    const snapshot = async () => (await financeSnapshot({ includeRecent:false,includeExpenses:false })).currencies.find((row)=>row.currency==="IDR");

    await t.test("budget: category, charges, replacement, void, transfer fee, no spendable effect",async () => {
      const global = await mutate("save-budget",{ ...common("budget","All spending"),limitMinor:"1000000",periodStart:monthStart,periodEnd });
      const scoped = await mutate("save-budget",{ ...common("budget","Food"),limitMinor:"1000000",periodStart:monthStart,periodEnd,categoryId:category });
      await assert.rejects(mutate("save-budget",{ ...common("budget","Wrong category"),limitMinor:"1",periodStart:monthStart,periodEnd,categoryId:incomeCategory }),/Kategori/);
      assert.equal((await snapshot()).spendableMinor,"10000000");
      const draft = (amountMinor) => ({ kind:"expense",amountMinor,sourceAssetId:cash,categoryId:category,
        charges:[{ typeId:feeType,amountMinor:"20000" }],occurredAt,note:"Disposable P5 food" });
      const activity = await postActivity(draft("300000"),randomUUID());
      assert.equal((await get()).budgets.find((row)=>row.id===global).spentMinor,"320000");
      assert.equal((await get()).budgets.find((row)=>row.id===scoped).spentMinor,"320000");
      const replacement = await replaceActivity(activity,draft("400000"),randomUUID());
      assert.equal((await get()).budgets.find((row)=>row.id===scoped).spentMinor,"420000");
      await voidActivity(replacement,randomUUID());
      assert.equal((await get()).budgets.find((row)=>row.id===scoped).spentMinor,"0");
      const destination = await makeAsset("Disposable destination","IDR","0");
      const transfer = await postActivity({ kind:"transfer",amountMinor:"500000",sourceAssetId:cash,destinationAssetId:destination,
        transferFeeMinor:"2500",occurredAt },randomUUID());
      assert.equal((await get()).budgets.find((row)=>row.id===global).spentMinor,"2500");
      assert.equal((await get()).budgets.find((row)=>row.id===scoped).spentMinor,"0");
      await voidActivity(transfer,randomUUID());
      const row = (await get()).budgets.find((item)=>item.id===global);
      await mutate("archive",{kind:"budget",id:global,version:row.version});
      await mutate("restore",{kind:"budget",id:global,version:row.version+1});
      assert.equal((await get()).budgets.find((item)=>item.id===global).id,global);
    });

    await t.test("budget reference protects a custom category from hard deletion",async () => {
      const custom = await catalogs.insertCustomCategory("Disposable P5 category","expense");
      await mutate("save-budget",{ ...common("budget","Category reference"),limitMinor:"1000",
        periodStart:monthStart,periodEnd,categoryId:custom.id });
      await catalogs.archiveCustomCatalogItem("transactionCategories",custom.id);
      const archived = (await catalogs.listCatalog("transactionCategories",true)).find((row)=>row.id===custom.id);
      assert.equal(archived.canDelete,false);
      await assert.rejects(catalogs.deleteCustomCatalogItem("transactionCategories",custom.id),/referensi|riwayat/);
    });

    await t.test("goal has zero progress until active linked reserve; reserve never posts ledger",async () => {
      const goal = await mutate("save-goal",{ ...common("goal","Laptop"),targetMinor:"15000000",targetOn:horizonDay(today,90) });
      assert.equal((await get()).goals.find((row)=>row.id===goal).progressMinor,"0");
      assert.equal((await snapshot()).spendableMinor,"10000000");
      const before = (await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n;
      const linked = await mutate("save-reserve",{ ...common("reserve","Laptop savings"),amountMinor:"4000000",purpose:"goal",goalId:goal });
      assert.equal((await get()).goals.find((row)=>row.id===goal).progressMinor,"4000000");
      assert.equal((await snapshot()).spendableMinor,"6000000");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n,before);
      const reserve = (await get()).reserves.find((row)=>row.id===linked);
      await mutate("archive",{ kind:"reserve",id:linked,version:reserve.version });
      assert.equal((await get()).goals.find((row)=>row.id===goal).progressMinor,"0");
      assert.equal((await snapshot()).spendableMinor,"10000000");
      await mutate("restore",{ kind:"reserve",id:linked,version:reserve.version+1 });
      assert.equal((await get()).goals.find((row)=>row.id===goal).progressMinor,"4000000");
      // Leave this reserve released for independent coverage cases.
      await mutate("archive",{ kind:"reserve",id:linked,version:reserve.version+2 });
    });

    await t.test("linked coverage avoids double count; excess reserve persists",async () => {
      const bill = await mutate("save-obligation",{ ...common("obligation","Electricity"),amountMinor:"1500000",dueOn:horizonDay(today,5) });
      const emergency = await mutate("save-reserve",{ ...common("reserve","Emergency"),amountMinor:"2000000",purpose:"emergency" });
      const coverage = await mutate("save-reserve",{ ...common("reserve","Electricity reserved"),amountMinor:"1000000",purpose:"obligation",obligationId:bill });
      const actual = await snapshot();
      assert.equal(actual.reservedMinor,"3000000"); assert.equal(actual.spendableMinor,"7000000");
      assert.equal(actual.dueMinor,"1500000"); assert.equal(actual.coveredMinor,"1000000");
      assert.equal(actual.uncoveredMinor,"500000"); assert.equal(actual.availableMinor,"6500000");
      const described = (await get()).obligations.find((row)=>row.id===bill);
      assert.equal(described.coveredMinor,"1000000"); assert.equal(described.uncoveredMinor,"500000");
      const reserve = (await get()).reserves.find((row)=>row.id===coverage);
      await mutate("save-reserve",{ ...common("reserve","Electricity reserved"),id:coverage,version:reserve.version,
        amountMinor:"2000000",purpose:"obligation",obligationId:bill });
      const excess = await snapshot();
      assert.equal(excess.coveredMinor,"1500000"); assert.equal(excess.uncoveredMinor,"0");
      assert.equal(excess.spendableMinor,"6000000"); assert.equal(excess.availableMinor,"6000000");
      const billRow = (await get()).obligations.find((row)=>row.id===bill);
      await mutate("settle",{ kind:"obligation",id:bill,version:billRow.version });
      assert.equal((await snapshot()).dueMinor,"0");
      await assert.rejects(mutate("save-obligation",{ ...common("obligation","Changed while settled"),id:bill,version:billRow.version+1,
        amountMinor:"1000000",dueOn:horizonDay(today,5) }),/Buka kembali/);
      await mutate("reopen",{ kind:"obligation",id:bill,version:billRow.version+1 });
      assert.equal((await snapshot()).dueMinor,"1500000");
      await mutate("cancel",{ kind:"obligation",id:bill,version:billRow.version+2 });
      assert.equal((await snapshot()).dueMinor,"0");
      await mutate("reopen",{ kind:"obligation",id:bill,version:billRow.version+3 });
      assert.equal((await snapshot()).dueMinor,"1500000");
      // Existing reserves are never silently released when an obligation resolves.
      assert.equal((await get()).reserves.find((row)=>row.id===emergency).isActive,true);
    });

    await t.test("horizon, overdue, future, negative values and currency isolation",async () => {
      const obligations = [
        ["Overdue",horizonDay(today,-1)],
        ["In five",horizonDay(today,5)],
        ["In twenty",horizonDay(today,20)],
        ["In sixty",horizonDay(today,60)],
      ];
      const ids = [];
      for (const [name,dueOn] of obligations) ids.push(await mutate("save-obligation",{ ...common("obligation",name),amountMinor:"100",dueOn }));
      const db = await pool.connect();
      try {
        const seven = await planning.readPlanningSummary(db,horizonDay(today,7));
        const thirty = await planning.readPlanningSummary(db,horizonDay(today,30));
        const ninety = await planning.readPlanningSummary(db,horizonDay(today,90));
        assert.equal(BigInt(thirty.get("IDR").dueMinor)-BigInt(seven.get("IDR").dueMinor),100n);
        assert.equal(BigInt(ninety.get("IDR").dueMinor)-BigInt(thirty.get("IDR").dueMinor),100n);
        const overdue = (await get()).obligations.find((row)=>row.id===ids[0]);
        await mutate("settle",{kind:"obligation",id:ids[0],version:overdue.version});
        assert.equal(BigInt((await planning.readPlanningSummary(db,horizonDay(today,7))).get("IDR").dueMinor),BigInt(seven.get("IDR").dueMinor)-100n);
      } finally { db.release(); }
      const usdReserve = await mutate("save-reserve",{ ...common("reserve","USD restricted","USD"),amountMinor:"10000",purpose:"restricted",sourceAssetId:usd });
      assert.equal((await financeSnapshot({ includeRecent:false,includeExpenses:false })).currencies.find((row)=>row.currency==="USD").spendableMinor,"40000");
      assert.equal((await snapshot()).reservedMinor,"4000000");
      await assert.rejects(mutate("save-reserve",{ ...common("reserve","Wrong currency"),amountMinor:"10",purpose:"general",sourceAssetId:usd }),/mata uang/);
      await assert.rejects(mutate("save-reserve",{ ...common("reserve","Not liquid"),amountMinor:"10",purpose:"general",sourceAssetId:inactiveSource }),/aset aktif/);
      const large = await mutate("save-reserve",{ ...common("reserve","Overallocated"),amountMinor:"10000000",purpose:"restricted" });
      assert.equal(BigInt((await snapshot()).spendableMinor)<0n,true);
      assert.equal(BigInt((await snapshot()).availableMinor)<0n,true);
      const largeRow = (await get()).reserves.find((row)=>row.id===large);
      await mutate("archive",{ kind:"reserve",id:large,version:largeRow.version });
      assert.equal((await get()).reserves.find((row)=>row.id===usdReserve).currency,"USD");
      assert.equal(planningPosition("10000000","IDR",[{currency:"IDR",amountMinor:"2000000",isActive:true}],
        [{id:"test",currency:"IDR",amountMinor:"1500000",dueOn:horizonDay(today,5),status:"open"}],horizonDay(today,30)).availableMinor,"6500000");
    });

    await t.test("idempotency, invalid reference rollback and stale concurrent edit",async () => {
      const body = { ...common("goal","Concurrent"),targetMinor:"1000000" }, key = randomUUID();
      const id = await mutate("save-goal",body,key);
      assert.equal(await mutate("save-goal",body,key),id);
      await assert.rejects(mutate("save-goal",{ ...body,targetMinor:"2000000" },key),/Kunci permintaan/);
      const count = (await admin.query("SELECT count(*)::int AS n FROM planning_goals")).rows[0].n;
      await assert.rejects(mutate("save-reserve",{ ...common("reserve","Invalid link"),amountMinor:"100",purpose:"goal",goalId:randomUUID() }),/Target aktif/);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM planning_goals")).rows[0].n,count);
      const current = (await get()).goals.find((row)=>row.id===id);
      const one = mutate("save-goal",{ ...body,id,version:current.version,targetMinor:"1500000" });
      const two = mutate("save-goal",{ ...body,id,version:current.version,targetMinor:"1750000" });
      const outcomes = await Promise.allSettled([one,two]);
      assert.equal(outcomes.filter((row)=>row.status==="fulfilled").length,1);
      assert.equal(outcomes.filter((row)=>row.status==="rejected").length,1);
      assert.equal((await get()).goals.find((row)=>row.id===id).version,current.version+1);
      await assert.rejects(admin.query("DELETE FROM planning_goals WHERE id=$1",[id]),/cannot be deleted/);
    });

    await t.test("Home and Planning summary agree at thirty days",async () => {
      const home = await snapshot();
      const connection = await pool.connect();
      try {
        const plans = await planning.readPlanningSummary(connection,horizonDay(today,30));
        const totals = plans.get("IDR");
        assert.equal(home.reservedMinor,totals.reservedMinor);
        assert.equal(home.uncoveredMinor,totals.uncoveredMinor);
        assert.equal(home.availableMinor,(BigInt(home.eligibleMinor)-BigInt(totals.reservedMinor)-BigInt(totals.uncoveredMinor)).toString());
      } finally { connection.release(); }
    });
    hooks.deregister();
  } finally {
    if (pool) await pool.end();
    await admin.query("SET search_path TO public"); await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end(); delete globalThis.__planningTestAuthorized;
  }
});
