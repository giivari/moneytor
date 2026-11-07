// scripts/user-migrate-core.mjs pada fixture SINTETIS (bukan data salinan pengguna). Isolated PostgreSQL 16 only (container 55434):
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_credit_verify npm run test:usermigrate:db
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { parseCsv, runUserMigrate, assertSafeTarget } from "../scripts/user-migrate-core.mjs";

const enabled = process.env.MONEYTOR_CREDIT_DB_TEST === "moneytor_credit_verify";

test("parseCsv dan pengaman target", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [{ a: "x, y", b: "2" }]);
  assert.deepEqual(parseCsv("a,b\n"), []);
  assert.doesNotThrow(() => assertSafeTarget(new URL("postgres://u:p@127.0.0.1:55435/moneytor_prod_copy"), ["--apply", "--confirm-db=moneytor_prod_copy"]));
  assert.throws(() => assertSafeTarget(new URL("postgres://u:p@127.0.0.1:55434/moneytor_prod_copy"), []), /55435/);
  assert.throws(() => assertSafeTarget(new URL("postgres://u:p@ep-x.neon.tech:5432/neondb"), []), /127\.0\.0\.1/);
  assert.throws(() => assertSafeTarget(new URL("postgres://u:p@127.0.0.1:55435/moneytor_prod_copy"), ["--apply"]), /confirm-db/);
});

test("user-migrate pada fixture sintetis (PostgreSQL terisolasi)", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55434");
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  const schema = `um_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query(`CREATE SCHEMA ${schema}`); await client.query(`SET search_path TO ${schema}`);
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await client.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    const one = async (sql, p = []) => (await client.query(sql, p)).rows[0];
    const typeId = (await one("SELECT id FROM asset_types WHERE system_key='bank_account'")).id;
    const wallet = randomUUID(), debt = randomUUID();
    for (const [id, name, cls] of [[wallet, "Dompet", "asset"], [debt, "Utang awal", "liability"]]) {
      await client.query("INSERT INTO assets (id,display_name,asset_type_id,currency_code,normally_liquid,normally_spendable,asset_class) VALUES ($1,$2,$3,'IDR',$4,$4,$5)", [id, name, typeId, cls === "asset", cls]);
      await client.query("INSERT INTO asset_opening_states (asset_id,amount_minor,effective_at) VALUES ($1,$2,'2026-01-01')", [id, cls === "asset" ? 1000000 : 0]);
    }
    const custom = async (name, scope, parent = null) => {
      const id = randomUUID();
      await client.query("INSERT INTO transaction_categories (id,display_name,applies_to,parent_id) VALUES ($1,$2,$3,$4)", [id, name, scope, parent]);
      return id;
    };
    const spend = async (cat, amount, at) => {
      const id = randomUUID();
      await client.query("INSERT INTO financial_activities (id,kind,base_amount_minor,currency_code,source_asset_id,category_id,category_kind,occurred_at) VALUES ($1,'expense',$2,'IDR',$3,$4,'expense',$5)", [id, amount, wallet, cat, at]);
      await client.query("INSERT INTO ledger_movements (id,activity_id,asset_id,currency_code,component,amount_minor) VALUES ($1,$2,$3,'IDR','principal',$4)", [randomUUID(), id, wallet, -amount]);
    };
    const gaji = await custom("Gaji", "income"), rt = await custom("Rumah Tangga", "expense"), komunikasi = await custom("Komunikasi", "expense");
    const health = (await one("SELECT id FROM transaction_categories WHERE system_key='health'")).id;
    // Penandaan runtime lama: kategori pengguna "Biaya Admin Rekening" menjadi bawaan dengan kunci bank_admin_fee.
    const legacyAdmin = randomUUID();
    await client.query("INSERT INTO transaction_categories (id,display_name,applies_to,is_builtin,system_key) VALUES ($1,'Biaya Admin Rekening','expense',true,'bank_admin_fee')", [legacyAdmin]);
    const sudah = await custom("Wellbeing", "expense", health); // sudah punya induk: dilewati
    await spend(legacyAdmin, 6500, "2026-10-06T05:00:00Z"); await spend(rt, 150000, "2026-10-05T05:00:00Z"); await spend(sudah, 40000, "2026-10-31T17:30:00Z");
    const dump = async () => JSON.stringify((await client.query("SELECT * FROM transaction_categories ORDER BY id")).rows);
    const rows = [
      { nama_kategori: "Gaji", applies_to: "income", induk_system_key: "salary", aksi: "map" },
      { nama_kategori: "Rumah Tangga", applies_to: "expense", induk_system_key: "housing", aksi: "map" },
      { nama_kategori: "Wellbeing", applies_to: "expense", induk_system_key: "health", aksi: "map" },
      { nama_kategori: "Komunikasi", applies_to: "expense", induk_system_key: "", aksi: "nonaktifkan" },
      { nama_kategori: "Biaya Admin Rekening", applies_to: "expense", induk_system_key: "finance_fees", aksi: "map" },
    ];

    await t.test("dry-run tidak mengubah apa pun dan melaporkan rencana", async () => {
      const before = await dump();
      const report = await runUserMigrate(client, { mapRows: rows, debtRows: [], apply: false });
      assert.equal(await dump(), before);
      assert.equal(report.applied, false); assert.equal(report.identical, true);
      assert.deepEqual(report.counts, { mapped: 3, skipped: 1, deactivated: 1, debts: 0 });
    });

    await t.test("apply mengisi parent_id (NULL -> nilai) tanpa memindah transaksi; saldo dan total bulanan identik", async () => {
      const txBefore = (await client.query("SELECT id,category_id FROM financial_activities ORDER BY id")).rows;
      const report = await runUserMigrate(client, { mapRows: rows, debtRows: [], apply: true });
      assert.equal(report.applied, true); assert.equal(report.identical, true);
      assert.equal((await one("SELECT parent_id FROM transaction_categories WHERE id=$1", [gaji])).parent_id, (await one("SELECT id FROM transaction_categories WHERE system_key='salary'")).id);
      assert.equal((await one("SELECT parent_id FROM transaction_categories WHERE id=$1", [rt])).parent_id, (await one("SELECT id FROM transaction_categories WHERE system_key='housing'")).id);
      assert.equal((await one("SELECT parent_id FROM transaction_categories WHERE id=$1", [sudah])).parent_id, health);
      assert.equal((await one("SELECT is_active FROM transaction_categories WHERE id=$1", [komunikasi])).is_active, false);
      const admin = await one("SELECT parent_id,system_key,is_builtin FROM transaction_categories WHERE id=$1", [legacyAdmin]);
      assert.equal(admin.parent_id, (await one("SELECT id FROM transaction_categories WHERE system_key='finance_fees'")).id);
      assert.deepEqual([admin.system_key, admin.is_builtin], ["bank_admin_fee", true]); // identitas tidak berubah
      assert.deepEqual((await client.query("SELECT id,category_id FROM financial_activities ORDER BY id")).rows, txBefore);
    });

    await t.test("apply kedua sama dengan sekali: tidak ada perubahan", async () => {
      const after = await dump();
      const report = await runUserMigrate(client, { mapRows: rows, debtRows: [], apply: true });
      assert.deepEqual(report.counts, { mapped: 0, skipped: 5, deactivated: 0, debts: 0 });
      assert.equal(await dump(), after);
    });

    await t.test("nonaktifkan kategori yang dipakai transaksi, atau nama tak dikenal, ditolak dan tidak mengubah apa pun", async () => {
      const before = await dump();
      await assert.rejects(() => runUserMigrate(client, { mapRows: [{ nama_kategori: "Rumah Tangga", applies_to: "expense", induk_system_key: "", aksi: "nonaktifkan" }], debtRows: [], apply: true }), /dipakai/);
      await assert.rejects(() => runUserMigrate(client, { mapRows: [{ nama_kategori: "Tidak Ada", applies_to: "expense", induk_system_key: "housing", aksi: "map" }], debtRows: [], apply: true }), /tidak ditemukan/);
      await assert.rejects(() => runUserMigrate(client, { mapRows: [{ nama_kategori: "Gaji", applies_to: "income", induk_system_key: "tidak_ada", aksi: "map" }], debtRows: [], apply: true }), /induk/i);
      assert.equal(await dump(), before);
    });

    await t.test("utang awal: adjustment opening_debt sekali (idempoten), saldo berubah tepat sebesar nominal, bukan pengeluaran", async () => {
      const debts = [{ asset_id: debt, amount_minor: "800000", occurred_at: "2026-10-30T05:00:00Z" }];
      const bal = async (id) => (await one("SELECT (o.amount_minor + COALESCE((SELECT sum(amount_minor) FROM ledger_movements WHERE asset_id=a.id),0))::text AS v FROM assets a JOIN asset_opening_states o ON o.asset_id=a.id WHERE a.id=$1", [id])).v;
      const dry = await runUserMigrate(client, { mapRows: [], debtRows: debts, apply: false });
      assert.equal(dry.counts.debts, 1); assert.equal(await bal(debt), "0");
      const first = await runUserMigrate(client, { mapRows: [], debtRows: debts, apply: true });
      assert.equal(first.identical, true); assert.equal(await bal(debt), "-800000");
      assert.equal((await one("SELECT count(*)::int AS n FROM financial_activities WHERE kind='adjustment' AND adjustment_reason='opening_debt'")).n, 1);
      const second = await runUserMigrate(client, { mapRows: [], debtRows: debts, apply: true });
      assert.equal(second.counts.debts, 0); assert.equal(await bal(debt), "-800000");
      assert.equal((await one("SELECT (SELECT count(*) FROM spending_effects WHERE activity_id IN (SELECT id FROM financial_activities WHERE kind='adjustment'))::int AS n")).n, 0);
      await assert.rejects(() => runUserMigrate(client, { mapRows: [], debtRows: [{ asset_id: wallet, amount_minor: "5", occurred_at: "2026-10-30T05:00:00Z" }], apply: true }), /liability/);
    });
  } finally {
    await client.query("RESET search_path").catch(() => {});
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.end();
  }
});
