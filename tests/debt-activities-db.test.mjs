// Jenis aktivitas borrow, repay, refund, adjustment (migrasi 017). Isolated PostgreSQL 16 only (container credit, port 55434):
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_credit_verify npm run test:debt:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_CREDIT_DB_TEST === "moneytor_credit_verify";
test("jenis aktivitas utang dan koreksi (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_CREDIT_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_CREDIT_DB_TEST);
  const schema = `debt_test_${randomUUID().replaceAll("-", "")}`;
  let pool, hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__debtTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { postActivity, voidActivity, listActivities } = await import("../src/lib/finance/service.ts");
    const { summarizeBalances, creditDebtThrough } = await import("../src/lib/domain/net-worth.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__debtTestAuthorized = true;

    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const interestType = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='loan_interest'")).rows[0]?.id;
    const categoryId = (await admin.query("SELECT id FROM transaction_categories WHERE applies_to='expense' AND is_active LIMIT 1")).rows[0].id;
    assert.ok(interestType, "seed loan_interest tersedia");
    const make = (displayName, assetClass, opening = 0n, spendable = true) => insertAssetWithOpening({ displayName, currency: "IDR", assetTypeId: typeId,
      normallyLiquid: spendable, normallySpendable: spendable, openingAmountMinor: opening, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass });
    const wallet = await make("Dompet sintetis", "asset", 1000000n);
    const loan = await make("Pinjaman Bank sintetis", "liability", 0n, false);
    const at = "2026-03-01T05:00:00.000Z";
    const balance = async (id) => (await listAssets()).find((a) => a.id === id).balanceMinor;
    const netWorth = async () => summarizeBalances(await listAssets(), [], "2099-01-01").get("IDR").netWorth;
    const count = async (sql, params = []) => (await admin.query(sql, params)).rows[0].n;

    await t.test("borrow: aset naik, liability naik, kekayaan bersih tetap, bukan sumber otomasi", async () => {
      const receipts = await count("SELECT count(*)::int AS n FROM automation_source_receipts");
      const before = await netWorth();
      const key = randomUUID(), draft = { kind: "borrow", amountMinor: "5000000", sourceAssetId: loan, destinationAssetId: wallet, occurredAt: at, note: "Cair" };
      const id = await postActivity(draft, key);
      assert.equal(await postActivity({ ...draft }, key), id); // idempoten
      assert.equal(await count("SELECT count(*)::int AS n FROM financial_activities WHERE kind='borrow'"), 1);
      assert.equal(await balance(wallet), "6000000");
      assert.equal(await balance(loan), "-5000000");
      assert.equal(await netWorth(), before);
      assert.equal(await count("SELECT count(*)::int AS n FROM automation_source_receipts"), receipts);
      assert.equal((await listActivities()).find((a) => a.id === id).kind, "borrow");
    });

    await t.test("repay: pokok mengurangi utang tanpa menjadi pengeluaran, bunga adalah biaya", async () => {
      const before = await netWorth();
      await postActivity({ kind: "repay", amountMinor: "1000000", sourceAssetId: wallet, destinationAssetId: loan,
        charges: [{ typeId: interestType, amountMinor: "50000" }], occurredAt: at }, randomUUID());
      assert.equal(await balance(wallet), String(6000000 - 1050000));
      assert.equal(await balance(loan), "-4000000");
      assert.equal(await netWorth(), before - 50000n);
      assert.equal((await monthlyExpensesFor()).total, "50000"); // hanya bunga; pokok bukan pengeluaran
    });

    async function monthlyExpensesFor() {
      // Query bulan berjalan memakai waktu sekarang; transaksi uji bertanggal 2026-03, jadi totalnya dihitung dengan SQL setara readMonthlyExpenses.
      const rows = (await admin.query(`SELECT COALESCE(sum(v),0)::text AS total FROM (
        SELECT base_amount_minor::numeric AS v FROM financial_activities WHERE kind='expense' AND status='posted'
        UNION ALL SELECT -base_amount_minor::numeric FROM financial_activities WHERE kind='refund' AND status='posted'
        UNION ALL SELECT ac.amount_minor::numeric FROM activity_charges ac JOIN financial_activities f ON f.id=ac.activity_id WHERE f.status='posted') x`)).rows[0];
      return { expense: null, total: rows.total };
    }

    await t.test("repay ke akun non-liability dan borrow dari akun non-liability ditolak", async () => {
      const plain = await make("Biasa", "asset");
      await assert.rejects(() => postActivity({ kind: "repay", amountMinor: "1", sourceAssetId: wallet, destinationAssetId: plain, occurredAt: at }, randomUUID()), /liability/);
      await assert.rejects(() => postActivity({ kind: "borrow", amountMinor: "1", sourceAssetId: wallet, destinationAssetId: loan, occurredAt: at }, randomUUID()), /liability/);
      // constraint DB berdiri sendiri, di luar validasi aplikasi
      await assert.rejects(() => admin.query(`INSERT INTO financial_activities (id,kind,base_amount_minor,currency_code,source_asset_id,destination_asset_id,occurred_at)
        VALUES ($1,'borrow',1,'IDR',$2,$3,now())`, [randomUUID(), wallet, loan]), /liability source/);
      await assert.rejects(() => admin.query(`INSERT INTO financial_activities (id,kind,base_amount_minor,currency_code,source_asset_id,destination_asset_id,occurred_at,adjustment_reason)
        VALUES ($1,'adjustment',1,'IDR',$2,$3,now(),'reconciliation')`, [randomUUID(), wallet, loan]), /activity_assets_by_kind/);
    });

    await t.test("refund: mengurangi pengeluaran kategori, bukan pemasukan; batas total; void asal ditolak", async () => {
      const expense = await postActivity({ kind: "expense", amountMinor: "100000", sourceAssetId: wallet, categoryId, occurredAt: at }, randomUUID());
      const incomeBefore = await count("SELECT count(*)::int AS n FROM financial_activities WHERE kind='income'");
      const walletBefore = BigInt(await balance(wallet));
      const refund = await postActivity({ kind: "refund", amountMinor: "40000", destinationAssetId: wallet, refundOfActivityId: expense, occurredAt: at }, randomUUID());
      assert.equal(BigInt(await balance(wallet)), walletBefore + 40000n);
      const row = (await admin.query("SELECT kind,category_id,category_kind,refund_of_activity_id FROM financial_activities WHERE id=$1", [refund])).rows[0];
      assert.deepEqual(row, { kind: "refund", category_id: categoryId, category_kind: "expense", refund_of_activity_id: expense });
      assert.equal(await count("SELECT count(*)::int AS n FROM financial_activities WHERE kind='income'"), incomeBefore);
      await assert.rejects(() => postActivity({ kind: "refund", amountMinor: "70000", destinationAssetId: wallet, refundOfActivityId: expense, occurredAt: at }, randomUUID()), /exceeds/);
      await assert.rejects(() => voidActivity(expense, randomUUID()), /refund/);
      assert.equal((await listActivities()).find((a) => a.id === refund).refundOfActivityId, expense);
      // pengeluaran bersih = 100.000 - 40.000 (+ bunga 50.000 dari repay)
      assert.equal((await monthlyExpensesFor()).total, "110000");
      await voidActivity(refund, randomUUID());
      assert.equal(BigInt(await balance(wallet)), walletBefore);
      assert.equal((await monthlyExpensesFor()).total, "150000");
      await voidActivity(expense, randomUUID()); // tanpa refund aktif sekarang boleh
    });

    await t.test("refund harus merujuk pengeluaran posted bermata uang sama", async () => {
      await assert.rejects(() => postActivity({ kind: "refund", amountMinor: "1", destinationAssetId: wallet, refundOfActivityId: randomUUID(), occurredAt: at }, randomUUID()), /tidak ditemukan/);
      const income = await postActivity({ kind: "income", amountMinor: "10", destinationAssetId: wallet, occurredAt: at }, randomUUID());
      await assert.rejects(() => postActivity({ kind: "refund", amountMinor: "1", destinationAssetId: wallet, refundOfActivityId: income, occurredAt: at }, randomUUID()), /expense/);
    });

    await t.test("adjustment: rekonsiliasi naik/turun tanpa menjadi pemasukan atau pengeluaran", async () => {
      const before = BigInt(await balance(wallet));
      await postActivity({ kind: "adjustment", amountMinor: "700", adjustmentReason: "reconciliation", destinationAssetId: wallet, occurredAt: at }, randomUUID());
      await postActivity({ kind: "adjustment", amountMinor: "200", adjustmentReason: "reconciliation", sourceAssetId: wallet, occurredAt: at }, randomUUID());
      assert.equal(BigInt(await balance(wallet)), before + 500n);
      await assert.rejects(() => postActivity({ kind: "adjustment", amountMinor: "1", adjustmentReason: "reconciliation", sourceAssetId: wallet, destinationAssetId: loan, occurredAt: at }, randomUUID()), /penyesuaian/i);
    });

    await t.test("utang awal: adjustment opening_debt menambah liability dengan saldo awal tetap 0", async () => {
      const debt = await make("Utang Awal sintetis", "liability", 0n, false);
      await postActivity({ kind: "adjustment", amountMinor: "2000000", adjustmentReason: "opening_debt", sourceAssetId: debt, occurredAt: at }, randomUUID());
      assert.equal(await balance(debt), "-2000000");
      assert.equal((await admin.query("SELECT amount_minor::text AS v FROM asset_opening_states WHERE asset_id=$1", [debt])).rows[0].v, "0");
      await assert.rejects(() => postActivity({ kind: "adjustment", amountMinor: "1", adjustmentReason: "opening_debt", sourceAssetId: wallet, occurredAt: at }, randomUUID()), /liability/);
      await assert.rejects(() => postActivity({ kind: "adjustment", amountMinor: "1", adjustmentReason: "opening_debt", destinationAssetId: debt, occurredAt: at }, randomUUID()));
    });

    await t.test("borrow dengan jadwal pokok: hanya bulan jatuh tempo yang menjadi tagihan; void membatalkan jadwal", async () => {
      const sched = await make("Pinjaman Berjadwal sintetis", "liability", 0n, false);
      const id = await postActivity({ kind: "borrow", amountMinor: "1200000", sourceAssetId: sched, destinationAssetId: wallet, occurredAt: at }, randomUUID(),
        { creditCycle: "current", creditInstallments: { count: 3, principalMinor: "400000", interestMinor: "0" } });
      assert.equal(await count("SELECT count(*)::int AS n FROM credit_installments WHERE activity_id=$1 AND status='scheduled'", [id]), 3);
      const assets = (await listAssets()).filter((a) => a.id === sched);
      assert.equal(creditDebtThrough(assets, "IDR", "2000-01-01"), 400000n);
      assert.equal(creditDebtThrough(assets, "IDR", "2099-01-01"), 800000n); // bulan ini + bulan depan; bulan ke-3 belum jatuh tempo
      await assert.rejects(() => postActivity({ kind: "borrow", amountMinor: "1200000", sourceAssetId: sched, destinationAssetId: wallet, occurredAt: at }, randomUUID(),
        { creditCycle: "current", creditInstallments: { count: 3, principalMinor: "400000", interestMinor: "10" } }), /pokok/);
      await voidActivity(id, randomUUID());
      assert.equal(await count("SELECT count(*)::int AS n FROM credit_installments WHERE activity_id=$1 AND status='scheduled'", [id]), 0);
      assert.equal(await balance(sched), "0");
    });

    await t.test("void borrow membalik ledger; kunci yang sama dengan isi berbeda ditolak", async () => {
      const key = randomUUID();
      const id = await postActivity({ kind: "borrow", amountMinor: "300", sourceAssetId: loan, destinationAssetId: wallet, occurredAt: at }, key);
      await assert.rejects(() => postActivity({ kind: "borrow", amountMinor: "301", sourceAssetId: loan, destinationAssetId: wallet, occurredAt: at }, key), /Kunci permintaan/);
      const before = BigInt(await balance(wallet));
      await voidActivity(id, randomUUID());
      assert.equal(BigInt(await balance(wallet)), before - 300n);
    });
    hooks.deregister();
  } finally {
    globalThis.__debtTestAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
