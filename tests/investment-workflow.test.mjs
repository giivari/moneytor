import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "./math" && context.parentURL?.endsWith("workflow.ts")) return next(new URL("./math.ts", context.parentURL).href, context);
  return next(specifier, context);
} });
const { investmentWorkflow } = await import("../src/lib/investments/workflow.ts");
hooks.deregister();
const base = () => ({ portfolios: [], instruments: [], holdings: [], trades: [] });
const portfolio = (id, currency = "IDR", isActive = true) => ({ id, currency, isActive });
const instrument = (id, currency = "IDR", isActive = true) => ({ id, currency, isActive });

test("first-run follows real currency-compatible prerequisites without requiring cash for an opening", () => {
  const snapshot = base();
  assert.equal(investmentWorkflow(snapshot, []).stage, "portfolio");
  snapshot.portfolios.push(portfolio("p"));
  snapshot.instruments.push(instrument("usd", "USD"));
  assert.equal(investmentWorkflow(snapshot, []).stage, "instrument");
  snapshot.instruments.push(instrument("idr"));
  const flow = investmentWorkflow(snapshot, []);
  assert.equal(flow.stage, "ownership"); assert.equal(flow.canTrade, false);
  assert.equal(flow.instrument.id, "idr");
  assert.equal(investmentWorkflow(snapshot, ["IDR"]).canTrade, true);
});
test("missing price is actionable only for a positive active holding; sold positions need no quote", () => {
  const snapshot = { ...base(), portfolios: [portfolio("p")], instruments: [instrument("i")],
    holdings: [{ portfolioId: "p", instrumentId: "i", quantity: "0.000000000000000001", marketMinor: null, opening: {} }] };
  assert.equal(investmentWorkflow(snapshot, []).stage, "price");
  snapshot.holdings[0].marketMinor = "0";
  assert.equal(investmentWorkflow(snapshot, []).stage, "ready");
  snapshot.holdings[0] = { instrumentId: "i", quantity: "0", marketMinor: null, opening: null };
  snapshot.trades.push({ status: "posted" });
  assert.equal(investmentWorkflow(snapshot, []).stage, "ready");
});
test("archived options are excluded from setup and a funded pair is suggested for buying", () => {
  const snapshot = { ...base(), portfolios: [portfolio("old", "IDR", false), portfolio("usd", "USD"), portfolio("idr")],
    instruments: [instrument("old", "IDR", false), instrument("u", "USD"), instrument("i")] };
  const flow = investmentWorkflow(snapshot, ["IDR"]);
  assert.equal(flow.portfolio.id, "idr"); assert.equal(flow.instrument.id, "i"); assert.equal(flow.canTrade, true);
  snapshot.instruments = [instrument("old", "IDR", false)];
  assert.equal(investmentWorkflow(snapshot, ["IDR"]).stage, "instrument");
  assert.equal(investmentWorkflow(snapshot, ["IDR"]).canTrade, false);
});
