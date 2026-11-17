// Pelunasan piutang atomik (settle-receivable): transfer + penyesuaian pembulatan dalam SATU transaksi dan SATU kunci.
// Isolated PostgreSQL 16 only (container credit, port 55434):
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_credit_verify npm run test:settle:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_CREDIT_DB_TEST === "moneytor_credit_verify";
test("settle-receivable atomik (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_CREDIT_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_CREDIT_DB_TEST);
  const schema = `settle_test_${randomUUID().replaceAll("-", "")}`;
  let pool, hooks;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`SET search_path TO ${schema}`);
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__settleTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    } });
    const { insertAssetWithOpening, listAssets } = await import("../src/lib/repositories/assets.ts");
    const { postReceivableSettlement } = await import("../src/lib/finance/receivable-settlement-service.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__settleTestAuthorized = true;

    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const mk = (displayName, openingAmountMinor, assetClass = "asset", currency = "IDR") => insertAssetWithOpening({ displayName, currency, assetTypeId: typeId,
      normallyLiquid: true, normallySpendable: true, openingAmountMinor, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass });
    const balance = async (id) => (await listAssets()).find((a) => a.id === id).balanceMinor;
    const count = async (sql) => (await admin.query(sql)).rows[0].n;
    const counts = async () => ({ activities: await count("SELECT count(*)::int AS n FROM financial_activities"),
      operations: await count("SELECT count(*)::int AS n FROM receivable_settlement_operations"), keys: await count("SELECT count(*)::int AS n FROM finance_operations") });
    const dest = await mk("Mandiri sintetis", 1000000n);
    const req = (receivable, over = {}) => ({ receivableAssetId: receivable, destinationAssetId: dest, receivedAmountMinor: "19900", settlementMode: "partial",
      occurredAt: "2026-03-01T05:00:00.000Z", note: "", ...over });

    await t.test("pas: satu transfer, piutang 0, tujuan +diterima", async () => {
      const r = await mk("Talangan Pas", 19900n, "receivable"), before = await counts(), destBefore = BigInt(await balance(dest));
      const result = await postReceivableSettlement(req(r), randomUUID());
      assert.equal(result.adjustmentActivityId, null);
      assert.equal(await balance(r), "0");
      assert.equal(BigInt(await balance(dest)) - destBefore, 19900n);
      const after = await counts();
      assert.deepEqual([after.activities - before.activities, after.operations - before.operations], [1, 1]);
    });

    await t.test("lebih bayar: transfer sebesar sisa + income selisih ke tujuan dengan catatan pembulatan", async () => {
      const r = await mk("Talangan Lebih", 19900n, "receivable"), destBefore = BigInt(await balance(dest));
      const result = await postReceivableSettlement(req(r, { receivedAmountMinor: "20000" }), randomUUID());
      assert.equal(result.adjustmentKind, "income");
      assert.equal(await balance(r), "0");
      assert.equal(BigInt(await balance(dest)) - destBefore, 20000n);
      const adj = (await admin.query("SELECT kind,base_amount_minor::text AS base,note FROM financial_activities WHERE id=$1", [result.adjustmentActivityId])).rows[0];
      assert.deepEqual(adj, { kind: "income", base: "100", note: "Selisih pembulatan pelunasan · Talangan Lebih" });
    });

    await t.test("kurang bayar parsial: sisa tetap di piutang, tanpa penyesuaian", async () => {
      const r = await mk("Talangan Parsial", 17000n, "receivable"), destBefore = BigInt(await balance(dest));
      const result = await postReceivableSettlement(req(r, { receivedAmountMinor: "16500", settlementMode: "partial" }), randomUUID());
      assert.equal(result.adjustmentActivityId, null);
      assert.equal(await balance(r), "500");
      assert.equal(BigInt(await balance(dest)) - destBefore, 16500n);
    });

    await t.test("kurang bayar tutup lunas: expense selisih dari piutang, piutang 0, kas masuk sebesar diterima", async () => {
      const r = await mk("Talangan Tutup", 17000n, "receivable"), destBefore = BigInt(await balance(dest));
      const result = await postReceivableSettlement(req(r, { receivedAmountMinor: "16500", settlementMode: "close_with_adjustment" }), randomUUID());
      assert.equal(result.adjustmentKind, "expense");
      assert.equal(await balance(r), "0");
      assert.equal(BigInt(await balance(dest)) - destBefore, 16500n);
      const adj = (await admin.query("SELECT kind,base_amount_minor::text AS base,note FROM financial_activities WHERE id=$1", [result.adjustmentActivityId])).rows[0];
      assert.deepEqual(adj, { kind: "expense", base: "500", note: "Selisih pembulatan pelunasan · Talangan Tutup" });
    });

    await t.test("replay kunci sama: hasil sama tanpa posting ganda; payload beda ditolak", async () => {
      const r = await mk("Talangan Replay", 20000n, "receivable"), key = randomUUID(), request = req(r, { receivedAmountMinor: "21000" });
      const first = await postReceivableSettlement(request, key), before = await counts();
      assert.deepEqual(await postReceivableSettlement({ ...request }, key), first);
      assert.deepEqual(await counts(), before);
      await assert.rejects(() => postReceivableSettlement({ ...request, receivedAmountMinor: "22000" }, key), /Kunci permintaan/);
      assert.deepEqual(await counts(), before);
    });

    await t.test("validasi: tujuan kredit/piutang/beda mata uang/sama dengan piutang dan piutang saldo 0 ditolak tanpa efek", async () => {
      const r = await mk("Talangan Valid", 10000n, "receivable"), liability = await mk("Kartu", 0n, "liability");
      await admin.query("INSERT INTO currencies (code,display_name,minor_unit_exponent,is_active) VALUES ('EUR','Euro',2,true) ON CONFLICT DO NOTHING");
      const euro = await mk("Dompet EUR", 5000n, "asset", "EUR"), otherReceivable = await mk("Talangan Lain", 0n, "receivable"), before = await counts();
      for (const bad of [liability, otherReceivable, euro, r]) await assert.rejects(() => postReceivableSettlement(req(r, { destinationAssetId: bad }), randomUUID()));
      await assert.rejects(() => postReceivableSettlement(req(otherReceivable), randomUUID()), /tidak memiliki sisa/);
      await assert.rejects(() => postReceivableSettlement(req(dest, { destinationAssetId: r }), randomUUID()), /piutang aktif/);
      await assert.rejects(() => postReceivableSettlement(req(r, { receivedAmountMinor: "0" }), randomUUID()));
      await assert.rejects(() => postReceivableSettlement(req(r, { settlementMode: "bebas" }), randomUUID()), /Mode/);
      assert.deepEqual(await counts(), before);
      assert.equal(await balance(r), "10000");
    });
  } finally {
    globalThis.__settleTestAuthorized = false;
    hooks?.deregister?.();
    await pool?.end().catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
