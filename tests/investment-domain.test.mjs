import test from "node:test";
import assert from "node:assert/strict";
import { decimal, decimalString, replayPosition, roundRatio, settle, tradeCash, valuation } from "../src/lib/investments/math.ts";
const event = (id, kind, quantity, grossMinor, feeMinor = "0") => ({ id, kind, quantity, grossMinor, feeMinor, occurredAt: `2025-01-0${id}T00:00:00.000Z`, order: id });
test("exact fractional quantities and prices; no binary floating point", () => {
  assert.equal(decimalString(decimal("0.004321")), "0.004321");
  assert.equal(settle("1.52731", "1000.123456789", 2), 152750n);
  assert.equal(settle("0.1", "0.2", 2), 2n);
  assert.throws(() => decimal("1e-3"));
  assert.throws(() => decimal("NaN"));
  assert.throws(() => decimal("0.0000000000000000001"));
  assert.throws(() => decimal("-1"));
});
test("central settlement and allocation rounding", () => {
  assert.equal(roundRatio(1n, 2n), 1n);
  assert.equal(roundRatio(-1n, 2n), -1n);
  assert.equal(settle("1", "1.005", 2), 101n);
  assert.throws(() => settle("10000000000000000000", "1", 0), /batas/);
  assert.equal(valuation("10000000000000000000", "0", "1", 0).marketMinor, "10000000000000000000");
});
test("opening position establishes basis without trades", () => {
  const p = replayPosition({ quantity: "1.52731", costBasisMinor: "100000", occurredAt: "2025-01-01T00:00:00.000Z" }, [], 0);
  assert.equal(p.quantity, "1.52731"); assert.equal(p.costBasisMinor, "100000"); assert.equal(p.realizedMinor, "0");
});
test("weighted-average cost, partial sale, fees, and complete exit", () => {
  const buys = [event("1", "buy", "20", "2000000", "5000"), event("2", "buy", "10", "1100000", "1000")];
  const before = replayPosition(undefined, buys, 0);
  assert.equal(before.averageCost, "103533.333333333333333333");
  const partial = replayPosition(undefined, [...buys, event("3", "sell", "6", "720000", "3000")], 0);
  assert.equal(partial.quantity, "24"); assert.equal(partial.costBasisMinor, "2484800");
  assert.deepEqual(partial.sells["3"], { removedMinor: "621200", realizedMinor: "95800" });
  const full = replayPosition(undefined, [...buys, event("3", "sell", "6", "720000", "3000"), event("4", "sell", "24", "3120000", "1000")], 0);
  assert.equal(full.quantity, "0"); assert.equal(full.costBasisMinor, "0"); assert.equal(full.realizedMinor, "730000");
});
test("rounded partial allocations exhaust basis exactly", () => {
  const p = replayPosition(undefined, [event("1", "buy", "3", "10"), event("2", "sell", "1", "4"), event("3", "sell", "1", "4"), event("4", "sell", "1", "4")], 0);
  assert.equal(p.costBasisMinor, "0"); assert.equal(p.realizedMinor, "2");
  assert.equal(Object.values(p.sells).reduce((sum, s) => sum + BigInt(s.removedMinor), 0n), 10n);
});
test("chronology replay rejects overselling and an invalid earlier correction", () => {
  assert.throws(() => replayPosition(undefined, [event("1", "sell", "1", "100")], 0), /mencukupi/);
  assert.throws(() => replayPosition(undefined, [event("1", "buy", "5", "500"), event("2", "sell", "8", "1200")], 0), /mencukupi/);
  assert.throws(() => replayPosition({ quantity: "10", costBasisMinor: "100", occurredAt: "2025-02-01T00:00:00.000Z" }, [event("1", "buy", "1", "100")], 0), /mendahului/);
});
test("same-time ordering uses exact sequence identity", () => {
  const a = { ...event("1", "buy", "1", "100"), order: "9007199254740993" };
  const b = { ...event("1", "sell", "1", "120"), id: "2", order: "9007199254740994" };
  assert.equal(replayPosition(undefined, [b, a], 0).realizedMinor, "20");
});
test("cash preview, exact valuation, unpriced and zero-basis states", () => {
  assert.deepEqual(tradeCash("buy", "10", "100000", "5000", 0), { gross: 1000000n, fee: 5000n, cash: 1005000n });
  assert.deepEqual(tradeCash("sell", "10", "100000", "5000", 0), { gross: 1000000n, fee: 5000n, cash: 995000n });
  assert.throws(() => tradeCash("sell", "1", "1", "2", 0), /melebihi/);
  assert.deepEqual(valuation("10", "900000", "100000", 0), { marketMinor: "1000000", unrealizedMinor: "100000", unrealizedPercent: "11.11" });
  assert.equal(valuation("10", "900000", null, 0).marketMinor, null);
  assert.equal(valuation("10", "0", "100", 0).unrealizedPercent, null);
});

test("P4.1 external market quote providers: composite routing, coingecko, twelvedata, alphavantage, http-json, and strict validation", async () => {
  const { registerHooks } = await import("node:module");
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
      if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
      if (specifier.startsWith("./") && context.parentURL?.endsWith(".ts") && !specifier.endsWith(".ts")) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
      return next(specifier, context);
    },
  });
  try {
    const { configuredPriceProvider, setMarketPriceFetchForTest, normalizeQuote } = await import("../src/lib/investments/providers.ts");
    const savedEnv = { ...process.env };
    try {
      delete process.env.MONETA_PRICE_PROVIDER;
      assert.equal(configuredPriceProvider(), null);

      process.env.MONETA_PRICE_PROVIDER = "composite";
      process.env.MONETA_TWELVEDATA_API_KEY = "td-test-key";
      process.env.MONETA_ALPHAVANTAGE_API_KEY = "av-test-key";
      process.env.MONETA_PRICE_PROVIDER_URL = "https://quotes.example.test/api";
      process.env.MONETA_PRICE_PROVIDER_TOKEN = "secret-token";

      const composite = configuredPriceProvider();
      assert.equal(composite?.id, "composite");

      const baseInst = (overrides) => ({
        id: "11111111-1111-4111-8111-111111111111",
        displayName: "Test",
        symbol: "BTC",
        market: "IDX",
        typeId: "22222222-2222-4222-8222-222222222222",
        typeName: "Crypto",
        currency: "IDR",
        exponent: 0,
        priceSymbol: "coingecko:bitcoin",
        isActive: true,
        ...overrides,
      });

      setMarketPriceFetchForTest(async (input, init) => {
        const url = String(input);
        if (url.includes("api.coingecko.com")) {
          return new Response(JSON.stringify({ bitcoin: { idr: "1050000000.5", last_updated_at: 1735689600 } }), { status: 200 });
        }
        if (url.includes("api.twelvedata.com")) {
          return new Response(JSON.stringify({ close: "9850.25", currency: "IDR", datetime: "2025-01-02" }), { status: 200 });
        }
        if (url.includes("alphavantage.co")) {
          return new Response(JSON.stringify({ "Global Quote": { "05. price": "185.4200", "07. latest trading day": "2025-01-03" } }), { status: 200 });
        }
        if (url.includes("quotes.example.test")) {
          assert.equal(init?.headers?.Authorization, "Bearer secret-token");
          const parsed = new URL(url);
          if (parsed.searchParams.get("symbol") === "WRONG_CCY") {
            return new Response(JSON.stringify({ price: "100", currency: "USD", asOf: "2025-01-03T10:00:00.000Z" }), { status: 200 });
          }
          return new Response(JSON.stringify({ price: "1425.75", currency: "IDR", asOf: "2025-01-03T10:00:00.000Z" }), { status: 200 });
        }
        return new Response("Not found", { status: 404 });
      });

      const cgQuote = await composite.fetchQuote(baseInst({ priceSymbol: "coingecko:bitcoin" }));
      assert.deepEqual(cgQuote, {
        instrumentId: "11111111-1111-4111-8111-111111111111",
        price: "1050000000.5",
        currency: "IDR",
        asOf: "2025-01-01T00:00:00.000Z",
        sourceId: "coingecko",
      });

      const tdQuote = await composite.fetchQuote(baseInst({ priceSymbol: "twelvedata:BBCA", market: "IDX" }));
      assert.deepEqual(tdQuote, {
        instrumentId: "11111111-1111-4111-8111-111111111111",
        price: "9850.25",
        currency: "IDR",
        asOf: "2025-01-02T00:00:00.000Z",
        sourceId: "twelvedata",
      });

      const avQuote = await composite.fetchQuote(baseInst({ currency: "USD", priceSymbol: "alphavantage:IBM" }));
      assert.deepEqual(avQuote, {
        instrumentId: "11111111-1111-4111-8111-111111111111",
        price: "185.42",
        currency: "USD",
        asOf: "2025-01-03T00:00:00.000Z",
        sourceId: "alphavantage",
      });

      const httpQuote = await composite.fetchQuote(baseInst({ priceSymbol: "http:RDPU_A" }));
      assert.deepEqual(httpQuote, {
        instrumentId: "11111111-1111-4111-8111-111111111111",
        price: "1425.75",
        currency: "IDR",
        asOf: "2025-01-03T10:00:00.000Z",
        sourceId: "http-json",
      });

      // Reject currency mismatch
      await assert.rejects(composite.fetchQuote(baseInst({ priceSymbol: "http:WRONG_CCY" })), /Mata uang kuotasi/);
      // Reject missing prefix when no default adapter is set
      await assert.rejects(composite.fetchQuote(baseInst({ priceSymbol: "PLAIN_SYMBOL" })), /prefix penyedia/);
      // Reject future timestamp or zero/negative price in normalizeQuote
      assert.throws(() => normalizeQuote(baseInst({}), { price: "0", currency: "IDR", asOf: "2025-01-01T00:00:00.000Z", sourceId: "coingecko" }), /nol/);
      assert.throws(() => normalizeQuote(baseInst({}), { price: "100", currency: "IDR", asOf: "2099-01-01T00:00:00.000Z", sourceId: "coingecko" }), /masa depan/);
    } finally {
      setMarketPriceFetchForTest(null);
      for (const k of Object.keys(process.env)) if (!(k in savedEnv)) delete process.env[k];
      Object.assign(process.env, savedEnv);
    }
  } finally {
    hooks.deregister();
  }
});

