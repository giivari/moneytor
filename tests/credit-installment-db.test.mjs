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
    for (let pass = 0; pass < 2; pass++) for (const { file, sql } of migrations) {
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = await admin.query("SELECT checksum FROM schema_migrations WHERE name=$1", [file]);
      if (prior.rowCount) { assert.equal(prior.rows[0].checksum, checksum); continue; }
      await admin.query(sql); await admin.query("INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)", [file, checksum]);
    }
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, files.length);

    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    const hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__creditTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { postActivity, voidActivity } = await import("../src/lib/finance/service.ts");
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
    hooks.deregister();
  } finally {
    globalThis.__creditTestAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
