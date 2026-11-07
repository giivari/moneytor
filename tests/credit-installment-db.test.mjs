// (d) An installment purchase books the whole purchase: full principal as expense plus total interest as a
// charge, all on the credit account's ledger, with one installment row per month. Isolated PostgreSQL 16 only:
//   docker run --rm -d --name moneytor-credit-verify -p 127.0.0.1:55434:5432 -e POSTGRES_DB=moneytor_credit_verify \
//     -e POSTGRES_USER=moneytor_credit_verify -e POSTGRES_PASSWORD=<random> postgres:16-alpine
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<random>@127.0.0.1:55434/moneytor_credit_verify npm run test:credit:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_CREDIT_DB_TEST === "moneytor_credit_verify";
test("(d) pembelian cicilan 12x membukukan seluruh pokok dan bunga (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_CREDIT_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_CREDIT_DB_TEST);
  const schema = `credit_test_${randomUUID().replaceAll("-", "")}`;
  let pool;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    await admin.query("CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL)");
    const files = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort();
    const migrations = await Promise.all(files.map(async (file) => ({ file, sql: await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8") })));
    const notices = [];
    admin.on("notice", (notice) => notices.push(notice.message));
    const apply = async (list) => { for (const { file, sql } of list) {
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = await admin.query("SELECT checksum FROM schema_migrations WHERE name=$1", [file]);
      if (prior.rowCount) { assert.equal(prior.rows[0].checksum, checksum); continue; }
      await admin.query(sql); await admin.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [file, checksum]);
    } };
    // Existing data before 015, to check its asset_class backfill.
    await apply(migrations.filter(({ file }) => file < "015"));
    const bank = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const legacy = {};
    for (const [key, name, opening, note] of [["tagged", "Kartu Utama", 0, "[CREDIT:due=1,cutoff=20] lama"], ["kredivo", "Kredivo", 0, null],
      ["kreditZero", "Kartu Kredit Baru", 0, null], ["mahasiswa", "Dana Kredit Mahasiswa", 500000, null], ["motor", "Dana Cicilan Motor", 0, null],
      ["budi", "Piutang Pinjaman ke Budi", 300000, null], ["bank", "Rekening Utama", 100000, null]]) {
      legacy[key] = randomUUID();
      await admin.query("INSERT INTO assets (id,display_name,asset_type_id,currency_code,normally_liquid,normally_spendable,note) VALUES ($1,$2,$3,'IDR',false,false,$4)", [legacy[key], name, bank, note]);
      await admin.query("INSERT INTO asset_opening_states (asset_id,amount_minor,effective_at) VALUES ($1,$2,now())", [legacy[key], opening]);
    }
    for (const key of ["kredivo", "motor"]) { // Kredivo owes 75.000; the motor fund saved 50.000.
      const activity = randomUUID(), outflow = key === "kredivo";
      await admin.query(`INSERT INTO financial_activities (id,kind,base_amount_minor,currency_code,source_asset_id,destination_asset_id,occurred_at)
        VALUES ($1,$2,$3,'IDR',$4,$5,now())`, [activity, outflow ? "expense" : "income", outflow ? 75000 : 50000, outflow ? legacy[key] : null, outflow ? null : legacy[key]]);
      await admin.query("INSERT INTO ledger_movements (id,activity_id,asset_id,currency_code,component,amount_minor) VALUES ($1,$2,$3,'IDR','principal',$4)",
        [randomUUID(), activity, legacy[key], outflow ? -75000 : 50000]);
    }
    for (let pass = 0; pass < 2; pass++) await apply(migrations);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, files.length);

    await t.test("015 menandai liability hanya dari tag [CREDIT] atau nama kredit bersaldo negatif dengan movement", async () => {
      const classOf = async (key) => (await admin.query("SELECT asset_class FROM assets WHERE id=$1", [legacy[key]])).rows[0].asset_class;
      assert.equal(await classOf("tagged"), "liability");
      assert.equal(await classOf("kredivo"), "liability");
      assert.equal(await classOf("kreditZero"), "asset");
      assert.equal(await classOf("mahasiswa"), "asset");
      assert.equal(await classOf("motor"), "asset");
      assert.equal(await classOf("budi"), "receivable");
      assert.equal(await classOf("bank"), "asset");
      const reported = notices.filter((message) => message.startsWith("asset_class "));
      assert.equal(reported.length, Object.keys(legacy).length);
      assert.ok(reported.some((message) => message.includes(legacy.kredivo) && message.includes("-> liability") && message.includes("saldo -75000")));
    });

    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__creditTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { listActivities, postActivity, replaceActivity, voidActivity } = await import("../src/lib/finance/service.ts");
    const { calculateCreditInstallmentPlan, computeCreditBills, encodeCreditNote } = await import("../src/lib/domain/credit.ts");
    const { installmentPurchaseRequest } = await import("../src/lib/domain/credit-purchase.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__creditTestAuthorized = true;

    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const interestTypeId = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='installment_interest'")).rows[0]?.id;
    const creditId = await insertAssetWithOpening({
      displayName: "Kartu Utama", currency: "IDR", assetTypeId: typeId, normallyLiquid: false, normallySpendable: false,
      openingAmountMinor: 0n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "liability",
      note: encodeCreditNote("", true, { dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] }),
    });
    const creditAsset = async () => (await listAssets()).find((item) => item.id === creditId);

    // 1.200.000 over 12 months at 2,95%/month: 100.000 principal + 35.400 interest each month.
    const plan = calculateCreditInstallmentPlan({ principalMinorStr: "1200000", tenorMonths: 12, interestMode: "percent", interestRatePercent: 2.95, interestFlatMinorStr: "0" });
    const request = installmentPurchaseRequest(plan, 12, interestTypeId);
    const activityId = await postActivity({
      kind: "expense", amountMinor: request.amountMinor, sourceAssetId: creditId, charges: request.charges,
      occurredAt: new Date().toISOString(), note: "Pembelian sintetis",
    }, randomUUID(), { creditCycle: "current", creditInstallments: request.creditInstallments });

    await t.test("expense dan charge = seluruh pokok + seluruh bunga", async () => {
      const expense = (await admin.query(`SELECT (f.base_amount_minor + COALESCE((SELECT sum(amount_minor) FROM activity_charges WHERE activity_id=f.id),0))::text AS total,
        f.base_amount_minor::text AS base FROM financial_activities f WHERE f.id=$1`, [activityId])).rows[0];
      assert.equal(expense.total, "1624800");
      assert.equal(expense.base, "1200000");
    });
    await t.test("ledger akun kredit memuat seluruh pembelian", async () => {
      const ledger = (await admin.query("SELECT sum(amount_minor)::text AS total FROM ledger_movements WHERE activity_id=$1 AND asset_id=$2", [activityId, creditId])).rows[0];
      assert.equal(ledger.total, "-1624800");
      assert.equal(computeCreditBills(await creditAsset()).totalUnpaidMinor, 1624800n);
    });
    await t.test("12 baris jadwal cicilan dengan pokok dan bunga per bulan", async () => {
      const rows = (await admin.query(`SELECT count(*)::int AS n, sum(principal_minor)::text AS principal, sum(interest_minor)::text AS interest,
        count(DISTINCT due_period)::int AS months, bool_and(status='scheduled') AS scheduled FROM credit_installments WHERE activity_id=$1`, [activityId])).rows[0];
      assert.deepEqual(rows, { n: 12, principal: "1200000", interest: "424800", months: 12, scheduled: true });
    });
    await t.test("void membatalkan jadwal dan menghapus utang", async () => {
      await voidActivity(activityId, randomUUID());
      const open = (await admin.query("SELECT count(*)::int AS n FROM credit_installments WHERE activity_id=$1 AND status<>'cancelled'", [activityId])).rows[0];
      assert.equal(open.n, 0);
      const asset = await creditAsset();
      assert.equal(asset.balanceMinor, "0");
      assert.equal(computeCreditBills(asset).totalUnpaidMinor, 0n);
    });
    await t.test("replace dengan pokok/tenor baru: jadwal lama batal, jadwal baru dari request pengganti", async () => {
      const buy = async (principal, tenor, id) => {
        const p = calculateCreditInstallmentPlan({ principalMinorStr: String(principal), tenorMonths: tenor, interestMode: "percent", interestRatePercent: 2.95, interestFlatMinorStr: "0" });
        const r = installmentPurchaseRequest(p, tenor, interestTypeId);
        const draft = { kind: "expense", amountMinor: r.amountMinor, sourceAssetId: creditId, charges: r.charges, occurredAt: new Date().toISOString(), note: "Pembelian sintetis" };
        const options = { creditCycle: "current", creditInstallments: r.creditInstallments };
        return id ? replaceActivity(id, draft, randomUUID(), options) : postActivity(draft, randomUUID(), options);
      };
      const original = await buy(1200000, 12);
      const replacement = await buy(900000, 6, original); // 900.000 + 6 x 26.550 bunga = 1.059.300
      const old = (await admin.query(`SELECT count(*)::int AS n, bool_and(status='cancelled' AND cancelled_by_activity_id=$2) AS cancelled
        FROM credit_installments WHERE activity_id=$1`, [original, replacement])).rows[0];
      assert.deepEqual(old, { n: 12, cancelled: true });
      const fresh = (await admin.query(`SELECT count(*)::int AS n, sum(principal_minor)::text AS principal, sum(interest_minor)::text AS interest,
        bool_and(status='scheduled') AS scheduled FROM credit_installments WHERE activity_id=$1`, [replacement])).rows[0];
      assert.deepEqual(fresh, { n: 6, principal: "900000", interest: "159300", scheduled: true });
      const asset = await creditAsset();
      assert.equal(asset.balanceMinor, "-1059300");
      const bills = computeCreditBills(asset);
      assert.equal(bills.totalUnpaidMinor, 1059300n);
      assert.equal(bills.currentBillMinor + bills.nextBillMinor + bills.laterBillMinor, 1059300n);
      // The editor restores a correction from these: tenor, base principal, monthly interest, and the interest charge kind.
      const listed = (await listActivities()).find((item) => item.id === replacement);
      assert.deepEqual(listed.creditInstallments, { count: 6, principalMinor: "150000", interestMinor: "26550" });
      assert.deepEqual(listed.charges.map((charge) => [charge.systemKey, charge.amountMinor]), [["installment_interest", "159300"]]);
    });
    await t.test("top-up cicilan: ledger memuat pokok + seluruh bunga, jadwal di tabel, void dan koreksi menjadwal ulang", async () => {
      const { installmentTopUpRequest } = await import("../src/lib/domain/credit-purchase.ts");
      const { parseCreditMeta } = await import("../src/lib/domain/credit.ts");
      const topUpCard = await insertAssetWithOpening({
        displayName: "PayLater Top-up", currency: "IDR", assetTypeId: typeId, normallyLiquid: false, normallySpendable: false,
        openingAmountMinor: 0n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "liability",
        note: encodeCreditNote("", true, { dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] }),
      });
      const wallet = await insertAssetWithOpening({
        displayName: "Dompet Digital", currency: "IDR", assetTypeId: typeId, normallyLiquid: true, normallySpendable: true,
        openingAmountMinor: 0n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "asset", note: null,
      });
      const card = async () => (await listAssets()).find((item) => item.id === topUpCard);
      const topUp = async (principal, tenor, id) => {
        const p = calculateCreditInstallmentPlan({ principalMinorStr: String(principal), tenorMonths: tenor, interestMode: "percent", interestRatePercent: 2.95, interestFlatMinorStr: "0" });
        const r = installmentTopUpRequest(p, tenor);
        const draft = { kind: "transfer", amountMinor: String(principal), sourceAssetId: topUpCard, destinationAssetId: wallet, transferFeeMinor: r.transferFeeMinor,
          occurredAt: new Date().toISOString(), note: "Top-up sintetis" };
        const options = { creditCycle: "current", creditInstallments: r.creditInstallments ?? undefined };
        return id ? replaceActivity(id, draft, randomUUID(), options) : postActivity(draft, randomUUID(), options);
      };
      const id = await topUp(900000, 3); // 3 x (300.000 pokok + 26.550 bunga)
      const ledger = async (assetId, activity) => (await admin.query("SELECT COALESCE(sum(amount_minor),0)::text AS total FROM ledger_movements WHERE activity_id=$1 AND asset_id=$2 AND component <> 'reversal'", [activity, assetId])).rows[0].total;
      assert.equal(await ledger(topUpCard, id), "-979650");
      assert.equal(await ledger(wallet, id), "900000");
      const rows = (await admin.query(`SELECT count(*)::int AS n, sum(principal_minor)::text AS principal, sum(interest_minor)::text AS interest,
        count(DISTINCT due_period)::int AS months, bool_and(status='scheduled') AS scheduled FROM credit_installments WHERE activity_id=$1`, [id])).rows[0];
      assert.deepEqual(rows, { n: 3, principal: "900000", interest: "79650", months: 3, scheduled: true });
      const asset = await card();
      assert.equal(parseCreditMeta(asset.note).schedule.length, 0, "the credit note carries no schedule for a new top-up");
      const bills = computeCreditBills(asset);
      assert.equal(bills.totalUnpaidMinor, 979650n);
      assert.equal(bills.currentBillMinor + bills.nextBillMinor + bills.laterBillMinor, 979650n);
      const listed = (await listActivities()).find((item) => item.id === id);
      assert.deepEqual(listed.creditInstallments, { count: 3, principalMinor: "300000", interestMinor: "26550" });
      assert.deepEqual(listed.charges.map((charge) => [charge.systemKey, charge.amountMinor]), [["transfer_fee", "79650"]]);

      const replacement = await topUp(600000, 2, id); // 2 x (300.000 + 17.700)
      const old = (await admin.query("SELECT count(*)::int AS n, bool_and(status='cancelled' AND cancelled_by_activity_id=$2) AS cancelled FROM credit_installments WHERE activity_id=$1", [id, replacement])).rows[0];
      assert.deepEqual(old, { n: 3, cancelled: true });
      assert.equal((await card()).balanceMinor, "-635400");
      assert.equal(computeCreditBills(await card()).totalUnpaidMinor, 635400n);

      await voidActivity(replacement, randomUUID());
      const open = (await admin.query("SELECT count(*)::int AS n FROM credit_installments WHERE activity_id=$1 AND status<>'cancelled'", [replacement])).rows[0];
      assert.equal(open.n, 0);
      assert.equal((await card()).balanceMinor, "0");
      assert.equal(computeCreditBills(await card()).totalUnpaidMinor, 0n);
    });
    hooks.deregister();
  } finally {
    globalThis.__creditTestAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
