// Katalog bawaan (migrasi 018/019) dari docs/CATALOG.md. Isolated PostgreSQL 16 only (container 55434, DB khusus):
//   MONEYTOR_CATALOG_DB_TEST=moneytor_catalog_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_catalog_verify npm run test:catalog:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const enabled = process.env.MONEYTOR_CATALOG_DB_TEST === "moneytor_catalog_verify";
const doc = (await readFile(new URL("../docs/CATALOG.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
function tables(heading) {
  const start = doc.indexOf(`\n## ${heading}\n`), next = doc.indexOf("\n## ", start + 4);
  const out = []; let cur = null;
  for (const line of doc.slice(start, next < 0 ? undefined : next).split("\n")) {
    if (!line.startsWith("|")) { cur = null; continue; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push(line.split("|").slice(1, -1).map((c) => c.trim()));
  }
  return out.map((rows) => rows.filter((row, i) => i > 0 && !row.every((c) => /^-+$/.test(c))));
}
const key = (c) => c.replace(/\s*\*$/, "");
const [expParents, expChildren] = tables("Kategori pengeluaran");
const [income] = tables("Kategori pemasukan");
const expected = [
  ...expParents.map(([k, name, nature]) => ({ k: key(k), name, scope: "expense", parent: null, nature })),
  ...expChildren.map(([p, k, name, nature]) => ({ k, name, scope: "expense", parent: p, nature })),
  ...income.map(([p, k, name]) => ({ k: key(k), name, scope: "income", parent: p === "-" ? null : p, nature: "-" })),
];

test("katalog bawaan lengkap, idempotent, dan tidak mengubah data lama (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434"); assert.equal(target.pathname, `/${process.env.MONEYTOR_CATALOG_DB_TEST}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, process.env.MONEYTOR_CATALOG_DB_TEST);
  const files = (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort();
  const sqlOf = (name) => readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8");
  const schemas = [];
  const fresh = async (label, upTo) => {
    const schema = `cat_${label}_${randomUUID().replaceAll("-", "")}`; schemas.push(schema);
    await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
    for (const name of files.filter((n) => n < upTo)) await admin.query(await sqlOf(name));
    return schema;
  };
  let pool, hooks;
  try {
    await t.test("DB kosong: setiap entri CATALOG.md ada dengan induk, sifat, dan jenis yang benar", async () => {
      await fresh("empty", "999");
      const rows = (await admin.query(`SELECT c.system_key,c.display_name,c.applies_to,c.nature,c.is_builtin,c.is_active,p.system_key AS parent
        FROM transaction_categories c LEFT JOIN transaction_categories p ON p.id=c.parent_id`)).rows;
      const byKey = new Map(rows.map((r) => [r.system_key, r]));
      for (const e of expected) {
        const r = byKey.get(e.k);
        assert.ok(r, `kategori ${e.k} ada`);
        assert.equal(r.display_name, e.name, e.k);
        assert.equal(r.applies_to, e.scope); assert.equal(r.parent, e.parent, `induk ${e.k}`);
        assert.equal(r.nature, e.nature === "-" ? null : e.nature, `sifat ${e.k}`);
        assert.ok(r.is_builtin && r.is_active);
      }
      assert.equal(rows.length, expected.length);
      for (const [section, table] of [["Jenis aset", "asset_types"], ["Jenis biaya", "additional_charge_types"]]) {
        const have = new Set((await admin.query(`SELECT system_key FROM ${table}`)).rows.map((r) => r.system_key));
        for (const row of tables(section)[0]) assert.ok(have.has(key(row[0])), `${table} ${row[0]}`);
      }
      const marks = await import("../src/lib/domain/provider-marks.ts");
      const providers = new Set((await admin.query("SELECT system_key FROM financial_providers")).rows.map((r) => r.system_key));
      for (const p of marks.CURATED_PROVIDERS) assert.ok(providers.has(p.key.replaceAll("-", "_")), p.key);
      const networks = new Set((await admin.query("SELECT system_key FROM payment_networks")).rows.map((r) => r.system_key));
      for (const n of marks.CURATED_PAYMENT_NETWORKS) assert.ok(networks.has(n.key.replaceAll("-", "_")), n.key);
      const demo = (await admin.query("SELECT bool_or(is_active) AS active FROM financial_providers WHERE system_key LIKE 'demo\\_%'")).rows[0];
      assert.equal(demo.active, false);
    });

    await t.test("DB berisi data lama: saldo dan total laporan identik, nama bentrok diberi sufiks, seed idempotent", async () => {
      await fresh("old", "018");
      const bank = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
      const provider = (await admin.query("SELECT id FROM financial_providers WHERE system_key='demo_bank'")).rows[0].id;
      const food = (await admin.query("SELECT id FROM transaction_categories WHERE system_key='food'")).rows[0].id;
      const custom = randomUUID(), clash = randomUUID(), wallet = randomUUID();
      await admin.query("INSERT INTO transaction_categories (id,display_name,applies_to) VALUES ($1,'Kopi Kantor','expense'),($2,'  makan DI luar ','expense')", [custom, clash]);
      await admin.query("INSERT INTO assets (id,display_name,asset_type_id,provider_id,currency_code,normally_liquid,normally_spendable) VALUES ($1,'Dompet lama',$2,$3,'IDR',true,true)", [wallet, bank, provider]);
      await admin.query("INSERT INTO asset_opening_states (asset_id,amount_minor,effective_at) VALUES ($1,1000000,now())", [wallet]);
      for (const [cat, amount] of [[food, 25000], [custom, 18000], [clash, 40000]]) {
        const id = randomUUID();
        await admin.query("INSERT INTO financial_activities (id,kind,base_amount_minor,currency_code,source_asset_id,category_id,category_kind,occurred_at) VALUES ($1,'expense',$2,'IDR',$3,$4,'expense',now())", [id, amount, wallet, cat]);
        await admin.query("INSERT INTO ledger_movements (id,activity_id,asset_id,currency_code,component,amount_minor) VALUES ($1,$2,$3,'IDR','principal',$4)", [randomUUID(), id, wallet, -amount]);
      }
      const snapshot = async () => ({
        balance: (await admin.query("SELECT (1000000+COALESCE(sum(amount_minor),0))::text AS v FROM ledger_movements WHERE asset_id=$1", [wallet])).rows[0].v,
        perCategory: (await admin.query("SELECT category_id,sum(base_amount_minor)::text AS v FROM financial_activities GROUP BY category_id ORDER BY category_id")).rows,
        activities: (await admin.query("SELECT id,kind,base_amount_minor::text,category_id,source_asset_id FROM financial_activities ORDER BY id")).rows,
        movements: (await admin.query("SELECT id,asset_id,amount_minor::text FROM ledger_movements ORDER BY id")).rows,
        walletType: (await admin.query("SELECT asset_type_id,provider_id FROM assets WHERE id=$1", [wallet])).rows,
      });
      const before = await snapshot();
      for (const name of files.filter((n) => n >= "018")) await admin.query(await sqlOf(name));
      assert.deepEqual(await snapshot(), before);
      assert.equal((await admin.query("SELECT display_name FROM transaction_categories WHERE id=$1", [clash])).rows[0].display_name, "  makan DI luar ");
      assert.equal((await admin.query("SELECT display_name FROM transaction_categories WHERE system_key='food_dining'")).rows[0].display_name, "Makan di luar (bawaan)");
      assert.equal((await admin.query("SELECT parent_id,nature FROM transaction_categories WHERE id=$1", [custom])).rows[0].nature, null);
      assert.equal((await admin.query("SELECT is_active FROM financial_providers WHERE system_key='demo_bank'")).rows[0].is_active, true); // masih dirujuk aset
      assert.equal((await admin.query("SELECT nature FROM transaction_categories WHERE system_key='food'")).rows[0].nature, "need");
      const count = async () => (await admin.query("SELECT (SELECT count(*) FROM transaction_categories)||'/'||(SELECT count(*) FROM asset_types)||'/'||(SELECT count(*) FROM additional_charge_types)||'/'||(SELECT count(*) FROM financial_providers)||'/'||(SELECT count(*) FROM payment_networks) AS v")).rows[0].v;
      const once = await count();
      await admin.query(await sqlOf("019_catalog_seed.sql"));
      assert.equal(await count(), once);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test("trigger: dua tingkat, pewarisan sifat, kunci NULL->nilai, identitas bawaan, override sifat", async () => {
      await fresh("guard", "999");
      const id = async (k) => (await admin.query("SELECT id FROM transaction_categories WHERE system_key=$1", [k])).rows[0].id;
      const insert = (name, scope, parent, nature = null) => admin.query("INSERT INTO transaction_categories (id,display_name,applies_to,parent_id,nature) VALUES ($1,$2,$3,$4,$5) RETURNING id,nature,parent_id", [randomUUID(), name, scope, parent, nature]);
      const housing = await id("housing"), groceries = await id("food_groceries");
      assert.equal((await insert("Kontrakan lantai 2", "expense", housing)).rows[0].nature, "obligation"); // mewarisi bila kosong
      assert.equal((await insert("Kontrakan hobi", "expense", housing, "want")).rows[0].nature, "want"); // sifat sendiri dipakai
      await assert.rejects(() => insert("Cucu", "expense", groceries), /two levels/);
      await assert.rejects(() => insert("Beda jenis", "income", housing), /same kind/);
      const custom = (await insert("Bebas", "expense", null)).rows[0].id;
      await admin.query("UPDATE transaction_categories SET parent_id=$2, nature='need' WHERE id=$1", [custom, housing]); // NULL -> nilai
      const health = await id("health");
      await assert.rejects(() => admin.query("UPDATE transaction_categories SET parent_id=$2 WHERE id=$1", [custom, health]), /locked/);
      await assert.rejects(() => admin.query("UPDATE transaction_categories SET nature='want' WHERE id=$1", [custom]), /locked/);
      await assert.rejects(() => admin.query("UPDATE transaction_categories SET system_key='x_y' WHERE system_key='housing'"), /immutable/);
      await assert.rejects(() => admin.query("DELETE FROM transaction_categories WHERE system_key='housing_rent'"), /built-in/);
      // override sifat: hanya pengeluaran; sifat efektif = override > sifat sendiri > sifat induk
      const orphan = (await insert("Tanpa sifat", "expense", null)).rows[0].id;
      const child = (await insert("Anak tanpa sifat", "expense", await id("other_expense"))).rows[0].id;
      const effective = async (cid) => (await admin.query("SELECT effective_nature,root_id FROM transaction_category_effective WHERE id=$1", [cid])).rows[0];
      assert.equal((await effective(orphan)).effective_nature, null);
      assert.equal((await effective(groceries)).effective_nature, "need");
      await admin.query("INSERT INTO category_nature_overrides (category_id,nature) VALUES ($1,'saving')", [orphan]);
      assert.equal((await effective(orphan)).effective_nature, "saving");
      await admin.query("INSERT INTO category_nature_overrides (category_id,nature) VALUES ($1,'want')", [groceries]);
      assert.equal((await effective(groceries)).effective_nature, "want");
      assert.equal((await effective(child)).root_id, await id("other_expense"));
      const salary = await id("salary");
      await assert.rejects(() => admin.query("INSERT INTO category_nature_overrides (category_id,nature) VALUES ($1,'need')", [salary]));
    });

    await t.test("kode: listCatalog, kategori anak, override, dan dimensi analitik per induk dan sifat", async () => {
      const schema = await fresh("app", "999");
      target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
      hooks = registerHooks({ resolve(specifier, context, next) {
        if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__catalogTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
        if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
        return next(specifier, context);
      } });
      const catalogs = await import("../src/lib/repositories/catalogs.ts");
      const { insertAssetWithOpening } = await import("../src/lib/repositories/assets.ts");
      const { postActivity } = await import("../src/lib/finance/service.ts");
      const { readAggregates } = await import("../src/lib/analytics/queries.ts");
      const { database } = await import("../src/lib/db/pool.ts");
      pool = database();
      globalThis.__catalogTestAuthorized = true;
      const list = await catalogs.listCatalog("transactionCategories");
      const dining = list.find((c) => c.systemKey === "food_dining");
      const food = list.find((c) => c.systemKey === "food");
      assert.deepEqual({ parentId: dining.parentId, nature: dining.nature, effectiveNature: dining.effectiveNature, natureOverride: dining.natureOverride },
        { parentId: food.id, nature: "want", effectiveNature: "want", natureOverride: null });
      console.log("contoh listCatalog:", JSON.stringify(dining));
      const mine = await catalogs.insertCustomCategory("Kopi susu", "expense", food.id);
      assert.equal(mine.parentId, food.id); assert.equal(mine.nature, "need"); // mewarisi induk
      await assert.rejects(() => catalogs.insertCustomCategory("Cucu", "expense", mine.id), /two levels/);
      await catalogs.setCategoryNature(mine.id, "saving");
      assert.equal((await catalogs.listCatalog("transactionCategories")).find((c) => c.id === mine.id).effectiveNature, "saving");
      await catalogs.setCategoryNature(mine.id, null);
      assert.equal((await catalogs.listCatalog("transactionCategories")).find((c) => c.id === mine.id).effectiveNature, "need");
      await assert.rejects(() => catalogs.setCategoryNature(list.find((c) => c.systemKey === "salary").id, "need"));

      const type = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
      const wallet = await insertAssetWithOpening({ displayName: "Dompet", currency: "IDR", assetTypeId: type, normallyLiquid: true, normallySpendable: true,
        openingAmountMinor: 1000000n, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass: "asset" });
      const at = "2026-03-10T05:00:00.000Z";
      for (const [categoryId, amountMinor] of [[dining.id, "30000"], [mine.id, "12000"], [food.id, "8000"]]) {
        await postActivity({ kind: "expense", amountMinor, sourceAssetId: wallet, categoryId, occurredAt: at }, randomUUID());
      }
      const client = await pool.connect();
      try {
        const rows = await readAggregates(client, { startAt: "2026-03-01T00:00:00Z", endAt: "2026-04-01T00:00:00Z" }, "IDR");
        const of = (dimension, k) => rows.find((r) => r.dimension === dimension && r.key === k);
        assert.equal(of("category_parent", food.id).expensePrincipalMinor, "50000"); // anak dan induk dikelompokkan ke induk
        assert.equal(of("category_nature", "need").expensePrincipalMinor, "20000");
        assert.equal(of("category_nature", "want").expensePrincipalMinor, "30000");
        assert.equal(of("category", dining.id).expensePrincipalMinor, "30000"); // dimensi lama tidak berubah
        assert.equal(of("summary", "summary").expensePrincipalMinor, "50000");
      } finally { client.release(); }
      hooks.deregister();
    });
  } finally {
    globalThis.__catalogTestAuthorized = false;
    await pool?.end();
    await admin.query("RESET search_path").catch(() => {});
    for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
