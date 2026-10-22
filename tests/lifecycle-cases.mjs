import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Invoked only by the existing opt-in P4 harness, inside its random test schema.
export async function lifecycleCases(t, { admin, pool, service: s, snapshot, source, typeId, time }) {
  const assets = await import("../src/lib/repositories/assets.ts");
  const catalogs = await import("../src/lib/repositories/catalogs.ts");
  const { lifecycleReferences, deleteUnused } = await import("../src/lib/repositories/lifecycle.ts");
  const finance = await import("../src/lib/finance/service.ts");
  await t.test("lifecycle reference map covers every actual incoming foreign key", async () => {
    for (const [table, references] of Object.entries(lifecycleReferences)) {
      const rows = (await admin.query(`SELECT child.relname AS child,a.attname AS column
        FROM pg_constraint fk JOIN pg_class parent ON parent.oid=fk.confrelid
        JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace n ON n.oid=parent.relnamespace
        CROSS JOIN LATERAL unnest(fk.conkey,fk.confkey) keys(child_key,parent_key)
        JOIN pg_attribute a ON a.attrelid=child.oid AND a.attnum=keys.child_key
        JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=keys.parent_key
        WHERE fk.contype='f' AND n.nspname=current_schema() AND parent.relname=$1 AND pa.attname='id'`, [table])).rows;
      assert.deepEqual(rows.map((r) => `${r.child}/${r.column}`).sort(), references.map((r) => r.join("/")).sort());
    }
  });
  await t.test("asset restore preserves identity, opening, ledger and eligibility for new posting", async () => {
    const before = (await assets.listAssets()).find((a) => a.id === source);
    const opening = (await admin.query("SELECT * FROM asset_opening_states WHERE asset_id=$1", [source])).rows[0];
    await assets.archiveAsset(source);
    assert.equal((await assets.listAssets(false)).some((a) => a.id === source), false);
    await assets.restoreAsset(source); await assets.restoreAsset(source);
    assert.deepEqual((await assets.listAssets()).find((a) => a.id === source), before);
    assert.deepEqual((await admin.query("SELECT * FROM asset_opening_states WHERE asset_id=$1", [source])).rows[0], opening);
    await assert.rejects(admin.query("DELETE FROM assets WHERE id=$1", [source]), /foreign key/);
    const id = await finance.postActivity({ kind: "income", amountMinor: "1", destinationAssetId: source, occurredAt: time }, randomUUID());
    await finance.voidActivity(id, randomUUID());
    assert.equal((await finance.listActivities(true)).find((a) => a.id === id).status, "voided");
    assert.equal((await assets.listAssets()).find((a) => a.id === source).balanceMinor, before.balanceMinor);
  });
  for (const catalog of ["providers", "paymentNetworks", "assetTypes", "assetGroups", "transactionCategories", "chargeTypes", "instrumentTypes"]) {
    await t.test(`${catalog}: restore same ID, rename archived, delete only unused custom, protect defaults`, async () => {
      const row = catalog === "transactionCategories" ? await catalogs.insertCustomCategory("Synthetic lifecycle", "expense") : await catalogs.insertCustomCatalogItem(catalog, "Synthetic lifecycle");
      await assert.rejects(catalogs.deleteCustomCatalogItem(catalog, row.id), /Arsipkan/);
      await catalogs.archiveCustomCatalogItem(catalog, row.id);
      await catalogs.renameCustomCatalogItem(catalog, row.id, "Synthetic renamed archive");
      await catalogs.restoreCustomCatalogItem(catalog, row.id);
      const restored = (await catalogs.listCatalog(catalog)).find((r) => r.id === row.id);
      assert.equal(restored.displayName, "Synthetic renamed archive"); assert.equal(restored.isActive, true);
      await catalogs.archiveCustomCatalogItem(catalog, row.id);
      assert.equal((await catalogs.listCatalog(catalog, true)).find((r) => r.id === row.id).canDelete, true);
      await catalogs.deleteCustomCatalogItem(catalog, row.id);
      assert.equal((await catalogs.listCatalog(catalog, true)).some((r) => r.id === row.id), false);
      const builtin = (await catalogs.listCatalog(catalog)).find((r) => r.isBuiltIn);
      assert.ok(builtin);
      await assert.rejects(catalogs.deleteCustomCatalogItem(catalog, builtin.id), /bawaan/);
      await assert.rejects(catalogs.archiveCustomCatalogItem(catalog, builtin.id));
      await assert.rejects(catalogs.restoreCustomCatalogItem(catalog, builtin.id));
    });
  }
  await t.test("all referenced catalogs resist deletion, including voided history and portfolio-only providers", async () => {
    const created = {};
    for (const catalog of ["providers", "paymentNetworks", "assetTypes", "assetGroups", "chargeTypes", "instrumentTypes"]) created[catalog] = (await catalogs.insertCustomCatalogItem(catalog, "Synthetic used option")).id;
    created.transactionCategories = (await catalogs.insertCustomCategory("Synthetic expense option", "expense")).id;
    const cash = await assets.insertAssetWithOpening({ displayName: "Synthetic lifecycle account", currency: "IDR", assetTypeId: created.assetTypes,
      assetGroupId: created.assetGroups, providerId: created.providers, paymentNetworkId: created.paymentNetworks, normallyLiquid: true,
      normallySpendable: true, openingAmountMinor: 10000n, openingEffectiveAt: new Date(time) });
    const event = await finance.postActivity({ kind: "expense", sourceAssetId: cash, amountMinor: "100", categoryId: created.transactionCategories,
      charges: [{ typeId: created.chargeTypes, amountMinor: "10" }], occurredAt: time }, randomUUID());
    await finance.voidActivity(event, randomUUID());
    await s.createInstrument({ displayName: "Synthetic type reference", currency: "IDR", typeId: created.instrumentTypes });
    for (const [catalog, id] of Object.entries(created)) {
      await catalogs.archiveCustomCatalogItem(catalog, id);
      await assert.rejects(catalogs.deleteCustomCatalogItem(catalog, id), /referensi/);
      assert.equal((await catalogs.listCatalog(catalog, true)).find((r) => r.id === id).canDelete, false);
    }
    // Metadata edits can retain archived catalog identities, but not select new ones.
    await assets.updateAsset(cash, { displayName: "Synthetic revised account", assetTypeId: created.assetTypes, assetGroupId: created.assetGroups,
      providerId: created.providers, paymentNetworkId: created.paymentNetworks, normallyLiquid: true, normallySpendable: true });
    const provider = (await catalogs.insertCustomCatalogItem("providers", "Synthetic portfolio only")).id;
    await s.createPortfolio({ displayName: "Synthetic provider reference", currency: "IDR", providerId: provider });
    await catalogs.archiveCustomCatalogItem("providers", provider);
    await assert.rejects(catalogs.deleteCustomCatalogItem("providers", provider), /referensi/);
    await assert.rejects(admin.query("DELETE FROM assets WHERE id=$1", [cash]), /foreign key/);
  });
  await t.test("portfolio/instrument restore retains holdings and history and allows new trades", async () => {
    const p = await s.createPortfolio({ displayName: "Synthetic restored portfolio", currency: "IDR" });
    const i = await s.createInstrument({ displayName: "Synthetic restored instrument", currency: "IDR", typeId });
    await s.createOpeningPosition({ portfolioId: p, instrumentId: i, quantity: "2", costBasisMinor: "100", occurredAt: time }, randomUUID());
    await s.saveMarketPrice({ instrumentId: i, price: "50", asOf: time }, randomUUID());
    const before = (await snapshot()).holdings.find((h) => h.portfolioId === p && h.instrumentId === i);
    await s.archiveInvestment("portfolio", p); await s.archiveInvestment("instrument", i);
    const archived = await snapshot();
    assert.equal(archived.holdings.find((h) => h.portfolioId === p).quantity, "2");
    assert.equal(archived.portfolios.find((r) => r.id === p).canDelete, false);
    assert.equal(archived.instruments.find((r) => r.id === i).canDelete, false);
    await assert.rejects(s.deleteInvestment("portfolio", p), /referensi/);
    await assert.rejects(s.deleteInvestment("instrument", i), /referensi/);
    await s.restoreInvestment("portfolio", p); await s.restoreInvestment("instrument", i);
    assert.deepEqual((await snapshot()).holdings.find((h) => h.portfolioId === p && h.instrumentId === i), before);
    const trade = await s.postInvestmentTrade({ portfolioId: p, instrumentId: i, cashAssetId: source, kind: "buy", quantity: "1", unitPrice: "50", feeMinor: "0", occurredAt: time }, randomUUID());
    await s.voidInvestmentTrade(trade, randomUUID());
    assert.equal((await snapshot()).trades.find((r) => r.id === trade).status, "voided");
    await assert.rejects(admin.query("DELETE FROM investment_transactions WHERE id=$1", [trade]), /history/i);
    await assert.rejects(admin.query("DELETE FROM investment_opening_positions WHERE portfolio_id=$1", [p]), /append-only/);
  });
  await t.test("unused archived portfolio/instrument can be deleted; price-only and zero-position history cannot", async () => {
    const p = await s.createPortfolio({ displayName: "Synthetic accidental portfolio", currency: "IDR" });
    const i = await s.createInstrument({ displayName: "Synthetic accidental instrument", currency: "IDR", typeId });
    await assert.rejects(s.deleteInvestment("portfolio", p), /Arsipkan/);
    await s.archiveInvestment("portfolio", p); await s.archiveInvestment("instrument", i);
    const before = await snapshot(); assert.equal(before.portfolios.find((r) => r.id === p).canDelete, true); assert.equal(before.instruments.find((r) => r.id === i).canDelete, true);
    await s.deleteInvestment("portfolio", p); await s.deleteInvestment("instrument", i);
    const after = await snapshot(); assert.equal(after.portfolios.some((r) => r.id === p), false); assert.equal(after.instruments.some((r) => r.id === i), false);
    const priceOnly = await s.createInstrument({ displayName: "Synthetic price only", currency: "IDR", typeId });
    await s.saveMarketPrice({ instrumentId: priceOnly, price: "1", asOf: time }, randomUUID());
    await s.archiveInvestment("instrument", priceOnly); await assert.rejects(s.deleteInvestment("instrument", priceOnly), /referensi/);
    const oldTrade = (await snapshot()).trades.find((r) => r.status === "voided");
    await s.archiveInvestment("instrument", oldTrade.instrumentId); await assert.rejects(s.deleteInvestment("instrument", oldTrade.instrumentId), /referensi/);
    await s.restoreInvestment("instrument", oldTrade.instrumentId);
  });
  await t.test("manual correction is appended, deterministic, retry-safe and does not overwrite provider history", async () => {
    const i = await s.createInstrument({ displayName: "Synthetic corrected quote", currency: "IDR", typeId });
    const original = await s.saveMarketPrice({ instrumentId: i, price: "999999", asOf: time }, randomUUID());
    const key = randomUUID(), corrected = await s.correctManualPrice(original, "100", key);
    assert.equal(await s.correctManualPrice(original, "100", key), corrected);
    await assert.rejects(s.correctManualPrice(original, "101", randomUUID()), /digantikan/);
    await assert.rejects(s.correctManualPrice(original, "0", randomUUID()), /nol/);
    const prices = (await snapshot()).prices.filter((r) => r.instrumentId === i);
    assert.equal(prices.length, 2); assert.equal(prices[0].id, corrected); assert.equal(prices[0].asOf, prices[1].asOf);
    assert.equal(prices[1].price, "999999"); assert.equal(prices[0].price, "100");
    const provider = await s.saveMarketPrice({ instrumentId: i, price: "120", asOf: "2025-01-03T08:00:00.000Z" }, randomUUID(), { id: "synthetic-provider", currency: "IDR" });
    await assert.rejects(s.correctManualPrice(provider, "110", randomUUID()), /manual/);
    await s.correctManualPrice(corrected, "90", randomUUID());
    assert.equal((await snapshot()).prices.find((r) => r.instrumentId === i).id, provider);
    await assert.rejects(admin.query("DELETE FROM investment_price_points WHERE id=$1", [original]), /append-only/);
  });
  await t.test("concurrent restore/delete serialize without orphaning or deleting a restored row", async () => {
    const row = await catalogs.insertCustomCatalogItem("assetGroups", "Synthetic race");
    await catalogs.archiveCustomCatalogItem("assetGroups", row.id);
    const outcomes = await Promise.allSettled([catalogs.restoreCustomCatalogItem("assetGroups", row.id), catalogs.deleteCustomCatalogItem("assetGroups", row.id)]);
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
    const remaining = (await catalogs.listCatalog("assetGroups", true)).find((r) => r.id === row.id);
    assert.ok(!remaining || remaining.isActive);
    const p = await s.createPortfolio({ displayName: "Synthetic investment race", currency: "IDR" });
    await s.archiveInvestment("portfolio", p);
    const results = await Promise.allSettled([s.restoreInvestment("portfolio", p), s.deleteInvestment("portfolio", p)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  });
  await t.test("foreign-key insertion racing a delete cannot create an orphan", async () => {
    const row = await catalogs.insertCustomCatalogItem("assetGroups", "Synthetic FK race");
    await catalogs.archiveCustomCatalogItem("assetGroups", row.id);
    const deleter = await pool.connect(), inserter = await pool.connect();
    try {
      await deleter.query("BEGIN"); await deleteUnused(deleter, "asset_groups", row.id, true);
      const result = inserter.query("INSERT INTO assets (id,display_name,asset_type_id,asset_group_id,currency_code) VALUES ($1,'Synthetic racing dependency',$2,$3,'IDR')", [randomUUID(), (await catalogs.listCatalog("assetTypes"))[0].id, row.id]).then(() => null, (error) => error);
      await deleter.query("COMMIT"); assert.equal((await result).code, "23503");
    } finally { await deleter.query("ROLLBACK"); deleter.release(); inserter.release(); }
  });
  await t.test("every new public lifecycle mutation requires owner authorization", async () => {
    globalThis.__investmentTestAuthorized = false;
    try {
      await assert.rejects(assets.restoreAsset(source), /Unauthorized/);
      await assert.rejects(catalogs.restoreCustomCatalogItem("instrumentTypes", typeId), /Unauthorized/);
      await assert.rejects(catalogs.deleteCustomCatalogItem("instrumentTypes", typeId), /Unauthorized/);
      await assert.rejects(s.restoreInvestment("portfolio", randomUUID()), /Unauthorized/);
      await assert.rejects(s.deleteInvestment("instrument", randomUUID()), /Unauthorized/);
      await assert.rejects(s.correctManualPrice(randomUUID(), "1", randomUUID()), /Unauthorized/);
    } finally { globalThis.__investmentTestAuthorized = true; }
  });
}
