// Rekonsiliasi angka: satu definisi saldo, kekayaan bersih, pengeluaran (analitik, detail akun, item, bulanan) pada data campuran.
// Isolated PostgreSQL 16 only (container 55434, DB khusus):
//   MONEYTOR_RECONCILE_DB_TEST=moneytor_reconcile_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_reconcile_verify npm run test:reconcile:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_RECONCILE_DB_TEST === "moneytor_reconcile_verify";
test("rekonsiliasi angka pada data campuran (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_RECONCILE_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_RECONCILE_DB_TEST);
  const schema = `rec_${randomUUID().replaceAll("-", "")}`;
  let pool, hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__reconcileAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const assets = await import("../src/lib/repositories/assets.ts");
    const { postActivity, replaceActivity, voidActivity } = await import("../src/lib/finance/service.ts");
    const { postSplitBill } = await import("../src/lib/finance/split-bill-service.ts");
    const { financeSnapshot, monthlyExpenses } = await import("../src/lib/finance/summary.ts");
    const { readAggregates, readSpendingItems } = await import("../src/lib/analytics/queries.ts");
    const { reportingPeriod } = await import("../src/lib/analytics/periods.ts");
    const inv = await import("../src/lib/investments/service.ts");
    const { investmentSnapshot } = await import("../src/lib/investments/read.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__reconcileAuthorized = true;

    const one = async (sql, p = []) => (await admin.query(sql, p)).rows[0];
    const typeId = (await one("SELECT id FROM asset_types WHERE system_key='bank_account'")).id;
    const charge = async (k) => (await one("SELECT id FROM additional_charge_types WHERE system_key=$1", [k])).id;
    const cat = async (k) => (await one("SELECT id FROM transaction_categories WHERE system_key=$1", [k])).id;
    const make = (displayName, assetClass, opening = 0n, spendable = true) => assets.insertAssetWithOpening({ displayName, currency: "IDR", assetTypeId: typeId,
      normallyLiquid: spendable, normallySpendable: spendable, openingAmountMinor: opening, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass });
    const wallet = await make("Dompet", "asset", 10000000n);
    const savings = await make("Tabungan", "asset", 0n, false);
    const card = await make("Kartu kredit", "liability", 0n, false);
    const loan = await make("Pinjaman", "liability", 0n, false);
    const oldDebt = await make("Utang awal", "liability", 0n, false);
    const post = (draft, options) => postActivity({ occurredAt: "2026-10-10T05:00:00.000Z", ...draft }, randomUUID(), options);

    // pemasukan
    await post({ kind: "income", amountMinor: "5000000", destinationAssetId: wallet, occurredAt: "2026-10-01T03:00:00.000Z" });
    // pembelian cicilan di kartu: pengeluaran penuh + bunga cicilan sebagai biaya; pembayaran tagihan = transfer, bukan pengeluaran
    await post({ kind: "expense", amountMinor: "600000", sourceAssetId: card, charges: [{ typeId: await charge("installment_interest"), amountMinor: "30000" }] },
      { creditCycle: "current", creditInstallments: { count: 3, principalMinor: "200000", interestMinor: "10000" } });
    await post({ kind: "transfer", amountMinor: "100000", sourceAssetId: wallet, destinationAssetId: card, occurredAt: "2026-10-12T05:00:00.000Z" });
    // belanja + biaya
    await post({ kind: "expense", amountMinor: "250000", sourceAssetId: wallet, categoryId: await cat("food"), charges: [{ typeId: await charge("service_fee"), amountMinor: "5000" }], occurredAt: "2026-10-15T05:00:00.000Z" });
    const e1 = await post({ kind: "expense", amountMinor: "400000", sourceAssetId: wallet, categoryId: await cat("shopping"), occurredAt: "2026-10-20T05:00:00.000Z" });
    const e1b = await replaceActivity(e1, { kind: "expense", amountMinor: "420000", sourceAssetId: wallet, categoryId: await cat("shopping"), occurredAt: "2026-10-20T05:00:00.000Z" }, randomUUID());
    const e2 = await post({ kind: "expense", amountMinor: "300000", sourceAssetId: wallet, categoryId: await cat("transport"), occurredAt: "2026-10-22T05:00:00.000Z" });
    // 1 Nov 00:30 WIB (= 31 Okt 17:30 UTC) harus masuk November
    await post({ kind: "expense", amountMinor: "77000", sourceAssetId: wallet, categoryId: await cat("food"), occurredAt: "2026-10-31T17:30:00.000Z" });
    // split bill, pinjaman, pelunasan + bunga, transfer + biaya, utang awal
    await postSplitBill({ sourceAssetId: wallet, totalMinor: "300000", reimbursedMinor: "120000", occurredAt: "2026-10-25T05:00:00.000Z", person: "Budi" }, randomUUID());
    await post({ kind: "borrow", amountMinor: "2000000", sourceAssetId: loan, destinationAssetId: wallet, occurredAt: "2026-10-26T05:00:00.000Z" });
    await post({ kind: "repay", amountMinor: "500000", sourceAssetId: wallet, destinationAssetId: loan, charges: [{ typeId: await charge("loan_interest"), amountMinor: "20000" }], occurredAt: "2026-10-28T05:00:00.000Z" });
    await post({ kind: "transfer", amountMinor: "300000", sourceAssetId: wallet, destinationAssetId: savings, transferFeeMinor: "2500", occurredAt: "2026-10-29T05:00:00.000Z" });
    await post({ kind: "adjustment", amountMinor: "800000", adjustmentReason: "opening_debt", sourceAssetId: oldDebt, occurredAt: "2026-10-30T05:00:00.000Z" });
    // investasi: beli 10 @ 50.000 + biaya 1.000, harga pasar 60.000
    const instrumentType = await inv.createInstrumentType("Reksa uji");
    const portfolio = await inv.createPortfolio({ displayName: "Portofolio uji", currency: "IDR" });
    const instrument = await inv.createInstrument({ displayName: "Reksa uji A", currency: "IDR", typeId: instrumentType });
    await inv.saveMarketPrice({ instrumentId: instrument, price: "60000", asOf: "2026-10-27T05:00:00.000Z" }, randomUUID());
    await inv.postInvestmentTrade({ kind: "buy", portfolioId: portfolio, instrumentId: instrument, cashAssetId: wallet, quantity: "10", unitPrice: "50000", feeMinor: "1000", occurredAt: "2026-10-27T05:00:00.000Z" }, randomUUID());

    const refund = (of, amountMinor, occurredAt, destinationAssetId = wallet) => postActivity({ kind: "refund", amountMinor, destinationAssetId, refundOfActivityId: of, occurredAt }, randomUUID());
    const periodAll = reportingPeriod({ kind: "custom", startDay: "2026-10-01", endDay: "2026-11-30" }, new Date("2026-12-15T00:00:00Z"));
    const summary = async (period = periodAll) => {
      const client = await pool.connect();
      try { const rows = await readAggregates(client, period, "IDR"); return { rows, summary: rows.find((r) => r.dimension === "summary") }; } finally { client.release(); }
    };
    const incomeBefore = (await summary()).summary.incomeMinor;

    await t.test("refund parsial dan berulang pada pengeluaran yang sudah diedit; batas total; void asal ditolak", async () => {
      await refund(e1b, "100000", "2026-11-02T05:00:00.000Z");
      await refund(e1b, "50000", "2026-11-03T05:00:00.000Z");
      await assert.rejects(() => refund(e1b, "270001", "2026-11-03T06:00:00.000Z"), /exceeds/); // sisa 420.000 - 150.000 = 270.000
      const transport = await cat("transport");
      await refund(e2, "50000", "2026-11-04T05:00:00.000Z"); // refund atas versi lama...
      const e2b = await replaceActivity(e2, { kind: "expense", amountMinor: "320000", sourceAssetId: wallet, categoryId: transport, occurredAt: "2026-10-22T05:00:00.000Z" }, randomUUID());
      await assert.rejects(() => replaceActivity(e2b, { kind: "expense", amountMinor: "40000", sourceAssetId: wallet, categoryId: transport, occurredAt: "2026-10-22T05:00:00.000Z" }, randomUUID()), /refund/i); // di bawah yang sudah di-refund
      await assert.rejects(() => voidActivity(e1b, randomUUID()), /refund/i);
      await assert.rejects(() => refund(e1, "270001", "2026-11-05T05:00:00.000Z"), /exceeds/); // versi lama menunjuk rantai yang sama
    });

    await t.test("pengeluaran total: tepat 1.704.500 di analitik, detail akun, item, dan bulanan (Asia/Jakarta)", async () => {
      // 630.000 (kartu+bunga) + 255.000 + 420.000 + 320.000 + 77.000 + 180.000 (split pribadi) + 20.000 (bunga repay) + 2.500 (biaya transfer) - 200.000 refund
      const expected = 1704500n;
      const { rows, summary: s } = await summary();
      assert.equal(BigInt(s.spendingMinor), expected);
      assert.equal(BigInt(s.incomeMinor), BigInt(incomeBefore)); // refund bukan pemasukan
      let detail = 0n, refunded = 0n;
      for (const a of await assets.listAssets()) {
        const d = (await assets.readAssetDetail(a.id)).activitySummary;
        detail += BigInt(d.expenseMinor); refunded += BigInt(d.refundMinor);
      }
      assert.equal(detail, expected); assert.equal(refunded, 200000n);
      const client = await pool.connect();
      try {
        const items = await readSpendingItems(client, periodAll, "IDR");
        assert.equal(items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n), expected);
        assert.equal(items.filter((i) => i.kind === "refund").reduce((sum, i) => sum + BigInt(i.amountMinor), 0n), -200000n);
      } finally { client.release(); }
      const month = (key) => BigInt(rows.find((r) => r.dimension === "month" && r.key === key).spendingMinor);
      assert.equal(month("2026-11"), 77000n - 200000n); // 1 Nov 00:30 WIB masuk November; boleh negatif
      assert.equal(month("2026-10"), expected - month("2026-11"));
      assert.equal(await monthlyExpenses(new Date("2026-11-15T00:00:00Z")).then((r) => BigInt(r.find((x) => x.currency === "IDR").expenseMinor)), month("2026-11"));
      assert.equal(await monthlyExpenses(new Date("2026-10-15T00:00:00Z")).then((r) => BigInt(r.find((x) => x.currency === "IDR").expenseMinor)), month("2026-10"));
      const byCategory = (k) => BigInt(rows.find((r) => r.dimension === "category" && r.name === k)?.expensePrincipalMinor ?? "0");
      assert.equal(byCategory("Belanja"), 420000n - 150000n);
      assert.equal(byCategory("Transport"), 320000n - 50000n);
      // kategori refund mengikuti pengeluaran versi terbaru, bukan versi lama
      const parent = (k) => rows.find((r) => r.dimension === "category_parent" && r.name === k);
      assert.ok(parent("Belanja"));
    });

    await t.test("kekayaan bersih = Σ saldo akun + nilai pasar investasi = aset - kewajiban + piutang; dana siap pakai satu definisi", async () => {
      const snapshot = await financeSnapshot({ includeRecent: false });
      const idr = snapshot.currencies.find((c) => c.currency === "IDR");
      const list = await assets.listAssets();
      const sum = (cls) => list.filter((a) => a.assetClass === cls).reduce((acc, a) => acc + BigInt(a.balanceMinor), 0n);
      const market = BigInt((await investmentSnapshot()).totals.find((x) => x.currency === "IDR").marketMinor);
      assert.equal(market, 600000n);
      const all = list.reduce((acc, a) => acc + BigInt(a.balanceMinor), 0n);
      assert.equal(BigInt(idr.netWorthMinor), all + market);
      assert.equal(BigInt(idr.netWorthMinor), sum("asset") + sum("receivable") + sum("liability") + market); // saldo kewajiban bernilai negatif
      assert.equal(sum("receivable"), 120000n);
      const { summarizeBalances } = await import("../src/lib/domain/net-worth.ts");
      const { availableFunds } = await import("../src/lib/domain/planning.ts");
      const entry = summarizeBalances(list, [{ currency: "IDR", exponent: 0, marketMinor: String(market), unpricedCount: 0 }], snapshot.throughDay).get("IDR");
      const position = availableFunds(entry.spendable, { reservedMinor: "0", dueMinor: "0", coveredMinor: "0", uncoveredMinor: "0" }, entry.creditDebt);
      assert.equal(idr.availableMinor, position.availableMinor);
      assert.equal(await one("SELECT 1 AS x").then(() => (BigInt(idr.eligibleMinor) >= 0n)), true);
    });

    await t.test("saldo akun: satu sumber untuk listAssets dan listAssetBalances", async () => {
      const a = new Map((await assets.listAssets()).map((x) => [x.id, x.balanceMinor]));
      for (const b of await assets.listAssetBalances()) assert.equal(String(b.balance.amountMinor ?? b.balance.minor ?? b.balance), String(a.get(b.assetId)));
    });
    hooks.deregister();
  } finally {
    globalThis.__reconcileAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
