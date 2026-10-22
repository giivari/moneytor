import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

const confirmedDatabase = process.env.MONEYTOR_P3_DB_TEST;
const enabled = ["moneta_p2_verify", "moneytor_p4_verify", "moneytor_p5_verify", "moneytor_p51a_verify", "moneytor_p51b_verify"].includes(confirmedDatabase) || /^moneytor_composable_verify_\d+$/.test(confirmedDatabase ?? "");
test("P3 isolated PostgreSQL posting and reversal", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, confirmedDatabase === "moneytor_p4_verify" ? "55434" : "55433");
  assert.equal(target.pathname, `/${confirmedDatabase}`);
  const admin = new pg.Client({ connectionString: target.toString() });
  await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, confirmedDatabase);
  const schema = `p3_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.query(`SET search_path TO ${schema}`);
  let pool;
  try {
    for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = target.toString();
    const hooks = registerHooks({
      resolve(specifier, context, next) {
        if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__financeTestAuthorized)throw new Error('Unauthorized');return {credentialId:'synthetic-test'}}", shortCircuit: true };
        if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return next(specifier, context);
      },
    });
    const { insertAssetWithOpening, listAssets, archiveAsset } = await import("../src/lib/repositories/assets.ts");
    const { insertCustomCatalogItem, insertCustomCategory, renameCustomCatalogItem, archiveCustomCatalogItem, listCatalog } = await import("../src/lib/repositories/catalogs.ts");
    const { postActivity, replaceActivity, voidActivity, listActivities } = await import("../src/lib/finance/service.ts");
    const { database } = await import("../src/lib/db/pool.ts");
    pool = database();
    globalThis.__financeTestAuthorized = true;
    const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const tax = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='tax'")).rows[0].id;
    const service = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='service_fee'")).rows[0].id;
    const adminFee = (await admin.query("SELECT id FROM additional_charge_types WHERE system_key='admin_fee'")).rows[0].id;
    const now = new Date("2026-10-01T08:00:00.000Z");
    const makeAsset = (displayName, openingAmountMinor) => insertAssetWithOpening({
      displayName, currency: "IDR", assetTypeId: typeId, normallyLiquid: true, normallySpendable: true,
      openingAmountMinor, openingEffectiveAt: now,
    });
    const source = await makeAsset("Synthetic source", 1000000n);
    const destination = await makeAsset("Synthetic destination", 0n);
    const usd = await insertAssetWithOpening({ displayName: "Synthetic USD", currency: "USD", assetTypeId: typeId,
      normallyLiquid: false, normallySpendable: false, openingAmountMinor: 12345n, openingEffectiveAt: now });
    await t.test("catalog and opening asset workflow", async () => {
      const provider = await insertCustomCatalogItem("providers", "Synthetic provider");
      const category = await insertCustomCategory("Synthetic expense", "expense");
      assert.equal((await listCatalog("providers")).some((item) => item.id === provider.id), true);
      await renameCustomCatalogItem("providers", provider.id, "Renamed provider");
      assert.equal((await listCatalog("providers")).find((item) => item.id === provider.id).displayName, "Renamed provider");
      await archiveCustomCatalogItem("providers", provider.id);
      assert.equal((await listCatalog("providers")).some((item) => item.id === provider.id), false);
      assert.equal((await listCatalog("providers", true)).some((item) => item.id === provider.id), true);
      assert.equal(category.appliesTo, "expense");
      const customType = await insertCustomCatalogItem("assetTypes", "Synthetic custom type");
      const activeProvider = await insertCustomCatalogItem("providers", "Another synthetic provider");
      const customAsset = await insertAssetWithOpening({ displayName: "Synthetic custom asset", currency: "IDR",
        assetTypeId: customType.id, providerId: activeProvider.id, normallyLiquid: false, normallySpendable: false,
        openingAmountMinor: 0n, openingEffectiveAt: now });
      assert.equal((await listAssets()).find((item) => item.id === customAsset).assetTypeName, "Synthetic custom type");
      assert.equal((await listAssets()).find((item) => item.id === customAsset).providerName, "Another synthetic provider");
      assert.equal((await listAssets()).find((item) => item.id === source).balanceMinor, "1000000");
      assert.equal((await listAssets()).find((item) => item.id === usd).balanceMinor, "12345");
      await assert.rejects(admin.query("UPDATE asset_opening_states SET amount_minor=1 WHERE asset_id=$1", [source]), /immutable/);
      await assert.rejects(admin.query("UPDATE assets SET currency_code='USD' WHERE id=$1", [source]), /cannot change/);
    });
    await t.test("expense base and charges remain separate; idempotent retry", async () => {
      const draft = { kind: "expense", amountMinor: "100000", sourceAssetId: source,
        charges: [{ typeId: tax, amountMinor: "10000" }, { typeId: service, amountMinor: "5000" }, { typeId: adminFee, amountMinor: "2500" }],
        occurredAt: now.toISOString(), note: "Synthetic purchase" };
      const key = randomUUID();
      const id = await postActivity(draft, key);
      assert.equal(await postActivity(draft, key), id);
      await assert.rejects(postActivity({ ...draft, amountMinor: "100001" }, key), /digunakan/);
      const row = (await listActivities()).find((item) => item.id === id);
      assert.equal(row.baseAmountMinor, "100000");
      assert.deepEqual(row.charges.map((item) => item.amountMinor).sort(), ["10000", "2500", "5000"]);
      assert.equal((await listAssets()).find((item) => item.id === source).balanceMinor, "882500");
      assert.equal((await admin.query("SELECT SUM(amount_minor)::text AS total FROM ledger_movements WHERE activity_id=$1", [id])).rows[0].total, "-117500");
      await assert.rejects(admin.query("DELETE FROM ledger_movements WHERE activity_id=$1", [id]), /append-only/);
      const plain = await postActivity({ kind: "expense", amountMinor: "1000", sourceAssetId: source,
        occurredAt: now.toISOString() }, randomUUID());
      assert.equal((await listActivities()).find((item) => item.id === plain).charges.length, 0);
      assert.equal((await listAssets()).find((item) => item.id === source).balanceMinor, "881500");
      const concurrentDraft = { kind: "income", amountMinor: "10", destinationAssetId: destination, occurredAt: now.toISOString() };
      const concurrentKey = randomUUID();
      const both = await Promise.all([postActivity(concurrentDraft, concurrentKey), postActivity(concurrentDraft, concurrentKey)]);
      assert.equal(both[0], both[1]);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM financial_activities WHERE id=$1", [both[0]])).rows[0].count, 1);
    });
    let transferId;
    await t.test("transfer principal zero net, fee sole wealth effect", async () => {
      transferId = await postActivity({ kind: "transfer", amountMinor: "500000", sourceAssetId: source,
        destinationAssetId: destination, transferFeeMinor: "2500", occurredAt: now.toISOString() }, randomUUID());
      const movements = (await admin.query("SELECT component,amount_minor::text FROM ledger_movements WHERE activity_id=$1 ORDER BY component,amount_minor", [transferId])).rows;
      assert.deepEqual(movements.filter((item) => item.component === "principal").map((item) => item.amount_minor), ["-500000", "500000"]);
      assert.equal(movements.find((item) => item.component === "charge").amount_minor, "-2500");
      assert.equal(movements.reduce((sum, item) => sum + BigInt(item.amount_minor), 0n), -2500n);
      const assets = await listAssets();
      assert.equal(assets.find((item) => item.id === source).balanceMinor, "379000");
      assert.equal(assets.find((item) => item.id === destination).balanceMinor, "500010");
      const noFee = await postActivity({ kind: "transfer", amountMinor: "100", sourceAssetId: destination,
        destinationAssetId: source, occurredAt: now.toISOString() }, randomUUID());
      assert.equal((await listActivities()).find((item) => item.id === noFee).charges.length, 0);
      assert.equal((await admin.query("SELECT SUM(amount_minor)::text AS total FROM ledger_movements WHERE activity_id=$1", [noFee])).rows[0].total, "0");
    });
    await t.test("income, correction, void and archived-asset protection", async () => {
      const income = await postActivity({ kind: "income", amountMinor: "10000", destinationAssetId: source,
        occurredAt: now.toISOString() }, randomUUID());
      const corrected = await replaceActivity(income, { kind: "income", amountMinor: "12000", destinationAssetId: source,
        occurredAt: now.toISOString() }, randomUUID());
      assert.equal((await listActivities(true)).find((item) => item.id === income).status, "superseded");
      assert.equal((await listActivities()).some((item) => item.id === income), false);
      assert.equal((await listActivities()).find((item) => item.id === corrected).replacesActivityId, income);
      assert.equal((await listAssets()).find((item) => item.id === source).balanceMinor, "391100");
      const voidKey = randomUUID();
      await voidActivity(corrected, voidKey);
      assert.equal(await voidActivity(corrected, voidKey), corrected);
      assert.equal((await listAssets()).find((item) => item.id === source).balanceMinor, "379100");
      await assert.rejects(voidActivity(corrected, randomUUID()), /tidak aktif/);
      await archiveAsset(destination);
      await assert.rejects(postActivity({ kind: "income", amountMinor: "100", destinationAssetId: destination,
        occurredAt: now.toISOString() }, randomUUID()), /aktif/);
    });
    await t.test("invalid shapes and relations fail atomically", async () => {
      const count = (await admin.query("SELECT count(*)::int AS count FROM financial_activities")).rows[0].count;
      await assert.rejects(postActivity({ kind: "transfer", amountMinor: "100", sourceAssetId: source,
        destinationAssetId: source, occurredAt: now.toISOString() }, randomUUID()), /differ/);
      await assert.rejects(postActivity({ kind: "transfer", amountMinor: "100", sourceAssetId: source,
        destinationAssetId: usd, occurredAt: now.toISOString() }, randomUUID()), /Currency mismatch/);
      await assert.rejects(postActivity({ kind: "expense", amountMinor: "-1", sourceAssetId: source,
        occurredAt: now.toISOString() }, randomUUID()), /lebih dari nol/);
      await assert.rejects(postActivity({ kind: "expense", amountMinor: "100", sourceAssetId: randomUUID(),
        occurredAt: now.toISOString() }, randomUUID()), /aktif/);
      const incomeCategory = (await admin.query("SELECT id FROM transaction_categories WHERE applies_to='income' LIMIT 1")).rows[0].id;
      await assert.rejects(postActivity({ kind: "expense", amountMinor: "100", sourceAssetId: source,
        categoryId: incomeCategory, occurredAt: now.toISOString() }, randomUUID()), /Kategori/);
      assert.equal((await admin.query("SELECT count(*)::int AS count FROM financial_activities")).rows[0].count, count);
      const original = (await admin.query("SELECT id,activity_id,asset_id,currency_code FROM ledger_movements WHERE activity_id=$1 AND component='principal' LIMIT 1", [transferId])).rows[0];
      await assert.rejects(admin.query(`INSERT INTO ledger_movements (id,activity_id,asset_id,currency_code,component,amount_minor,reverses_movement_id)
        VALUES ($1,$2,$3,$4,'reversal',1,$5)`, [randomUUID(), original.activity_id, original.asset_id, original.currency_code, original.id]), /Invalid ledger reversal/);
    });
    await t.test("late database failure rolls back activity, charges and movements", async () => {
      await admin.query(`CREATE FUNCTION reject_test_charge() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.component='charge' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END; $$`);
      await admin.query("CREATE TRIGGER test_charge_failure BEFORE INSERT ON ledger_movements FOR EACH ROW EXECUTE FUNCTION reject_test_charge()");
      const before = (await admin.query("SELECT count(*)::int AS count FROM financial_activities")).rows[0].count;
      try {
        await assert.rejects(postActivity({ kind: "expense", amountMinor: "100", sourceAssetId: source,
          charges: [{ typeId: tax, amountMinor: "10" }], occurredAt: now.toISOString() }, randomUUID()), /synthetic late failure/);
        assert.equal((await admin.query("SELECT count(*)::int AS count FROM financial_activities")).rows[0].count, before);
      } finally {
        await admin.query("DROP TRIGGER test_charge_failure ON ledger_movements");
        await admin.query("DROP FUNCTION reject_test_charge()");
      }
    });
    await t.test("custom categories and charges; owner authorization", async () => {
      const category = await insertCustomCategory("Synthetic groceries", "expense");
      const charge = await insertCustomCatalogItem("chargeTypes", "Synthetic surcharge");
      const id = await postActivity({ kind: "expense", amountMinor: "200", sourceAssetId: source,
        categoryId: category.id, charges: [{ typeId: charge.id, amountMinor: "30" }],
        occurredAt: now.toISOString() }, randomUUID());
      assert.equal((await listActivities()).find((item) => item.id === id).categoryName, "Synthetic groceries");
      assert.equal((await listActivities()).find((item) => item.id === id).charges[0].typeName, "Synthetic surcharge");
      globalThis.__financeTestAuthorized = false;
      await assert.rejects(listAssets(), /Unauthorized/);
      await assert.rejects(listActivities(), /Unauthorized/);
      await assert.rejects(postActivity({ kind: "income", amountMinor: "100", destinationAssetId: source,
        occurredAt: now.toISOString() }, randomUUID()), /Unauthorized/);
      globalThis.__financeTestAuthorized = true;
    });
    hooks.deregister();
  } finally {
    if (pool) await pool.end();
    await admin.query("RESET search_path");
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
