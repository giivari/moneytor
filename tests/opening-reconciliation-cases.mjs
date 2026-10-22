import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function openingReconciliationCases(t, { admin, service, assets, finance, snapshot, openingHistory, financeSnapshot, time }) {
  const typeId = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
  const assetId = await assets.insertAssetWithOpening({ displayName: "Synthetic opening reconciliation cash", currency: "IDR", assetTypeId: typeId,
    normallyLiquid: true, normallySpendable: true, openingAmountMinor: 1000000n, openingEffectiveAt: new Date(time) });
  const unrelatedId = await assets.insertAssetWithOpening({ displayName: "Synthetic unrelated cash", currency: "IDR", assetTypeId: typeId,
    normallyLiquid: true, normallySpendable: true, openingAmountMinor: 12345n, openingEffectiveAt: new Date(time) });
  const movement = await finance.postActivity({ kind: "expense", amountMinor: "100000", sourceAssetId: assetId, occurredAt: time }, randomUUID());
  const assetBalance = async () => (await assets.listAssets()).find((a) => a.id === assetId).balanceMinor;
  await t.test("asset opening correction changes effective opening, not the original or ledger", async () => {
    const wealthBefore = (await financeSnapshot()).currencies.find((row) => row.currency === "IDR");
    const beforeLedger = (await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n;
    const beforeActivities = (await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n;
    const key = randomUUID(), draft = { assetId, expectedMinor: "1000000", correctedMinor: "10000000", note: "Synthetic entry mistake", idempotencyKey: key };
    const id = await assets.correctAssetOpening(draft);
    assert.equal(await assets.correctAssetOpening(draft), id);
    assert.equal(await assetBalance(), "9900000");
    const wealthAfter = (await financeSnapshot()).currencies.find((row) => row.currency === "IDR");
    assert.equal(BigInt(wealthAfter.totalMinor) - BigInt(wealthBefore.totalMinor), 9000000n);
    assert.equal(wealthAfter.expenseMinor, wealthBefore.expenseMinor);
    assert.equal((await assets.listAssetBalances()).find((a) => a.assetId === assetId).balance.amountMinor.toString(), "9900000");
    const history = await assets.assetOpeningHistory(assetId);
    assert.equal(history.originalMinor, "1000000"); assert.equal(history.effectiveMinor, "10000000"); assert.equal(history.corrections.length, 1);
    assert.equal((await admin.query("SELECT amount_minor::text FROM asset_opening_states WHERE asset_id=$1", [assetId])).rows[0].amount_minor, "1000000");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n, beforeLedger);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n, beforeActivities);
    assert.equal((await assets.listAssets()).find((a) => a.id === unrelatedId).balanceMinor, "12345");
    assert.equal((await finance.listActivities()).some((a) => a.id === movement), true);
    await assert.rejects(admin.query("UPDATE asset_opening_corrections SET corrected_amount_minor=1 WHERE id=$1", [id]), /immutable|append-only/);
    await assert.rejects(admin.query("DELETE FROM asset_opening_corrections WHERE id=$1", [id]), /immutable|append-only/);
  });
  await t.test("repeated, stale, concurrent, invalid and archived asset correction guards", async () => {
    await assert.rejects(assets.correctAssetOpening({ assetId, expectedMinor: "1000000", correctedMinor: "2000000", idempotencyKey: randomUUID() }), /berubah/);
    const candidate = (n) => ({ assetId, expectedMinor: "10000000", correctedMinor: n, idempotencyKey: randomUUID() });
    const concurrent = await Promise.allSettled([assets.correctAssetOpening(candidate("11000000")), assets.correctAssetOpening(candidate("12000000"))]);
    assert.equal(concurrent.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((r) => r.status === "rejected").length, 1);
    const current = (await assets.assetOpeningHistory(assetId)).effectiveMinor;
    const history = await assets.assetOpeningHistory(assetId);
    assert.equal(history.corrections.length, 2);
    assert.equal(history.corrections[1].correctedMinor, "10000000");
    await assert.rejects(assets.correctAssetOpening({ assetId, expectedMinor: current, correctedMinor: "-1", idempotencyKey: randomUUID() }));
    await assert.rejects(assets.correctAssetOpening({ assetId, expectedMinor: current, correctedMinor: current, idempotencyKey: randomUUID() }), /berbeda/);
    await assets.archiveAsset(assetId);
    await assert.rejects(assets.correctAssetOpening({ assetId, expectedMinor: current, correctedMinor: "13000000", idempotencyKey: randomUUID() }), /Pulihkan/);
    await assets.restoreAsset(assetId);
  });

  const portfolioId = await service.createPortfolio({ displayName: "Synthetic reconciliation portfolio", currency: "IDR" });
  const investmentType = (await admin.query("SELECT id FROM investment_instrument_types WHERE system_key='stock'")).rows[0].id;
  const instrumentId = await service.createInstrument({ displayName: "Synthetic reconciliation instrument", currency: "IDR", typeId: investmentType });
  const openingId = await service.createOpeningPosition({ portfolioId, instrumentId, quantity: "10", costBasisMinor: "1000", occurredAt: time, initialPrice: "100" }, randomUUID());
  await service.postInvestmentTrade({ kind: "buy", portfolioId, instrumentId, cashAssetId: assetId, quantity: "5", unitPrice: "100", feeMinor: "0", occurredAt: "2025-01-02T08:00:00.000Z" }, randomUUID());
  await service.postInvestmentTrade({ kind: "sell", portfolioId, instrumentId, cashAssetId: assetId, quantity: "8", unitPrice: "150", feeMinor: "0", occurredAt: "2025-01-03T08:00:00.000Z" }, randomUUID());
  const holding = async () => (await snapshot()).holdings.find((h) => h.portfolioId === portfolioId && h.instrumentId === instrumentId);
  await t.test("investment correction replays buys and sells while retaining opening identity, cash and price", async () => {
    const cashBefore = await assetBalance();
    const movementsBefore = (await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n;
    const openingBefore = (await admin.query("SELECT * FROM investment_opening_positions WHERE id=$1", [openingId])).rows[0];
    const before = await holding(); assert.equal(before.quantity, "7");
    const beforePrices = (await admin.query("SELECT count(*)::int AS n FROM investment_price_points WHERE instrument_id=$1", [instrumentId])).rows[0].n;
    const draft = { openingId, expectedQuantity: "10", expectedCostBasisMinor: "1000", quantity: "12", costBasisMinor: "1500", note: "Synthetic correction" };
    const key = randomUUID(); const id = await service.correctInvestmentOpening(draft, key);
    assert.equal(await service.correctInvestmentOpening(draft, key), id);
    const after = await holding(); assert.equal(after.quantity, "9"); assert.equal(after.opening.id, openingId);
    assert.equal(after.opening.originalQuantity, "10"); assert.equal(after.opening.quantity, "12");
    assert.equal(after.opening.costBasisMinor, "1500");
    assert.equal(after.price.price, before.price.price); assert.notEqual(after.costBasisMinor, before.costBasisMinor);
    assert.notEqual(after.realizedMinor, before.realizedMinor);
    assert.notEqual(after.unrealizedMinor, before.unrealizedMinor);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM investment_price_points WHERE instrument_id=$1", [instrumentId])).rows[0].n, beforePrices);
    assert.equal(await assetBalance(), cashBefore);
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM ledger_movements")).rows[0].n, movementsBefore);
    assert.deepEqual((await admin.query("SELECT * FROM investment_opening_positions WHERE id=$1", [openingId])).rows[0], openingBefore);
    assert.equal((await admin.query("SELECT quantity::text,cost_basis_minor::text FROM investment_opening_positions WHERE id=$1", [openingId])).rows[0].quantity, "10.000000000000000000");
    const full = await snapshot(), lean = await financeSnapshot(); assert.deepEqual(lean.investment.totals, full.totals);
    assert.equal((await openingHistory(openingId)).length, 1);
    await assert.rejects(admin.query("UPDATE investment_opening_corrections SET corrected_quantity=1 WHERE id=$1", [id]), /append-only/);
  });
  await t.test("historical oversell and bad correction roll back; stale and duplicate keys are rejected", async () => {
    const before = await holding();
    const base = { openingId, expectedQuantity: "12", expectedCostBasisMinor: "1500", quantity: "2", costBasisMinor: "200" };
    await assert.rejects(service.correctInvestmentOpening(base, randomUUID()), /Tersedia hanya/);
    assert.equal((await holding()).quantity, before.quantity);
    assert.equal((await openingHistory(openingId)).length, 1);
    await assert.rejects(service.correctInvestmentOpening({ ...base, quantity: "0" }, randomUUID()), /lebih dari nol/);
    await assert.rejects(service.correctInvestmentOpening({ ...base, quantity: "13", costBasisMinor: "-1" }, randomUUID()));
    await assert.rejects(service.correctInvestmentOpening({ ...base, quantity: "13", costBasisMinor: "1300", expectedQuantity: "10" }, randomUUID()), /berubah/);
    const key = randomUUID(), valid = { ...base, quantity: "13", costBasisMinor: "1300" };
    await service.correctInvestmentOpening(valid, key);
    assert.equal((await openingHistory(openingId)).length, 2);
    await assert.rejects(service.correctInvestmentOpening({ ...valid, quantity: "14" }, key), /Kunci/);
    assert.equal((await holding()).quantity, "10");
    await service.archiveInvestment("instrument", instrumentId);
    await assert.rejects(service.correctInvestmentOpening({ ...valid, expectedQuantity: "13", expectedCostBasisMinor: "1300", quantity: "14" }, randomUUID()), /aktif/);
    await service.restoreInvestment("instrument", instrumentId);
  });
  await t.test("new correction mutations require owner authorization", async () => {
    globalThis.__investmentTestAuthorized = false;
    try {
      await assert.rejects(assets.correctAssetOpening({ assetId, expectedMinor: (await admin.query("SELECT corrected_amount_minor::text AS value FROM asset_opening_corrections WHERE asset_id=$1 ORDER BY correction_order DESC LIMIT 1", [assetId])).rows[0].value,
        correctedMinor: "14000000", idempotencyKey: randomUUID() }), /Unauthorized/);
      await assert.rejects(service.correctInvestmentOpening({ openingId, expectedQuantity: "13", expectedCostBasisMinor: "1300", quantity: "14", costBasisMinor: "1400" }, randomUUID()), /Unauthorized/);
    } finally { globalThis.__investmentTestAuthorized = true; }
  });
}
