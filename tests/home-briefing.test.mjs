// Beranda KPI domain: net worth components, nearest credit bill and receivables. Pure: no database.
import test from "node:test";
import assert from "node:assert/strict";
import * as credit from "../src/lib/domain/credit.ts";
import { summarizeBalances } from "../src/lib/domain/net-worth.ts";
import { horizonDay } from "../src/lib/domain/planning.ts";
import { creditBillsDue, netWorthComponents, receivablesSummary } from "../src/lib/domain/home-briefing.ts";

const NOW = new Date("2026-11-25T05:00:00Z");
const THROUGH_DAY = horizonDay("2026-11-25", 30);
const note = (dueDay) => credit.encodeCreditNote("", true, { dueDay, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] });

let serial = 0;
function asset(overrides) {
  serial++;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    displayName: `Akun ${serial}`, currency: "IDR", exponent: 0,
    assetTypeId: "type-bank", assetTypeName: "Rekening bank", assetGroupId: null, assetGroupName: null,
    providerId: null, providerName: null, paymentNetworkId: null,
    normallyLiquid: true, normallySpendable: true, safeSuffix: null,
    note: null, isActive: true, openingMinor: "0", balanceMinor: "0",
    assetClass: "asset", creditInstallments: [],
    ...overrides,
  };
}
const creditAccount = (overrides) => asset({ normallyLiquid: false, normallySpendable: false, assetClass: "liability", note: note(1), ...overrides });

const book = () => [
  asset({ balanceMinor: "5000000" }),
  asset({ balanceMinor: "-250000" }), // overdrawn cash stays negative
  asset({ balanceMinor: "40000000", normallyLiquid: false, normallySpendable: false }),
  asset({ balanceMinor: "900000", isActive: false }),
  asset({ balanceMinor: "300000", assetClass: "receivable", displayName: "Talangan A" }),
  asset({ balanceMinor: "0", assetClass: "receivable", displayName: "Talangan lunas" }),
  creditAccount({ balanceMinor: "-1200000", displayName: "PayLater" }),
  creditAccount({ balanceMinor: "-800000", displayName: "Kartu", note: note(10) }),
  creditAccount({ balanceMinor: "150000", displayName: "Kartu lebih bayar" }),
  asset({ balanceMinor: "7", currency: "USD", exponent: 2 }),
];
const investments = [{ currency: "IDR", exponent: 0, marketMinor: "2500000", unpricedCount: 0 }];

test("net worth components add up to summarizeBalances, per currency, without clamping", () => {
  const assets = book();
  const parts = netWorthComponents(assets, investments, "IDR", NOW);
  assert.equal(parts.cashMinor, 4750000n);
  assert.equal(parts.otherAssetsMinor, 40900000n);
  assert.equal(parts.receivablesMinor, 300000n);
  assert.equal(parts.overpaidCreditMinor, 150000n);
  assert.equal(parts.investmentsMinor, 2500000n);
  assert.equal(parts.liabilitiesMinor, 2000000n);
  const summary = summarizeBalances(assets, investments, THROUGH_DAY, NOW).get("IDR");
  assert.equal(parts.cashMinor + parts.otherAssetsMinor + parts.receivablesMinor + parts.overpaidCreditMinor + parts.investmentsMinor, summary.total);
  assert.equal(parts.netWorthMinor, summary.netWorth);
  assert.equal(netWorthComponents(assets, investments, "USD", NOW).netWorthMinor, 7n);
});

test("credit bills due are sorted by due day; nearest groups every account due that day", () => {
  const bills = creditBillsDue(book(), "IDR", THROUGH_DAY, NOW);
  assert.deepEqual(bills.items.map((item) => [item.name, item.dueIso, item.amountMinor]), [
    ["PayLater", "2026-12-01", 1200000n],
    ["Kartu", "2026-12-10", 800000n],
  ]);
  assert.equal(bills.nearest?.dueIso, "2026-12-01");
  assert.equal(bills.nearest?.amountMinor, 1200000n);
  assert.deepEqual(bills.nearest?.names, ["PayLater"]);
  assert.equal(creditBillsDue([asset({ balanceMinor: "1" })], "IDR", THROUGH_DAY, NOW).nearest, null);
});

test("archived credit accounts are not upcoming bills but still count as liabilities", () => {
  const assets = [creditAccount({ balanceMinor: "-500000", isActive: false })];
  assert.equal(creditBillsDue(assets, "IDR", THROUGH_DAY, NOW).items.length, 0);
  assert.equal(netWorthComponents(assets, [], "IDR", NOW).liabilitiesMinor, 500000n);
});

test("receivables count only open balances", () => {
  assert.deepEqual(receivablesSummary(book(), "IDR"), { totalMinor: 300000n, openCount: 1 });
});
