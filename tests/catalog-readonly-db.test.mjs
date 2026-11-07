// listCatalog harus baca-saja, dan migrasi 020 membersihkan penyedia/jaringan demo tak terpakai secara idempotent.
// Isolated PostgreSQL 16 only (container 55434, DB khusus):
//   MONEYTOR_RECONCILE_DB_TEST=moneytor_reconcile_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_reconcile_verify npm run test:catalog-readonly:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_RECONCILE_DB_TEST === "moneytor_reconcile_verify";
test("listCatalog baca-saja; migrasi 020 menghapus demo tak terpakai (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_RECONCILE_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  const schema = `ro_${randomUUID().replaceAll("-", "")}`;
  let pool, hooks;
  const files = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort();
  const sqlOf = (name) => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
  try {
    await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
    for (const name of files.filter((n) => n < "020")) await admin.query(await sqlOf(name));
    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const usedProvider = (await admin.query("SELECT id FROM financial_providers WHERE system_key='demo_wallet'")).rows[0].id;
    const asset = randomUUID();
    await admin.query("INSERT INTO assets (id,display_name,asset_type_id,provider_id,currency_code,normally_liquid,normally_spendable) VALUES ($1,'Dompet',$2,$3,'IDR',true,true)", [asset, typeId, usedProvider]);
    await admin.query("INSERT INTO asset_opening_states (asset_id,amount_minor,effective_at) VALUES ($1,0,now())", [asset]);
    await admin.query("INSERT INTO transaction_categories (id,display_name,applies_to) VALUES ($1,'Biaya Admin Rekening','expense')", [randomUUID()]);
    const dump = async () => JSON.stringify(await Promise.all(["financial_providers", "payment_networks", "transaction_categories", "asset_types", "asset_groups", "additional_charge_types"]
      .map(async (table) => (await admin.query(`SELECT * FROM ${table} ORDER BY id`)).rows)));

    await t.test("migrasi 020: demo tak terpakai dihapus, yang dirujuk tetap; diulang tidak mengubah apa pun", async () => {
      await admin.query(await sqlOf("020_reconcile_views.sql"));
      const keys = (await admin.query("SELECT system_key FROM financial_providers WHERE system_key LIKE 'demo\\_%' ORDER BY 1")).rows.map((r) => r.system_key);
      assert.deepEqual(keys, ["demo_wallet"]);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM payment_networks WHERE system_key='demo_network'")).rows[0].n, 0);
      const after = await dump();
      await admin.query(await sqlOf("020_reconcile_views.sql"));
      assert.equal(await dump(), after);
    });

    await t.test("listCatalog tidak mengubah isi tabel mana pun, termasuk kategori 'Biaya Admin Rekening'", async () => {
      target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
      hooks = registerHooks({ resolve(specifier, context, next) {
        if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__roAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
        if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
        return next(specifier, context);
      } });
      const { listCatalog } = await import("../src/lib/repositories/catalogs.ts");
      const { database } = await import("../src/lib/db/pool.ts"); pool = database();
      globalThis.__roAuthorized = true;
      const before = await dump();
      for (const name of ["providers", "paymentNetworks", "assetTypes", "assetGroups", "transactionCategories", "chargeTypes"]) {
        await listCatalog(name); await listCatalog(name, true);
      }
      assert.equal(await dump(), before);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM transaction_categories WHERE system_key='bank_admin_fee'")).rows[0].n, 0);
      hooks.deregister();
    });
  } finally {
    globalThis.__roAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
