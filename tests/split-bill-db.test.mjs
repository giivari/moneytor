// (c) Split bill atomik: pengeluaran pribadi + transfer talangan + akun piutang dalam SATU transaksi dan SATU kunci.
// Isolated PostgreSQL 16 only (container credit, port 55434):
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_credit_verify npm run test:splitbill:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_CREDIT_DB_TEST === "moneytor_credit_verify";
test("(c) split bill atomik (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_CREDIT_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_CREDIT_DB_TEST);
  const schema = `split_test_${randomUUID().replaceAll("-", "")}`;
  let pool, hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__splitTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { postSplitBill } = await import("../src/lib/finance/split-bill-service.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__splitTestAuthorized = true;

    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const chargeTypeId = (await admin.query("SELECT id FROM additional_charge_types ORDER BY id LIMIT 1")).rows[0].id;
    const wallet = await insertAssetWithOpening({ displayName: "Dompet sintetis", currency: "IDR", assetTypeId: typeId, normallyLiquid: true,
      normallySpendable: true, openingAmountMinor: 1000000n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "asset" });
    const count = async (sql, params = []) => (await admin.query(sql, params)).rows[0].n;
    const counts = async () => ({
      activities: await count("SELECT count(*)::int AS n FROM financial_activities"),
      assets: await count("SELECT count(*)::int AS n FROM assets"),
      operations: await count("SELECT count(*)::int AS n FROM split_bill_operations"),
      keys: await count("SELECT count(*)::int AS n FROM finance_operations"),
    });
    const base = () => ({ sourceAssetId: wallet, totalMinor: "300000", reimbursedMinor: "200000", occurredAt: "2026-03-01T05:00:00.000Z",
      person: "Budi", note: "Makan malam" });

    await t.test("membuat akun piutang receivable, pengeluaran pribadi, dan transfer talangan sekaligus", async () => {
      const key = randomUUID(), before = await counts();
      const result = await postSplitBill({ ...base(), charges: [{ typeId: chargeTypeId, amountMinor: "5000" }] }, key);
      assert.equal(result.receivableCreated, true);
      const receivable = (await listAssets()).find((item) => item.id === result.receivableAssetId);
      assert.equal(receivable.assetClass, "receivable");
      assert.equal(receivable.displayName, "Piutang & Talangan");
      assert.equal(receivable.balanceMinor, "200000");
      assert.equal((await listAssets()).find((item) => item.id === wallet).balanceMinor, String(1000000 - 305000));
      const after = await counts();
      assert.deepEqual([after.activities - before.activities, after.assets - before.assets, after.operations - before.operations], [2, 1, 1]);
      const personal = (await admin.query("SELECT kind,base_amount_minor::text AS base FROM financial_activities WHERE id=$1", [result.personalActivityId])).rows[0];
      assert.deepEqual(personal, { kind: "expense", base: "100000" });
    });

    await t.test("pengulangan request dengan kunci sama mengembalikan hasil yang sama tanpa posting ganda", async () => {
      const key = randomUUID(), request = { ...base(), totalMinor: "120000", reimbursedMinor: "40000" };
      const first = await postSplitBill(request, key), before = await counts();
      const again = await postSplitBill({ ...request }, key);
      assert.deepEqual(again, { ...first, receivableCreated: first.receivableCreated });
      assert.deepEqual(await counts(), before);
      await assert.rejects(() => postSplitBill({ ...request, reimbursedMinor: "50000" }, key), /Kunci permintaan/);
      assert.deepEqual(await counts(), before);
    });

    await t.test("memakai akun piutang yang sudah ada dan tidak membuat akun kedua", async () => {
      const before = await counts();
      const result = await postSplitBill({ ...base(), totalMinor: "50000", reimbursedMinor: "50000" }, randomUUID());
      assert.equal(result.receivableCreated, false);
      assert.equal(result.personalActivityId, null); // 100% talangan: tanpa pengeluaran pribadi
      const after = await counts();
      assert.deepEqual([after.activities - before.activities, after.assets - before.assets], [1, 0]);
    });

    await t.test("gagal di tengah (biaya tambahan tidak valid): tidak ada pengeluaran, transfer, atau akun piutang", async () => {
      // Mata uang baru supaya akun piutang harus dibuat; kegagalan terjadi setelah akun itu dibuat dalam transaksi.
      await admin.query("INSERT INTO currencies (code,display_name,minor_unit_exponent,is_active) VALUES ('EUR','Euro',2,true) ON CONFLICT DO NOTHING");
      const euro = await insertAssetWithOpening({ displayName: "Dompet EUR", currency: "EUR", assetTypeId: typeId, normallyLiquid: true,
        normallySpendable: true, openingAmountMinor: 100000n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "asset" });
      const before = await counts();
      await assert.rejects(() => postSplitBill({ ...base(), sourceAssetId: euro, totalMinor: "10000", reimbursedMinor: "4000",
        charges: [{ typeId: randomUUID(), amountMinor: "100" }] }, randomUUID()));
      assert.deepEqual(await counts(), before);
    });

    await t.test("gagal saat transfer talangan (setelah pengeluaran pribadi diposting): semuanya dibatalkan", async () => {
      await admin.query(`CREATE FUNCTION fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.kind='transfer' AND NEW.note LIKE 'Talangan Gagal%' THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END $$`);
      await admin.query("CREATE TRIGGER fail_transfer BEFORE INSERT ON financial_activities FOR EACH ROW EXECUTE FUNCTION fail_transfer()");
      const before = await counts();
      await assert.rejects(() => postSplitBill({ ...base(), person: "Gagal" }, randomUUID()), /injected failure/);
      assert.deepEqual(await counts(), before);
      await admin.query("DROP TRIGGER fail_transfer ON financial_activities");
    });

    await t.test("receivableAssetId eksplisit harus akun receivable aktif bermata uang sama", async () => {
      const before = await counts();
      await assert.rejects(() => postSplitBill({ ...base(), receivableAssetId: wallet }, randomUUID()), /piutang/i);
      assert.deepEqual(await counts(), before);
    });

    await t.test("validasi nominal: talangan 0 atau melebihi total ditolak", async () => {
      await assert.rejects(() => postSplitBill({ ...base(), reimbursedMinor: "0" }, randomUUID()));
      await assert.rejects(() => postSplitBill({ ...base(), reimbursedMinor: "300001" }, randomUUID()));
    });
    hooks.deregister();
  } finally {
    globalThis.__splitTestAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
