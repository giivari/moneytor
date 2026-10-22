import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";
import { lifecycleCases } from "./lifecycle-cases.mjs";
import { openingReconciliationCases } from "./opening-reconciliation-cases.mjs";
const confirmedDatabase = process.env.MONEYTOR_P4_DB_TEST;
const enabled = ["moneytor_p4_verify", "moneytor_p5_verify", "moneytor_p51a_verify", "moneytor_p51b_verify"].includes(confirmedDatabase) || /^moneytor_composable_verify_\d+$/.test(confirmedDatabase ?? "");
test("P4 isolated disposable PostgreSQL investment engine", { skip: !enabled }, async (t) => {
  const target = new URL(process.env.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, confirmedDatabase === "moneytor_p4_verify" ? "55434" : "55433"); assert.equal(target.pathname, `/${confirmedDatabase}`);
  const admin = new pg.Client({ connectionString: target.toString() }); await admin.connect();
  assert.equal((await admin.query("SELECT current_database() AS name")).rows[0].name, confirmedDatabase);
  const schema = `p4_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
  let pool, hooks;
  try {
    for (const file of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
      await admin.query(await readFile(new URL(`../db/migrations/${file}`, import.meta.url), "utf8"));
    }
    target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
    globalThis.__investmentTestAuthorized = true;
    hooks = registerHooks({ resolve(specifier, context, next) {
      if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){if(!globalThis.__investmentTestAuthorized)throw new Error('Unauthorized');await globalThis.__investmentAuthProbe?.();return {credentialId:'synthetic-test'}}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith("./") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts")) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    }});
    const s = await import("../src/lib/investments/service.ts");
    const { investmentSnapshot, investmentOpeningHistory } = await import("../src/lib/investments/read.ts");
    const { financeSnapshot, monthlyExpenses } = await import("../src/lib/finance/summary.ts");
    const assets = await import("../src/lib/repositories/assets.ts");
    const { insertAssetWithOpening, listAssets } = assets;
    const finance = await import("../src/lib/finance/service.ts");
    const { postActivity, listActivities } = finance;
    const { database } = await import("../src/lib/db/pool.ts"); pool = database();
    const time = "2025-01-01T08:00:00.000Z", time2 = "2025-01-02T08:00:00.000Z", time3 = "2025-01-03T08:00:00.000Z";
    const assetType = (await admin.query("SELECT id FROM asset_types WHERE system_key='bank_account'")).rows[0].id;
    const source = await insertAssetWithOpening({ displayName: "Synthetic investment cash", currency: "IDR", assetTypeId: assetType, normallyLiquid: true, normallySpendable: true, openingAmountMinor: 10000000n, openingEffectiveAt: new Date(time) });
    const typeId = await s.createInstrumentType("Synthetic fractional instrument");
    const providerId = randomUUID(); await admin.query("INSERT INTO financial_providers (id,display_name) VALUES ($1,'Synthetic broker')", [providerId]);
    const portfolioId = await s.createPortfolio({ displayName: "Synthetic portfolio", currency: "IDR", providerId });
    const instrumentId = await s.createInstrument({ displayName: "Synthetic security", currency: "IDR", typeId });
    const initialInstrument = await s.createInstrument({ displayName: "Synthetic prior holding", currency: "IDR", typeId });
    const draft = (kind, quantity, unitPrice, feeMinor = "0", occurredAt = time, instrument = instrumentId) => ({ kind, portfolioId, instrumentId: instrument, cashAssetId: source, quantity, unitPrice, feeMinor, occurredAt });
    const holding = async (instrument = instrumentId) => (await investmentSnapshot()).holdings.find((h) => h.instrumentId === instrument && h.portfolioId === portfolioId);
    const balance = async () => (await listAssets()).find((a) => a.id === source).balanceMinor;
    const counts = async () => (await admin.query("SELECT (SELECT count(*)::int FROM investment_transactions) AS trades,(SELECT count(*)::int FROM ledger_movements) AS movements,(SELECT count(*)::int FROM investment_operations) AS operations")).rows[0];
    let buy, sell, secondBuy, fullSell;
    await t.test("custom catalogs and same-owner portfolio/instrument creation", async () => {
      const snapshot = await investmentSnapshot(); assert.equal(snapshot.portfolios[0].providerName, "Synthetic broker");
      assert.equal(snapshot.instruments.find((i) => i.id === instrumentId).symbol, null);
      assert.equal(snapshot.instrumentTypes.some((i) => i.id === typeId && !i.isBuiltIn), true);
    });
    await t.test("opening quantity and cost basis without any cash movement", async () => {
      const key = randomUUID(), opening = { portfolioId, instrumentId: initialInstrument, quantity: "5", costBasisMinor: "500000", occurredAt: time, initialPrice: "100000" };
      const id = await s.createOpeningPosition(opening, key); assert.equal(await s.createOpeningPosition(opening, key), id);
      assert.equal((await holding(initialInstrument)).quantity, "5"); assert.equal((await holding(initialInstrument)).costBasisMinor, "500000");
      assert.equal(await balance(), "10000000"); assert.equal((await counts()).movements, 0);
      await assert.rejects(admin.query("UPDATE investment_opening_positions SET cost_basis_minor=1 WHERE id=$1", [id]), /append-only/);
    });
    await t.test("Buy atomically decreases cash and includes acquisition fee", async () => {
      await s.saveMarketPrice({ instrumentId, price: "100000", asOf: time }, randomUUID());
      buy = await s.postInvestmentTrade(draft("buy", "20", "100000", "5000"), randomUUID());
      const p = await holding(); assert.equal(p.quantity, "20"); assert.equal(p.costBasisMinor, "2005000"); assert.equal(await balance(), "7995000");
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM financial_activities")).rows[0].n, 0);
    });
    await t.test("wealth counts principal once and only fee reduces immediate value", async () => {
      const wealth = await financeSnapshot(); const idr = wealth.currencies.find((c) => c.currency === "IDR");
      assert.equal(idr.totalMinor, "10495000"); assert.equal(idr.liquidMinor, "7995000"); assert.equal(idr.expenseMinor, "0");
      // Initial wealth: 10m cash + 500k prior holding. Purchase conversion leaves only 5k fee loss.
    });
    await t.test("concurrent wealth snapshots do not exhaust the session connection pool", async () => {
      // Exercise authentication's separate DB connection without mocking a real passkey ceremony.
      globalThis.__investmentAuthProbe = () => pool.query("SELECT 1");
      try {
        const snapshots = await Promise.all(Array.from({ length: 7 }, () => financeSnapshot()));
        assert.equal(snapshots.every((snapshot) => snapshot.currencies.find((c) => c.currency === "IDR").totalMinor === "10495000"), true);
      } finally { delete globalThis.__investmentAuthProbe; }
    });
    await t.test("second Buy computes weighted average acquisition cost", async () => {
      secondBuy = await s.postInvestmentTrade(draft("buy", "10", "110000", "1000", time2), randomUUID());
      const p = await holding(); assert.equal(p.quantity, "30"); assert.equal(p.costBasisMinor, "3106000"); assert.equal(p.averageCost, "103533.333333333333333333");
    });
    await t.test("partial Sell removes average basis and receives net proceeds", async () => {
      sell = await s.postInvestmentTrade(draft("sell", "6", "120000", "3000", time3), randomUUID());
      const p = await holding(); assert.equal(p.quantity, "24"); assert.equal(p.costBasisMinor, "2484800"); assert.equal(p.realizedMinor, "95800"); assert.equal(await balance(), "7611000");
      const snapshot = await investmentSnapshot(); assert.equal(snapshot.portfolioTotals.find((p) => p.portfolioId === portfolioId).realizedMinor, "95800");
      assert.equal(snapshot.instrumentTotals.find((i) => i.instrumentId === instrumentId).realizedMinor, "95800");
    });
    await t.test("sell fee remains separate and reduces realized result", async () => {
      const row = (await investmentSnapshot()).trades.find((t) => t.id === sell);
      assert.equal(row.feeMinor, "3000"); assert.equal(row.removedMinor, "621200"); assert.equal(row.realizedMinor, "95800");
      const legs = (await admin.query("SELECT component,amount_minor::text FROM ledger_movements WHERE investment_transaction_id=$1 ORDER BY component", [sell])).rows;
      assert.deepEqual(legs.map((l) => l.amount_minor), ["-3000", "720000"]);
    });
    await t.test("manual price gives exact market value and unrealized result", async () => {
      await s.saveMarketPrice({ instrumentId, price: "125000", asOf: time3 }, randomUUID());
      const p = await holding(); assert.equal(p.marketMinor, "3000000"); assert.equal(p.unrealizedMinor, "515200"); assert.equal(p.price.sourceType, "manual");
    });
    await t.test("price history is append-only, backdated insertion cannot replace newer quote", async () => {
      const key = randomUUID(), point = { instrumentId, price: "110000", asOf: time2 };
      const id = await s.saveMarketPrice(point, key); assert.equal(await s.saveMarketPrice(point, key), id);
      assert.equal((await holding()).price.price, "125000"); assert.equal((await investmentSnapshot()).prices.filter((p) => p.instrumentId === instrumentId).length, 3);
      await assert.rejects(admin.query("DELETE FROM investment_price_points WHERE id=$1", [id]), /append-only/);
    });
    await t.test("full Sell resolves remaining quantity and basis exactly", async () => {
      fullSell = await s.postInvestmentTrade(draft("sell", "24", "130000", "1000", "2025-01-04T08:00:00.000Z"), randomUUID());
      const p = await holding(); assert.equal(p.quantity, "0"); assert.equal(p.costBasisMinor, "0"); assert.equal(p.realizedMinor, "730000"); assert.equal(await balance(), "10730000");
    });
    await t.test("unpriced and zero-basis positions are explicit, never substituted", async () => {
      const i = await s.createInstrument({ displayName: "Synthetic unpriced", currency: "IDR", typeId });
      await s.createOpeningPosition({ portfolioId, instrumentId: i, quantity: "0.004321", costBasisMinor: "0", occurredAt: time }, randomUUID());
      const p = await holding(i); assert.equal(p.marketMinor, null); assert.equal(p.unrealizedMinor, null); assert.equal(p.unrealizedPercent, null);
      assert.equal((await financeSnapshot()).currencies.find((c) => c.currency === "IDR").unpricedCount, 1);
    });
    const retryInstrument = await s.createInstrument({ displayName: "Synthetic retry", currency: "IDR", typeId });
    await t.test("concurrent duplicate Buy returns one event and cash leg", async () => {
      const key = randomUUID(), d = draft("buy", "10", "100", "0", time, retryInstrument);
      const ids = await Promise.all([s.postInvestmentTrade(d, key), s.postInvestmentTrade(d, key)]); assert.equal(ids[0], ids[1]);
      assert.equal((await holding(retryInstrument)).quantity, "10");
      await assert.rejects(s.postInvestmentTrade({ ...d, quantity: "11" }, key), /Kunci/);
    });
    await t.test("duplicate Sell applies its cash leg only once", async () => {
      const key = randomUUID(), d = draft("sell", "2", "120", "0", time2, retryInstrument);
      const before = BigInt(await balance()); const id = await s.postInvestmentTrade(d, key);
      assert.equal(await s.postInvestmentTrade(d, key), id); assert.equal(BigInt(await balance()) - before, 240n);
    });
    await t.test("oversell rejected atomically", async () => {
      const before = await counts(), cash = await balance();
      await assert.rejects(s.postInvestmentTrade(draft("sell", "9", "100", "0", time3, retryInstrument), randomUUID()), /mencukupi/);
      assert.deepEqual(await counts(), before); assert.equal(await balance(), cash);
    });
    await t.test("cross-currency settlement and pairs rejected", async () => {
      const p = await s.createPortfolio({ displayName: "Synthetic USD", currency: "USD" });
      const i = await s.createInstrument({ displayName: "Synthetic USD instrument", currency: "USD", typeId });
      await assert.rejects(s.postInvestmentTrade({ ...draft("buy", "1", "10"), portfolioId: p, instrumentId: i }, randomUUID()), /mata uang/);
      await assert.rejects(s.createOpeningPosition({ portfolioId, instrumentId: i, quantity: "1", costBasisMinor: "100", occurredAt: time }, randomUUID()), /mata uang/);
    });
    await t.test("archived portfolio rejects trades and preserves holdings", async () => {
      const p = await s.createPortfolio({ displayName: "Synthetic archived portfolio", currency: "IDR" });
      await s.createOpeningPosition({ portfolioId: p, instrumentId, quantity: "1", costBasisMinor: "100", occurredAt: time }, randomUUID());
      await s.archiveInvestment("portfolio", p);
      await assert.rejects(s.postInvestmentTrade({ ...draft("buy", "1", "100"), portfolioId: p }, randomUUID()), /aktif/);
      assert.equal((await investmentSnapshot()).holdings.some((h) => h.portfolioId === p && h.quantity === "1"), true);
    });
    await t.test("archived instrument rejects trades without hiding open units", async () => {
      const i = await s.createInstrument({ displayName: "Synthetic archived instrument", currency: "IDR", typeId });
      await s.createOpeningPosition({ portfolioId, instrumentId: i, quantity: "2", costBasisMinor: "200", occurredAt: time }, randomUUID()); await s.archiveInvestment("instrument", i);
      await assert.rejects(s.postInvestmentTrade(draft("buy", "1", "100", "0", time, i), randomUUID()), /aktif/);
      assert.equal((await holding(i)).quantity, "2");
    });
    await t.test("late ledger failure rolls back trade, fee, cash and idempotency", async () => {
      await admin.query(`CREATE FUNCTION reject_p4_fee() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.component='investment_fee' THEN RAISE EXCEPTION 'synthetic late failure'; END IF; RETURN NEW; END; $$`);
      await admin.query("CREATE TRIGGER reject_p4_fee BEFORE INSERT ON ledger_movements FOR EACH ROW EXECUTE FUNCTION reject_p4_fee()");
      const before = await counts(), cash = await balance();
      try { await assert.rejects(s.postInvestmentTrade(draft("buy", "1", "100", "1", time3, retryInstrument), randomUUID()), /synthetic late failure/); assert.deepEqual(await counts(), before); assert.equal(await balance(), cash); }
      finally { await admin.query("DROP TRIGGER reject_p4_fee ON ledger_movements"); await admin.query("DROP FUNCTION reject_p4_fee()"); }
    });
    const correctionInstrument = await s.createInstrument({ displayName: "Synthetic correction", currency: "IDR", typeId });
    const correctionBuy = await s.postInvestmentTrade(draft("buy", "10", "100", "0", time, correctionInstrument), randomUUID());
    const correctionSell = await s.postInvestmentTrade(draft("sell", "8", "150", "0", time2, correctionInstrument), randomUUID());
    let replacement;
    await t.test("invalid historical correction rejected without altering original", async () => {
      const before = await counts(), cash = await balance();
      await assert.rejects(s.replaceInvestmentTrade(correctionBuy, draft("buy", "5", "100", "0", time, correctionInstrument), randomUUID()), /mencukupi/);
      assert.deepEqual(await counts(), before); assert.equal(await balance(), cash); assert.equal((await investmentSnapshot()).trades.find((t) => t.id === correctionBuy).status, "posted");
    });
    await t.test("valid correction replays subsequent Sell cost basis", async () => {
      const key = randomUUID(), d = draft("buy", "20", "200", "0", time, correctionInstrument);
      replacement = await s.replaceInvestmentTrade(correctionBuy, d, key); assert.equal(await s.replaceInvestmentTrade(correctionBuy, d, key), replacement);
      const snapshot = await investmentSnapshot(); assert.equal(snapshot.trades.find((t) => t.id === correctionBuy).status, "superseded");
      assert.equal(snapshot.trades.find((t) => t.id === correctionSell).removedMinor, "1600"); assert.equal(snapshot.trades.find((t) => t.id === correctionSell).realizedMinor, "-400");
      assert.equal((await holding(correctionInstrument)).quantity, "12"); assert.equal((await holding(correctionInstrument)).costBasisMinor, "2400");
    });
    await t.test("void of depended-on Buy rejected; valid void reverses cash together", async () => {
      const cash = await balance(); await assert.rejects(s.voidInvestmentTrade(replacement, randomUUID()), /mencukupi/); assert.equal(await balance(), cash);
      await s.voidInvestmentTrade(correctionSell, randomUUID()); const key = randomUUID(); await s.voidInvestmentTrade(replacement, key); assert.equal(await s.voidInvestmentTrade(replacement, key), replacement);
      assert.equal((await holding(correctionInstrument)).quantity, "0"); assert.equal((await holding(correctionInstrument)).costBasisMinor, "0");
      assert.equal((await admin.query("SELECT SUM(amount_minor)::text AS total FROM ledger_movements WHERE investment_transaction_id=ANY($1::uuid[])", [[correctionBuy, correctionSell, replacement]])).rows[0].total, "0");
    });
    await t.test("P3 ordinary ledger continues to calculate balances alongside trades", async () => {
      const before = BigInt(await balance()); await postActivity({ kind: "income", amountMinor: "123", destinationAssetId: source, occurredAt: time }, randomUUID());
      assert.equal(BigInt(await balance()) - before, 123n);
    });
    await t.test("ledger rejects orphan, ambiguous and incorrect reversal sources", async () => {
      await assert.rejects(admin.query("INSERT INTO ledger_movements (id,asset_id,currency_code,component,amount_minor) VALUES ($1,$2,'IDR','investment_principal',1)", [randomUUID(), source]), /constraint/);
      const ordinary = (await admin.query("SELECT id FROM financial_activities LIMIT 1")).rows[0].id;
      await assert.rejects(admin.query("INSERT INTO ledger_movements (id,activity_id,investment_transaction_id,asset_id,currency_code,component,amount_minor) VALUES ($1,$2,$3,$4,'IDR','principal',1)", [randomUUID(), ordinary, buy, source]), /constraint/);
      const movement = (await admin.query("SELECT id FROM ledger_movements WHERE investment_transaction_id=$1 AND component='investment_principal'", [secondBuy])).rows[0].id;
      await assert.rejects(admin.query("INSERT INTO ledger_movements (id,investment_transaction_id,asset_id,currency_code,component,amount_minor,reverses_movement_id) VALUES ($1,$2,$3,'IDR','reversal',1,$4)", [randomUUID(), secondBuy, source, movement]), /Invalid ledger reversal/);
    });
    await t.test("price and event validation reject unsafe inputs", async () => {
      await assert.rejects(s.postInvestmentTrade({ ...draft("buy", "1", "100"), quantity: "0" }, randomUUID()), /lebih dari nol/);
      await assert.rejects(s.postInvestmentTrade({ ...draft("buy", "1", "100"), note: "x".repeat(1001) }, randomUUID()), /Teks/);
      await assert.rejects(s.postInvestmentTrade(draft("buy", "1", "100", "0", "2099-01-01T00:00:00.000Z"), randomUUID()), /masa depan/);
      await assert.rejects(s.saveMarketPrice({ instrumentId, price: "100", asOf: "2099-01-01T00:00:00.000Z" }, randomUUID()), /masa depan/);
      await assert.rejects(s.refreshMarketPrice(instrumentId, randomUUID()), /belum dikonfigurasi/);
      assert.equal((await investmentSnapshot()).trades.find((t) => t.id === fullSell).status, "posted");
    });
    await t.test("P4.1 instrument metadata edit and composite provider quote refresh with failure preservation", async () => {
      const { setMarketPriceFetchForTest } = await import("../src/lib/investments/providers.ts");
      await s.updateInvestmentMetadata("instrument", initialInstrument, "Synthetic prior holding updated", {
        symbol: "BTC",
        market: "SPOT",
        priceSymbol: "coingecko:bitcoin",
      });
      const updatedInst = (await investmentSnapshot()).instruments.find((i) => i.id === initialInstrument);
      assert.equal(updatedInst.displayName, "Synthetic prior holding updated");
      assert.equal(updatedInst.symbol, "BTC");
      assert.equal(updatedInst.market, "SPOT");
      assert.equal(updatedInst.priceSymbol, "coingecko:bitcoin");

      process.env.MONETA_PRICE_PROVIDER = "composite";
      try {
        setMarketPriceFetchForTest(async () => new Response(JSON.stringify({ bitcoin: { idr: "140000", last_updated_at: 1735948800 } }), { status: 200 }));
        const key = randomUUID();
        const priceId = await s.refreshMarketPrice(initialInstrument, key);
        assert.equal(await s.refreshMarketPrice(initialInstrument, key), priceId);
        const h = await holding(initialInstrument);
        assert.equal(h.price.id, priceId);
        assert.equal(h.price.price, "140000");
        assert.equal(h.price.sourceType, "provider");
        assert.equal(h.price.sourceId, "coingecko");
        assert.equal(h.marketMinor, "700000");

        // Failure leaves prior quote intact
        setMarketPriceFetchForTest(async () => new Response("Service unavailable", { status: 503 }));
        await assert.rejects(s.refreshMarketPrice(initialInstrument, randomUUID()), /HTTP 503/);
        assert.equal((await holding(initialInstrument)).price.id, priceId);
      } finally {
        setMarketPriceFetchForTest(null);
        delete process.env.MONETA_PRICE_PROVIDER;
      }
    });
    await t.test("lean summary matches full replay after corrections, voids, archives and missing prices", async () => {
      const full = await investmentSnapshot(), summary = await financeSnapshot();
      const sorted = (rows) => [...rows].sort((a, b) => a.currency.localeCompare(b.currency));
      assert.deepEqual(sorted(summary.investment.totals), sorted(full.totals));
      assert.equal(summary.investment.hasHoldings, true);
      const spending = await monthlyExpenses();
      for (const currency of summary.currencies) assert.equal(spending.find((row) => row.currency === currency.currency).expenseMinor, currency.expenseMinor);
      const assetsOnly = await financeSnapshot({ includeRecent: false, includeExpenses: false });
      assert.deepEqual(assetsOnly.recent, []);
      assert.deepEqual(assetsOnly.investment.totals, summary.investment.totals);
      const balances = (rows) => rows.map((row) => ({ ...row, expenseMinor: "omitted" }));
      assert.deepEqual(balances(assetsOnly.currencies), balances(summary.currencies));
      assert.deepEqual(await listActivities(false, 4), (await listActivities()).slice(0, 4));
      await assert.rejects(listActivities(false, 0), /limit/i);
    });
    await lifecycleCases(t, { admin, pool, service: s, snapshot: investmentSnapshot, source, typeId, time });
    await openingReconciliationCases(t, { admin, service: s, assets, finance, snapshot: investmentSnapshot, openingHistory: investmentOpeningHistory, financeSnapshot, time });
    await t.test("owner authorization guards all investment reads and writes", async () => {
      globalThis.__investmentTestAuthorized = false;
      await assert.rejects(investmentSnapshot(), /Unauthorized/); await assert.rejects(s.postInvestmentTrade(draft("buy", "1", "100"), randomUUID()), /Unauthorized/);
      await assert.rejects(s.createPortfolio({ displayName: "Synthetic unauthorized", currency: "IDR" }), /Unauthorized/);
      await assert.rejects(s.saveMarketPrice({ instrumentId, price: "100", asOf: time }, randomUUID()), /Unauthorized/);
      globalThis.__investmentTestAuthorized = true;
    });
  } finally {
    hooks?.deregister(); if (pool) await pool.end(); await admin.query("RESET search_path"); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
