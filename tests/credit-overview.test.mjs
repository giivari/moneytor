// Kredit & Talangan overview domain: facility status, installment contracts and totals. Pure: no database.
import test from "node:test";
import assert from "node:assert/strict";
import * as credit from "../src/lib/domain/credit.ts";
import { summarizeBalances } from "../src/lib/domain/net-worth.ts";
import { horizonDay } from "../src/lib/domain/planning.ts";
import { creditFacilities, creditTotals, installmentContracts, receivableAccounts } from "../src/lib/domain/credit-overview.ts";

const NOW = new Date("2026-11-25T05:00:00Z");
const THROUGH_DAY = horizonDay("2026-11-25", 30);
const note = (limit = 0n) => credit.encodeCreditNote("", true, { dueDay: 1, cutoffDay: 20, limitMinor: limit, carryCurrentMinor: 0n, schedule: [] });

let serial = 0;
function asset(overrides) {
  serial++;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`, displayName: `Akun ${serial}`, currency: "IDR", exponent: 0,
    assetTypeId: "t", assetTypeName: "Kartu kredit", assetGroupId: null, assetGroupName: null, providerId: null, providerName: null,
    paymentNetworkId: null, normallyLiquid: false, normallySpendable: false, safeSuffix: null, note: null, isActive: true,
    openingMinor: "0", balanceMinor: "0", assetClass: "liability", creditInstallments: [], ...overrides,
  };
}
const card = (overrides) => asset({ note: note(), ...overrides });
const rows = (activityId, count, principal, interest, start) => Array.from({ length: count }, (_, index) => ({
  activityId, seq: index + 1, period: credit.addCreditPeriods(start, index), principalMinor: String(principal), interestMinor: String(interest), status: "scheduled",
}));

test("facility status follows the computed bills, including Lebih bayar and Lunas", () => {
  const assets = [
    card({ displayName: "Tagihan", balanceMinor: "-500000" }),
    card({ displayName: "Lunas", balanceMinor: "0" }),
    card({ displayName: "Lebih", balanceMinor: "75000" }),
    card({ displayName: "Cicilan", balanceMinor: "-600000", creditInstallments: rows("a", 3, 190000, 10000, "2027-02") }),
    asset({ displayName: "Bukan kredit", assetClass: "asset", note: null }),
  ];
  const byName = Object.fromEntries(creditFacilities(assets, NOW).map((item) => [item.asset.displayName, item]));
  assert.equal(byName["Bukan kredit"], undefined);
  assert.equal(byName.Tagihan.status, "tagihan");
  assert.equal(byName.Lunas.status, "lunas");
  assert.equal(byName.Lebih.status, "lebih-bayar");
  assert.equal(byName.Lebih.bills.overpaidMinor, 75000n);
  assert.equal(byName.Cicilan.status, "cicilan"); // nothing due on the next date, later installments still owed
  assert.equal(byName.Cicilan.bills.totalUnpaidMinor, 600000n);
});

test("installment contracts group scheduled rows per purchase and ignore cancelled rows", () => {
  const schedule = [...rows("a", 3, 190000, 10000, "2026-12"), ...rows("b", 2, 50000, 0, "2027-01").map((row) => ({ ...row, status: "cancelled" }))];
  const contracts = installmentContracts(card({ balanceMinor: "-600000", creditInstallments: schedule }), NOW);
  assert.equal(contracts.length, 1);
  assert.deepEqual({ ...contracts[0], rows: contracts[0].rows.length }, {
    activityId: "a", count: 3, monthlyMinor: 200000n, totalMinor: 600000n, firstPeriod: "2026-12", lastPeriod: "2027-02", upcomingCount: 3, rows: 3,
  });
});

test("totals match summarizeBalances liabilities and planning credit debt, and sum limits only where known", () => {
  const assets = [card({ balanceMinor: "-500000", note: note(2000000n) }), card({ balanceMinor: "-300000" }), card({ balanceMinor: "-100000", isActive: false })];
  const totals = creditTotals(assets, "IDR", THROUGH_DAY, NOW);
  const summary = summarizeBalances(assets, [], THROUGH_DAY, NOW).get("IDR");
  assert.equal(totals.liabilitiesMinor, summary.liabilities);
  assert.equal(totals.dueMinor, summary.creditDebt);
  assert.equal(totals.availableLimitMinor, 1500000n);
  assert.equal(totals.limitKnownCount, 1);
  assert.equal(totals.facilityCount, 3);
});

test("receivables list open balances first and never clamps negatives", () => {
  const list = receivableAccounts([
    asset({ assetClass: "receivable", displayName: "Lunas", balanceMinor: "0" }),
    asset({ assetClass: "receivable", displayName: "Budi", balanceMinor: "250000" }),
    asset({ assetClass: "receivable", displayName: "Kelebihan", balanceMinor: "-5000" }),
  ], "IDR");
  assert.deepEqual(list.map((item) => [item.asset.displayName, item.status]), [["Budi", "terbuka"], ["Kelebihan", "terbuka"], ["Lunas", "lunas"]]);
});

test("billPayment prefills the next open bill and skips settled, overpaid and archived accounts", async () => {
  const { billPayment } = await import("../src/lib/domain/credit-overview.ts");
  const byName = Object.fromEntries(creditFacilities([
    card({ displayName: "Tagihan", balanceMinor: "-500000" }),
    card({ displayName: "Lunas", balanceMinor: "0" }),
    card({ displayName: "Lebih", balanceMinor: "75000" }),
    card({ displayName: "Arsip", balanceMinor: "-90000", isActive: false }),
    card({ displayName: "Cicilan jauh", balanceMinor: "-600000", creditInstallments: rows("a", 3, 190000, 10000, "2027-06") }),
  ], NOW).map((item) => [item.asset.displayName, item]));
  const bills = byName.Tagihan.bills;
  assert.deepEqual(billPayment(byName.Tagihan), { amountMinor: bills.currentBillMinor > 0n ? bills.currentBillMinor : bills.nextBillMinor,
    dueIso: bills.currentBillMinor > 0n ? bills.currentDueIso : bills.nextDueIso });
  assert.ok(billPayment(byName.Tagihan).amountMinor > 0n);
  assert.equal(billPayment(byName.Lunas), null);
  assert.equal(billPayment(byName.Lebih), null);
  assert.equal(billPayment(byName.Arsip), null);
  assert.equal(billPayment(byName["Cicilan jauh"]), null);
});
