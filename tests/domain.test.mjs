import test from "node:test";
import assert from "node:assert/strict";
import {
  addMoney, defineCurrency, deserializeMoney, majorDecimal, money, serializeMoney,
} from "../src/lib/domain/money.ts";
import {
  assertUniqueSystemKeys, customCatalogItem, isDedicatedCategory, validateCatalogName,
} from "../src/lib/domain/catalog.ts";
import { planActivity } from "../src/lib/domain/ledger.ts";
import {
  bpsToInput,
  encodeAssetTermsNote,
  estimateAssetMonthlyYield,
  formatBpsRate,
  parseAssetTerms,
  parseBpsInput,
  stripAssetMetaTags,
} from "../src/lib/domain/asset-terms.ts";
import { encodeCreditNote, isReceivableAsset, parseCreditMeta } from "../src/lib/domain/credit.ts";

const source = { id: "source", currency: "IDR", isActive: true };
const destination = { id: "destination", currency: "IDR", isActive: true };
const builtInFee = {
  id: "fee-type", displayName: "Nama bisa berubah", systemKey: "transfer_fee", isBuiltIn: true, isActive: true,
};
const customExpenseCategory = {
  ...customCatalogItem("category-new", "Kebutuhan khusus"), appliesTo: "expense",
};

test("money stays exact past Number.MAX_SAFE_INTEGER and crosses JSON as a string", () => {
  const large = money(9007199254740993n, "IDR");
  assert.equal(addMoney(large, money(7n, "IDR")).amountMinor, 9007199254741000n);
  const serialized = serializeMoney(large);
  assert.equal(JSON.stringify(serialized), '{"amountMinor":"9007199254740993","currency":"IDR"}');
  assert.deepEqual(deserializeMoney(serialized), large);
  assert.equal(majorDecimal(money(125n, "USD"), defineCurrency("USD", 2)), "1.25");
  assert.equal(majorDecimal(money(125000n, "IDR"), defineCurrency("IDR", 0)), "125000");
  assert.throws(() => money(1n, "idr"), /Currency code/);
  assert.throws(() => addMoney(money(1n, "IDR"), money(1n, "USD")), /Currency mismatch/);
});

test("transfer principal has zero total asset effect", () => {
  const result = planActivity({ kind: "transfer", amountMinor: 500000n, source, destination });
  assert.deepEqual(result.movements.map((line) => line.amountMinor), [-500000n, 500000n]);
  assert.equal(result.netAssetEffectMinor, 0n);
  assert.equal(result.charges.length, 0);
});

test("transfer fee is linked, is an expense, and only its amount reduces net assets", () => {
  const result = planActivity({
    kind: "transfer", amountMinor: 500000n, source, destination,
    transferFee: { id: "fee-1", amountMinor: 2500n, type: builtInFee },
  });
  assert.deepEqual(result.movements.map((line) => line.amountMinor), [-500000n, 500000n, -2500n]);
  assert.equal(result.movements[2].chargeId, "fee-1");
  assert.equal(result.totalOutflowMinor, 502500n);
  assert.equal(result.netAssetEffectMinor, -2500n);
  assert.equal(result.charges[0].type.systemKey, "transfer_fee");
});

test("expense keeps base and custom charges separately with exact combined outflow", () => {
  const customCharge = customCatalogItem("charge-new", "Biaya khusus");
  const result = planActivity({
    kind: "expense", amountMinor: 100000n, source, category: customExpenseCategory,
    charges: [
      { id: "tax", amountMinor: 10000n, type: customCatalogItem("tax-type", "Pajak lokal") },
      { id: "service", amountMinor: 5000n, type: customCharge },
      { id: "admin", amountMinor: 2500n, type: customCatalogItem("admin-type", "Biaya admin") },
    ],
  });
  assert.equal(result.baseAmountMinor, 100000n);
  assert.deepEqual(result.charges.map((charge) => charge.amountMinor), [10000n, 5000n, 2500n]);
  assert.equal(result.totalOutflowMinor, 117500n);
  assert.equal(result.netAssetEffectMinor, -117500n);
});

test("owner-created provider, network, asset type/group, category, and charge type need no enum update", () => {
  for (const name of ["Penyedia saya", "Jaringan saya", "Jenis aset baru", "Grup saya", "Kategori saya", "Biaya saya"]) {
    assert.equal(customCatalogItem(name, name).displayName, name);
  }
  assert.equal(customExpenseCategory.systemKey, null);
  assert.throws(() => validateCatalogName("  "), /Catalog name/);
  assert.throws(() => validateCatalogName("bad\nname"), /Catalog name/);
});

test("stable system keys are unique and display labels do not drive transfer semantics", () => {
  assert.throws(() => assertUniqueSystemKeys([builtInFee, { ...builtInFee, id: "second" }]), /Duplicate system key/);
  assert.throws(() => planActivity({
    kind: "transfer", amountMinor: 10n, source, destination,
    transferFee: { id: "fee-2", amountMinor: 1n, type: { ...builtInFee, systemKey: null, displayName: "Transfer Fee" } },
  }), /transfer_fee system key/);
});

test("invalid references, signs, and cross-currency transfers are rejected", () => {
  assert.throws(() => planActivity({ kind: "transfer", amountMinor: 1n, source, destination: source }), /must differ/);
  assert.throws(() => planActivity({ kind: "transfer", amountMinor: 1n, source, destination: { ...destination, currency: "USD" } }), /Currency mismatch/);
  assert.throws(() => planActivity({ kind: "expense", amountMinor: 0n, source }), /positive/);
  assert.throws(() => planActivity({ kind: "income", amountMinor: 1n, destination: { ...destination, isActive: false } }), /Inactive reference/);
  assert.throws(() => planActivity({ kind: "expense", amountMinor: 1n, source, category: { ...customExpenseCategory, isActive: false } }), /Inactive reference/);
  assert.throws(() => planActivity({ kind: "expense", amountMinor: 1n, source, category: { ...customExpenseCategory, appliesTo: "income" } }), /does not apply/);
  assert.throws(() => planActivity({ kind: "expense", amountMinor: 1n, source, charges: [{ id: "old", amountMinor: 1n, type: { ...builtInFee, isActive: false } }] }), /Inactive reference/);
  assert.throws(() => planActivity({ kind: "expense", amountMinor: 1n, source, charges: [{ id: "orphan", amountMinor: 1n }] }), /Unknown reference/);
});

test("asset admin fee & deposit interest terms encode, parse, strip cleanly, and compute exact net yield", () => {
  const ruleUuid = "11111111-2222-4333-8444-555555555555";
  const encoded = encodeAssetTermsNote("Tabungan utama gaji", {
    adminFeeMinor: 11000n,
    adminDay: 25,
    autoPostAdminFee: true,
    interestRateBps: parseBpsInput("4,25"),
    interestTaxBps: parseBpsInput("20"),
    interestCycle: "monthly",
    interestDay: 25,
    adminRuleId: ruleUuid,
  });
  assert.ok(encoded?.startsWith("[ACCT:"));
  const parsed = parseAssetTerms(encoded);
  assert.equal(parsed.hasTerms, true);
  assert.equal(parsed.adminFeeMinor, 11000n);
  assert.equal(parsed.adminDay, 25);
  assert.equal(parsed.autoPostAdminFee, true);
  assert.equal(parsed.interestRateBps, 425);
  assert.equal(parsed.interestTaxBps, 2000);
  assert.equal(parsed.interestCycle, "monthly");
  assert.equal(parsed.adminRuleId, ruleUuid);
  assert.equal(parsed.cleanNote, "Tabungan utama gaji");
  assert.equal(formatBpsRate(parsed.interestRateBps), "4,25%");
  assert.equal(bpsToInput(parsed.interestRateBps), "4,25");
  assert.equal(stripAssetMetaTags(encoded), "Tabungan utama gaji");

  // Switching between regular account terms and credit meta never leaves stale tags behind
  const switchedToCredit = encodeCreditNote(encoded, true, { dueDay: 1, cutoffDay: 20, limitMinor: 5000000n });
  assert.ok(switchedToCredit?.startsWith("[CREDIT:"));
  assert.doesNotMatch(switchedToCredit ?? "", /\[ACCT:/);
  assert.equal(parseCreditMeta(switchedToCredit).cleanNote, "Tabungan utama gaji");

  // 12,000,000 IDR @ 6% p.a. (600 bps) = 720,000/yr gross -> 60,000/mo gross -> 20% tax = 12,000 -> 48,000 net/mo; minus 11,000 admin = +37,000/mo
  const yieldEst = estimateAssetMonthlyYield(12000000n, {
    adminFeeMinor: 11000n,
    interestRateBps: 600,
    interestTaxBps: 2000,
  });
  assert.equal(yieldEst.grossMonthlyMinor, 60000n);
  assert.equal(yieldEst.taxMonthlyMinor, 12000n);
  assert.equal(yieldEst.netInterestMonthlyMinor, 48000n);
  assert.equal(yieldEst.netAfterAdminMonthlyMinor, 37000n);
});

test("dedicated system categories (e.g. bank admin fee) are identified to avoid crowding manual dropdowns", () => {
  assert.equal(isDedicatedCategory({ displayName: "Biaya Admin Rekening" }), true);
  assert.equal(isDedicatedCategory({ displayName: "biaya admin" }), true);
  assert.equal(isDedicatedCategory({ displayName: "Biaya Admin Bank" }), true);
  assert.equal(isDedicatedCategory({ systemKey: "bank_admin_fee" }), true);
  assert.equal(isDedicatedCategory({ displayName: "Makanan" }), false);
  assert.equal(isDedicatedCategory({ displayName: "Belanja" }), false);
  assert.equal(isDedicatedCategory({ displayName: "Transport" }), false);
  assert.equal(isDedicatedCategory({ displayName: "Rumah Tangga" }), false);
});

test("receivable / talangan / split bill accounts are identified accurately", () => {
  assert.equal(isReceivableAsset({ displayName: "Piutang & Talangan", note: "" }), true);
  assert.equal(isReceivableAsset({ displayName: "Talangan Teman Kantor", note: null }), true);
  assert.equal(isReceivableAsset({ displayName: "Reimburse Kantor", note: "" }), true);
  assert.equal(isReceivableAsset({ displayName: "Split Bill Makan", note: "" }), true);
  assert.equal(isReceivableAsset({ displayName: "Kas Darurat", note: "Dana piutang teman" }), true);
  assert.equal(isReceivableAsset({ displayName: "BCA Tabungan", note: "" }), false);
  assert.equal(isReceivableAsset({ displayName: "Mandiri Debit Gold", note: "" }), false);
  assert.equal(isReceivableAsset({ displayName: "SPayLater", note: "[CREDIT:due=1;cutoff=20]" }), false);
});

// ---------------------------------------------------------------------------------------------
// Credit / PayLater billing cycles, deferral, rollover, void release, split bill (audit fixes)
// ---------------------------------------------------------------------------------------------
const credit = await import("../src/lib/domain/credit.ts");
const { planSplitBill } = await import("../src/lib/domain/split-bill.ts");
// Jakarta Nov 25 2026 12:00, due day 1, cutoff 20: nearest bill is due Dec 1 and closed on Nov 20.
const NOV_25 = new Date("2026-11-25T05:00:00Z");
const DEC_03 = new Date("2026-12-03T05:00:00Z");
const DEC_25 = new Date("2026-12-25T05:00:00Z");
const creditNote = (state) => credit.encodeCreditNote("PayLater", true, state);
const billsAt = (balanceMinor, note, now) => {
  const bills = credit.computeCreditBills({ balanceMinor: String(balanceMinor), note }, now);
  return { current: bills.currentBillMinor, next: bills.nextBillMinor, total: bills.totalUnpaidMinor };
};

test("credit form round-trips typed bills against the ledger balance (-300k = 100k now + 200k next)", () => {
  const input = { balanceMinor: -300000n, desiredCurrentMinor: 100000n, desiredNextMinor: 200000n,
    dueDay: 1, cutoffDay: 20, limitMinor: 0n, now: NOV_25 };
  const state = credit.creditStateForDesiredBills(input);
  assert.equal(state.carryCurrentMinor, -200000n);
  assert.equal(state.anchorDueIso, "2026-12-01");
  const note = creditNote(state);
  assert.deepEqual(billsAt(-300000n, note, NOV_25), { current: 100000n, next: 200000n, total: 300000n });
  // Re-saving the form unchanged keeps the same bills.
  const bills = credit.computeCreditBills({ balanceMinor: "-300000", note }, NOV_25);
  const again = credit.creditStateForDesiredBills({ ...input, desiredCurrentMinor: bills.currentBillMinor, desiredNextMinor: bills.nextBillMinor });
  assert.deepEqual(billsAt(-300000n, creditNote(again), NOV_25), { current: 100000n, next: 200000n, total: 300000n });
});

test("PayLater next-cycle deferral does not depend on a stale or fresh balance read", () => {
  const opening = creditNote(credit.creditStateForDesiredBills({ balanceMinor: 0n, desiredCurrentMinor: 0n, desiredNextMinor: 0n,
    dueDay: 1, cutoffDay: 20, limitMinor: 1000000n, now: NOV_25 }));
  // 100k bought before the cutoff goes to the current bill; 50k + 1.5k fee after the cutoff goes to the next bill.
  assert.equal(credit.isAfterCutoffDay("2026-11-10T03:00:00.000Z", 20, 1, NOV_25), false);
  assert.equal(credit.isAfterCutoffDay("2026-11-24T03:00:00.000Z", 20, 1, NOV_25), true);
  const impact = credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "50000", transferFeeMinor: "1500" });
  assert.equal(impact, 51500n);
  const deferred = creditNote(credit.deferCreditCharge(credit.parseCreditMeta(opening), impact, NOV_25));
  assert.deepEqual(billsAt(-151500n, deferred, NOV_25), { current: 100000n, next: 51500n, total: 151500n });
  assert.equal(credit.computeCreditBills({ balanceMinor: "-151500", note: deferred }, NOV_25).availableLimitMinor, 848500n);
});

test("credit rollover folds the old next bill into the current bill and starts a fresh next bucket", () => {
  const form = creditNote(credit.creditStateForDesiredBills({ balanceMinor: -300000n, desiredCurrentMinor: 100000n, desiredNextMinor: 200000n,
    dueDay: 1, cutoffDay: 20, limitMinor: 0n, now: NOV_25 }));
  const withDeferred = creditNote(credit.deferCreditCharge(credit.parseCreditMeta(form), 50000n, NOV_25));
  assert.deepEqual(billsAt(-350000n, withDeferred, NOV_25), { current: 100000n, next: 250000n, total: 350000n });
  // After Dec 1 passes, the Jan 1 bill is the nearest one: every scheduled amount is now current.
  assert.equal(credit.isCreditCycleShifted(credit.parseCreditMeta(withDeferred), DEC_03), true);
  assert.deepEqual(billsAt(-350000n, withDeferred, DEC_03), { current: 350000n, next: 0n, total: 350000n });
  // A purchase after the Dec 20 cutoff goes to the Feb 1 bill without moving the Jan 1 bill.
  const rolled = credit.deferCreditCharge(credit.parseCreditMeta(withDeferred), 30000n, DEC_25);
  assert.equal(rolled.carryCurrentMinor, 0n);
  assert.equal(rolled.carryNextMinor, 0n);
  assert.equal(rolled.deferredMinor, 30000n);
  assert.equal(rolled.anchorDueIso, "2027-01-01");
  assert.deepEqual(billsAt(-380000n, creditNote(rolled), DEC_25), { current: 350000n, next: 30000n, total: 380000n });
});

test("credit rollover with an overpaid balance keeps the overpayment (stale-balance formula regression)", () => {
  const meta = credit.parseCreditMeta(creditNote({ dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n,
    carryNextMinor: 0n, deferredMinor: 0n, anchorDueIso: "2026-12-01" }));
  // Owner overpaid by 50k (balance +50k), then spends 100k after the Dec cutoff: only 50k is really owed.
  const rolled = creditNote(credit.deferCreditCharge(meta, 100000n, DEC_25));
  assert.deepEqual(billsAt(-50000n, rolled, DEC_25), { current: 0n, next: 50000n, total: 50000n });
});

test("voiding or correcting a deferred credit outflow releases the next-cycle bucket", () => {
  const opening = creditNote({ dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, carryNextMinor: 0n,
    deferredMinor: 0n, anchorDueIso: "2026-12-01" });
  const deferredMeta = credit.parseCreditMeta(creditNote(credit.deferCreditCharge(credit.parseCreditMeta(opening), 50000n, NOV_25)));
  // Void of the Nov 24 purchase: balance returns to -100k and the next bill must vanish.
  const voided = credit.releaseDeferredCreditCharge(deferredMeta, { occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: 50000n }, NOV_25);
  assert.equal(voided.deferredMinor, 0n);
  assert.deepEqual(billsAt(-100000n, creditNote(voided), NOV_25), { current: 100000n, next: 0n, total: 100000n });
  // Without the release the void would understate the current bill.
  assert.deepEqual(billsAt(-100000n, creditNote(deferredMeta), NOV_25), { current: 50000n, next: 50000n, total: 100000n });
  // Correction 50k to 70k keeps the purchase in the next cycle with its new amount.
  const corrected = credit.releaseDeferredCreditCharge(deferredMeta, { occurredAtIso: "2026-11-24T03:00:00.000Z",
    reversedImpactMinor: 50000n, replacementImpactMinor: 70000n }, NOV_25);
  assert.equal(corrected.deferredMinor, 70000n);
  // A void of a current-cycle purchase (before the cutoff) leaves the next bucket alone.
  assert.equal(credit.releaseDeferredCreditCharge(deferredMeta, { occurredAtIso: "2026-11-10T03:00:00.000Z", reversedImpactMinor: 100000n }, NOV_25), null);
  // After rollover the bucket is part of the current bill, so nothing is released.
  assert.equal(credit.releaseDeferredCreditCharge(deferredMeta, { occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: 50000n }, DEC_03), null);
});

test("credit deferral counts every charge on the credit account but only the first installment", () => {
  assert.equal(credit.creditSourceImpactMinor({ kind: "expense", amountMinor: "100000", charges: [{ amountMinor: "2500" }, { amountMinor: "1000" }] }), 103500n);
  assert.equal(credit.creditSourceImpactMinor({ kind: "income", amountMinor: "100000" }), 0n);
  // Transfer with dual fees: 100k principal, 1k admin at source, 2.5k cut at destination, 3k PayLater interest.
  // The editor posts amount = 100k - 2.5k and fee = 1k + 2.5k + 3k; the credit account loses principal + admin + interest.
  assert.equal(credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "97500", transferFeeMinor: "6500" }), 104000n);
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "300001", tenorMonths: 3, interestMode: "percent",
    interestRatePercent: 2.95, interestFlatMinorStr: "0" });
  // Posted (and deferred) now: first installment only; the rest live in planning obligations.
  const postedNow = BigInt(plan.firstMonthTotalMinor);
  const scheduledLater = plan.futureInstallmentsMinor.reduce((sum, value) => sum + BigInt(value), 0n);
  assert.equal(postedNow + scheduledLater, BigInt(plan.grandTotalMinor));
  assert.equal(plan.futureInstallmentsMinor.length, 2);
  assert.equal(postedNow, 100001n + 8850n);
});

test("split bill keeps personal spending, fronted share, and charges apart", () => {
  assert.deepEqual(planSplitBill({ totalMinor: 300000n, reimbursedMinor: 200000n, chargesMinor: 5000n }),
    { personalMinor: 100000n, reimbursedMinor: 200000n, sourceOutflowMinor: 305000n });
  assert.deepEqual(planSplitBill({ totalMinor: 300000n, reimbursedMinor: 300000n }),
    { personalMinor: 0n, reimbursedMinor: 300000n, sourceOutflowMinor: 300000n });
  assert.throws(() => planSplitBill({ totalMinor: 300000n, reimbursedMinor: 300000n, chargesMinor: 5000n }), /porsi pribadi/);
  assert.throws(() => planSplitBill({ totalMinor: 300000n, reimbursedMinor: 300001n }), /talangan/);
  assert.throws(() => planSplitBill({ totalMinor: 300000n, reimbursedMinor: 0n }), /talangan/);
});

test("receivables and credit lines are never reserve sources", () => {
  const base = { isActive: true, normallyLiquid: true, normallySpendable: true, providerName: null, assetTypeName: "Rekening bank",
    assetGroupName: null, note: null };
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "BCA Utama" }), true);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "Piutang & Talangan" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "Dompet", note: "Akun penampung split bill" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "SPayLater" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "BCA Utama", note: "[CREDIT:due=5,cutoff=25]" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "BCA Utama", normallySpendable: false }), false);
});

// Installment top-up via PayLater and per-activity cycle tracking (manual overrides).
const ACT_A = "a1b2c3d4-0000-4000-8000-000000000001";
const ACT_B = "b2c3d4e5-0000-4000-8000-000000000002";
const ACT_C = "c3d4e5f6-0000-4000-8000-000000000003";
const ACT_D = "d4e5f6a7-0000-4000-8000-000000000004";
const freshCredit = () => credit.parseCreditMeta(creditNote({ dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n,
  carryNextMinor: 0n, deferredMinor: 0n, deferredEntries: [], anchorDueIso: "2026-12-01" }));
const roundTrip = (state) => credit.parseCreditMeta(creditNote(state));

test("installment top-up delivers the full principal and bills only installment 1 in the nearest cycle", () => {
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "300000", tenorMonths: 3, interestMode: "percent",
    interestRatePercent: 2.95, interestFlatMinorStr: "0" });
  const future = credit.installmentFuturePrincipalMinor(300000n, plan);
  assert.equal(future, 200000n);
  // Posted transfer: 300k to e-money, fee = 1k admin + 8.85k first-month interest. Credit impact 309.85k.
  const impact = credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "300000", transferFeeMinor: String(1000 + 8850) });
  assert.equal(impact, 309850n);
  // Current cycle: nearest bill = installment 1 (100k + 8.85k interest) + 1k admin; future principal waits.
  const current = roundTrip(credit.deferCreditCharge(freshCredit(), impact, NOV_25, { activityId: ACT_A, deferredMinor: future }));
  assert.deepEqual(billsAt(-309850n, creditNote(current), NOV_25), { current: 109850n, next: 200000n, total: 309850n });
  assert.deepEqual(current.deferredEntries, [{ ref: "a1b2c3d4", partMinor: 200000n }]);
  // Next cycle: the whole impact (future principal + installment 1 + fees) waits for the next bill.
  const next = roundTrip(credit.deferCreditCharge(freshCredit(), impact, NOV_25, { activityId: ACT_A, deferredMinor: impact }));
  assert.deepEqual(billsAt(-309850n, creditNote(next), NOV_25), { current: 0n, next: 309850n, total: 309850n });
  assert.deepEqual(next.deferredEntries, [{ ref: "a1b2c3d4", partMinor: null }]);
  // Voiding the current-cycle top-up releases only its future principal.
  const voided = credit.releaseDeferredCreditCharge(current, { activityId: ACT_A, occurredAtIso: "2026-11-10T03:00:00.000Z",
    reversedImpactMinor: impact }, NOV_25);
  assert.equal(voided.deferredMinor, 0n);
  assert.deepEqual(billsAt(0n, creditNote(voided), NOV_25), { current: 0n, next: 0n, total: 0n });
  // Correcting it to a 600k top-up keeps installment 1 billed now and defers the rest.
  const corrected = credit.releaseDeferredCreditCharge(current, { activityId: ACT_A, occurredAtIso: "2026-11-10T03:00:00.000Z",
    reversedImpactMinor: impact, replacementActivityId: ACT_D, replacementImpactMinor: 609850n }, NOV_25);
  assert.equal(corrected.deferredMinor, 500000n);
  assert.deepEqual(corrected.deferredEntries, [{ ref: "d4e5f6a7", partMinor: 500000n }]);
});

test("manual cycle overrides survive void and correction exactly", () => {
  // A: after the cutoff, auto -> next (50k). B: after the cutoff but forced to the current bill (30k).
  // C: before the cutoff but forced to the next bill (20k).
  let meta = roundTrip(credit.deferCreditCharge(freshCredit(), 50000n, NOV_25, { activityId: ACT_A }));
  meta = roundTrip(credit.deferCreditCharge(meta, 20000n, NOV_25, { activityId: ACT_C }));
  assert.equal(meta.deferredMinor, 70000n);
  assert.deepEqual(meta.deferredEntries.map((entry) => entry.ref), ["a1b2c3d4", "c3d4e5f6"]);
  assert.match(creditNote(meta), /dl=a1b2c3d4\.c3d4e5f6/);
  // Balance: 100k earlier + A 50k + B 30k + C 20k = -200k. Current = 100k + B 30k, next = A + C.
  assert.deepEqual(billsAt(-200000n, creditNote(meta), NOV_25), { current: 130000n, next: 70000n, total: 200000n });
  // Void B (after the cutoff, but recorded as current): the next bucket must not move.
  assert.equal(credit.releaseDeferredCreditCharge(meta, { activityId: ACT_B, occurredAtIso: "2026-11-24T03:00:00.000Z",
    reversedImpactMinor: 30000n }, NOV_25), null);
  assert.deepEqual(billsAt(-170000n, creditNote(meta), NOV_25), { current: 100000n, next: 70000n, total: 170000n });
  // Void C (before the cutoff, but recorded as next): its 20k leaves the next bucket.
  const afterC = credit.releaseDeferredCreditCharge(meta, { activityId: ACT_C, occurredAtIso: "2026-11-10T03:00:00.000Z",
    reversedImpactMinor: 20000n }, NOV_25);
  assert.equal(afterC.deferredMinor, 50000n);
  assert.deepEqual(afterC.deferredEntries, [{ ref: "a1b2c3d4", partMinor: null }]);
  assert.deepEqual(billsAt(-150000n, creditNote(afterC), NOV_25), { current: 100000n, next: 50000n, total: 150000n });
  // Correct A from 50k to 45k: the replacement inherits the next cycle.
  const afterA = credit.releaseDeferredCreditCharge(roundTrip(afterC), { activityId: ACT_A, occurredAtIso: "2026-11-24T03:00:00.000Z",
    reversedImpactMinor: 50000n, replacementActivityId: ACT_D, replacementImpactMinor: 45000n }, NOV_25);
  assert.equal(afterA.deferredMinor, 45000n);
  assert.deepEqual(afterA.deferredEntries, [{ ref: "d4e5f6a7", partMinor: null }]);
});

test("credit tag keeps older untracked notes on the cutoff-date rule", () => {
  const legacy = credit.parseCreditMeta("[CREDIT:due=1,cutoff=20,def=50000,anchor=2026-12-01] PayLater");
  assert.equal(legacy.deferredEntries, null);
  // A tracked deferral on top of an untracked bucket stays untracked until the next rollover.
  assert.equal(credit.deferCreditCharge(legacy, 10000n, NOV_25, { activityId: ACT_A }).deferredEntries, null);
  const released = credit.releaseDeferredCreditCharge(legacy, { activityId: ACT_A, occurredAtIso: "2026-11-24T03:00:00.000Z",
    reversedImpactMinor: 50000n }, NOV_25);
  assert.equal(released.deferredMinor, 0n);
  // After rollover the bucket restarts tracked.
  assert.deepEqual(credit.deferCreditCharge(legacy, 10000n, DEC_25, { activityId: ACT_A }).deferredEntries, [{ ref: "a1b2c3d4", partMinor: null }]);
  // Malformed entries are treated as untracked rather than trusted.
  assert.equal(credit.parseCreditMeta("[CREDIT:due=1,def=5,dl=zz] x").deferredEntries, null);
  // The meta tag, including the entry list, never leaks into the visible note.
  assert.equal(credit.parseCreditMeta("[CREDIT:due=1,def=5,dl=a1b2c3d4~5] Kartu").cleanNote, "Kartu");
});
