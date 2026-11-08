// "Dana siap pakai" has one definition: Beranda (financeSnapshot) and Rencana must show the same figure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as credit from "../src/lib/domain/credit.ts";
import { creditDebtThrough, summarizeBalances } from "../src/lib/domain/net-worth.ts";
import { availableFunds, horizonDay, planningPosition, planningToday } from "../src/lib/domain/planning.ts";

const NOW = new Date("2026-11-25T05:00:00Z");
const TODAY = "2026-11-25";
const note = (dueDay) => credit.encodeCreditNote("", true, { dueDay, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] });
let serial = 0;
function asset(overrides) {
  serial++;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`, displayName: `Akun ${serial}`, currency: "IDR", exponent: 0,
    assetTypeId: "type-bank", assetTypeName: "Rekening bank", assetGroupId: null, assetGroupName: null, providerId: null,
    providerName: null, paymentNetworkId: null, normallyLiquid: true, normallySpendable: true, safeSuffix: null,
    note: null, isActive: true, openingMinor: "0", balanceMinor: "0", assetClass: "asset", creditInstallments: [], ...overrides,
  };
}
const creditAccount = (overrides) => asset({ normallyLiquid: false, normallySpendable: false, assetClass: "liability", note: note(1), ...overrides });
const assets = [
  asset({ balanceMinor: "9000000" }),
  creditAccount({ balanceMinor: "-1200000", displayName: "PayLater" }),
  creditAccount({ balanceMinor: "-800000", displayName: "Kartu", note: note(10) }),
  creditAccount({ balanceMinor: "-500000", displayName: "Kartu nonaktif", isActive: false }),
];
const reserve = (amountMinor, extra = {}) => ({ currency: "IDR", amountMinor, isActive: true, ...extra });
const bill = (id, amountMinor, dueOn, extra = {}) => ({ id, currency: "IDR", amountMinor, dueOn, status: "open", ...extra });

test("Rencana (planningPosition) and Beranda (availableFunds over the SQL aggregate) agree on availableMinor", () => {
  const throughDay = horizonDay(TODAY, 30);
  const creditDebt = creditDebtThrough(assets, "IDR", throughDay, NOW);
  assert.ok(creditDebt > 0n, "fixture must have credit bills due");
  assert.equal(summarizeBalances(assets, [], throughDay, NOW).get("IDR").creditDebt, creditDebt);

  const reserves = [reserve("1000000"), reserve("400000", { obligationId: "listrik" })];
  const obligations = [bill("listrik", "700000", horizonDay(TODAY, 5)), bill("sewa", "2000000", horizonDay(TODAY, 20)), bill("jauh", "999", horizonDay(TODAY, 60))];
  const base = summarizeBalances(assets, [], throughDay, NOW).get("IDR").spendable;

  const fromLists = planningPosition(base, "IDR", reserves, obligations, throughDay, creditDebt);
  // What readPlanningSummary yields for the same rows: reserved 1.4jt, due 2.7jt, covered 400rb.
  const fromAggregate = availableFunds(base, { reservedMinor: "1400000", dueMinor: "2700000", coveredMinor: "400000", uncoveredMinor: "2300000" }, creditDebt);
  assert.deepEqual(fromLists, fromAggregate);
  assert.equal(fromLists.availableMinor, (base - 1400000n - 2300000n - creditDebt).toString());
  assert.equal(fromLists.dueMinor, (2700000n + creditDebt).toString());
});

test("credit bills are subtracted once; credit reminders in planning are not counted twice", () => {
  const throughDay = horizonDay(TODAY, 30);
  const creditDebt = creditDebtThrough(assets, "IDR", throughDay, NOW);
  const reminder = bill("pengingat", "800000", horizonDay(TODAY, 3), { note: `${credit.CREDIT_REMINDER_NOTE_PREFIX} Kartu` });
  const withReminder = planningPosition("9000000", "IDR", [], [reminder], throughDay, creditDebt);
  const without = planningPosition("9000000", "IDR", [], [], throughDay, creditDebt);
  assert.deepEqual(withReminder, without);
  assert.equal(without.availableMinor, (9000000n - creditDebt).toString());
});

test("horizons change the credit debt, the 30-day figure is the Beranda one, and negatives stay visible", () => {
  const d7 = creditDebtThrough(assets, "IDR", horizonDay(TODAY, 7), NOW);
  const d30 = creditDebtThrough(assets, "IDR", horizonDay(TODAY, 30), NOW);
  const d90 = creditDebtThrough(assets, "IDR", horizonDay(TODAY, 90), NOW);
  assert.ok(d7 <= d30 && d30 <= d90);
  assert.equal(planningToday(horizonDay(TODAY, 30)), TODAY);
  const overdrawn = planningPosition("100", "IDR", [], [], horizonDay(TODAY, 30), 5000n);
  assert.equal(overdrawn.availableMinor, "-4900");
  assert.throws(() => availableFunds("1", { reservedMinor: "0", dueMinor: "0", coveredMinor: "0", uncoveredMinor: "0" }, -1n));
});

test("both pages call the shared functions and keep no second definition", () => {
  const summary = fs.readFileSync(new URL("../src/lib/finance/summary.ts", import.meta.url), "utf8");
  const manager = fs.readFileSync(new URL("../src/components/planning-manager.tsx", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/app/planning/page.tsx", import.meta.url), "utf8");
  assert.match(summary, /availableFunds\(/);
  assert.doesNotMatch(summary, /planningTotals/);
  assert.match(manager, /planningPosition\([\s\S]*creditDebt\[entry\.currency\]/);
  assert.match(page, /loadServerWorkbook|creditDebtThrough\(/);
  assert.doesNotMatch(manager, /todayFromEnd/);
});
