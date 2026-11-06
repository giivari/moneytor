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

test("receivable accounts are identified by asset class, not by name or note (migration 015)", () => {
  assert.equal(isReceivableAsset({ displayName: "Piutang & Talangan", note: "", assetClass: "receivable" }), true);
  assert.equal(isReceivableAsset({ displayName: "Talangan Teman Kantor", note: null, assetClass: "receivable" }), true);
  assert.equal(isReceivableAsset({ displayName: "Uang di Andi", note: null, assetClass: "receivable" }), true);
  assert.equal(isReceivableAsset({ displayName: "Kas Darurat", note: "Dana piutang teman", assetClass: "asset" }), false);
  assert.equal(isReceivableAsset({ displayName: "BCA Tabungan", note: "", assetClass: "asset" }), false);
  assert.equal(isReceivableAsset({ displayName: "SPayLater", note: "[CREDIT:due=1;cutoff=20]", assetClass: "liability" }), false);
});

// ---------------------------------------------------------------------------------------------
// Credit / PayLater monthly bill schedule, installments, void/replace, split bill, reserve sources
// ---------------------------------------------------------------------------------------------
const credit = await import("../src/lib/domain/credit.ts");
const { planSplitBill } = await import("../src/lib/domain/split-bill.ts");
// Due day 1, cutoff 20. On Nov 25 (Jakarta) the nearest bill is due Dec 1 (closed Nov 20), the next Jan 1.
const NOV_25 = new Date("2026-11-25T05:00:00Z");
const DEC_03 = new Date("2026-12-03T05:00:00Z");
const DEC_25 = new Date("2026-12-25T05:00:00Z");
const JAN_03 = new Date("2027-01-03T05:00:00Z");
const ACT_A = "a1b2c3d4-0000-4000-8000-000000000001";
const ACT_B = "b2c3d4e5-0000-4000-8000-000000000002";
const ACT_C = "c3d4e5f6-0000-4000-8000-000000000003";
const ACT_D = "d4e5f6a7-0000-4000-8000-000000000004";
const creditNote = (state) => credit.encodeCreditNote("PayLater", true, state);
const meta = (state, now = NOV_25) => credit.parseCreditMeta(creditNote(state), now);
const fresh = (limitMinor = 0n) => meta({ dueDay: 1, cutoffDay: 20, limitMinor, carryCurrentMinor: 0n, schedule: [] });
const billsAt = (balanceMinor, stateOrNote, now) => {
  const note = typeof stateOrNote === "string" ? stateOrNote : creditNote(stateOrNote);
  const bills = credit.computeCreditBills({ balanceMinor: String(balanceMinor), note }, now);
  return { current: bills.currentBillMinor, next: bills.nextBillMinor, later: bills.laterBillMinor, total: bills.totalUnpaidMinor };
};
const plan3x = () => credit.calculateCreditInstallmentPlan({ principalMinorStr: "300000", tenorMonths: 3, interestMode: "percent",
  interestRatePercent: 2.95, interestFlatMinorStr: "0" });
const terms = (plan, count) => ({ count, principalMinor: BigInt(plan.monthlyPrincipalMinor), interestMinor: BigInt(plan.monthlyInterestMinor) });

test("credit form round-trips typed bills and keeps installments due after the next bill", () => {
  const input = { balanceMinor: -300000n, desiredCurrentMinor: 100000n, desiredNextMinor: 200000n,
    dueDay: 1, cutoffDay: 20, limitMinor: 0n, now: NOV_25 };
  const state = credit.creditStateForDesiredBills(input);
  assert.deepEqual(billsAt(-300000n, state, NOV_25), { current: 100000n, next: 200000n, later: 0n, total: 300000n });
  // Saving the form again with what it shows changes nothing.
  assert.deepEqual(billsAt(-300000n, credit.creditStateForDesiredBills({ ...input, existing: meta(state) }), NOV_25),
    { current: 100000n, next: 200000n, later: 0n, total: 300000n });
  // A 3x top-up adds installments in Feb and Mar; editing current/next in the form must not drop them.
  const plan = plan3x();
  const withTopUp = credit.scheduleCreditCharge(meta(state), 309850n, NOV_25,
    { activityId: ACT_A, cycle: "current", kind: "transfer", installments: terms(plan, 3) });
  const edited = credit.creditStateForDesiredBills({ ...input, balanceMinor: -609850n, desiredCurrentMinor: 150000n, existing: meta(withTopUp) });
  const bills = billsAt(-609850n, edited, NOV_25);
  assert.equal(bills.current, 150000n);
  assert.equal(bills.later, 108850n);
});

test("PayLater next-cycle purchase is billed in its own month and rolls over by calendar alone", () => {
  assert.equal(credit.isAfterCutoffDay("2026-11-10T03:00:00.000Z", 20, 1, NOV_25), false);
  assert.equal(credit.isAfterCutoffDay("2026-11-24T03:00:00.000Z", 20, 1, NOV_25), true);
  assert.equal(credit.autoCreditPeriodFor("2026-11-10T03:00:00.000Z", 1, 20), "2026-12");
  assert.equal(credit.autoCreditPeriodFor("2026-11-24T03:00:00.000Z", 1, 20), "2027-01");
  const impact = credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "50000", transferFeeMinor: "1500" });
  assert.equal(impact, 51500n);
  const state = credit.scheduleCreditCharge(fresh(1000000n), impact, NOV_25, { activityId: ACT_A, cycle: "next", kind: "transfer" });
  assert.deepEqual(state.schedule, [{ period: "2027-01", amountMinor: 51500n, ref: "a1b2c3d4", offLedger: false }]);
  // 100k bought earlier in the current cycle + this 51.5k. The note never reads the balance.
  assert.deepEqual(billsAt(-151500n, state, NOV_25), { current: 100000n, next: 51500n, later: 0n, total: 151500n });
  assert.equal(credit.computeCreditBills({ balanceMinor: "-151500", note: creditNote(state) }, NOV_25).availableLimitMinor, 848500n);
  // After Dec 1 passes, January is the nearest bill: no rewrite needed.
  assert.deepEqual(billsAt(-151500n, state, DEC_03), { current: 151500n, next: 0n, later: 0n, total: 151500n });
  // A purchase after the Dec 20 cutoff goes to February without moving January.
  const feb = credit.scheduleCreditCharge(meta(state, DEC_25), 30000n, DEC_25, { activityId: ACT_B, cycle: "next", kind: "expense" });
  assert.deepEqual(billsAt(-181500n, feb, DEC_25), { current: 151500n, next: 30000n, later: 0n, total: 181500n });
});

test("3x installment top-up: installment 1 now, installment 2 next month, installment 3 stays in its own month", () => {
  const plan = plan3x();
  assert.equal(credit.installmentFuturePrincipalMinor(300000n, plan), 200000n);
  // Transfer of the full 300k to e-money, fee = 1k admin + 8.85k first-month interest.
  const impact = credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "300000", transferFeeMinor: String(1000 + 8850) });
  assert.equal(impact, 309850n);
  const state = credit.scheduleCreditCharge(fresh(2000000n), impact, NOV_25,
    { activityId: ACT_A, cycle: "current", kind: "transfer", installments: terms(plan, 3) });
  // Principal of months 2..3 is in the ledger; their interest is owed on top of it.
  assert.ok(creditNote(state).includes(`sch=a1b2c3d4@202701~${(100000).toString(36)}*2.a1b2c3d4@202701~${(8850).toString(36)}*2+`));
  const month1 = billsAt(-309850n, state, NOV_25);
  assert.deepEqual(month1, { current: 109850n, next: 108850n, later: 108850n, total: 327550n });
  assert.equal(credit.computeCreditBills({ balanceMinor: "-309850", note: creditNote(state) }, NOV_25).availableLimitMinor, 2000000n - 327550n);
  // Month 2 after paying installment 1: only installment 2 is current, installment 3 is next.
  assert.deepEqual(billsAt(-200000n, state, DEC_03), { current: 108850n, next: 108850n, later: 0n, total: 217700n });
  // Month 2 without paying: installment 1 is in arrears and adds to the current bill.
  assert.deepEqual(billsAt(-309850n, state, DEC_03), { current: 218700n, next: 108850n, later: 0n, total: 327550n });
  // Month 3 after paying installment 2 (108.85k incl. interest): installment 3 is the only bill left.
  assert.deepEqual(billsAt(-200000n + 108850n, state, JAN_03), { current: 108850n, next: 0n, later: 0n, total: 108850n });
  // Next-cycle top-up: every installment moves one month later.
  const next = credit.scheduleCreditCharge(fresh(), impact, NOV_25, { activityId: ACT_A, cycle: "next", kind: "transfer", installments: terms(plan, 3) });
  assert.deepEqual(billsAt(-309850n, next, NOV_25), { current: 0n, next: 109850n, later: 217700n, total: 327550n });
  assert.deepEqual(billsAt(-309850n, next, DEC_03), { current: 109850n, next: 108850n, later: 108850n, total: 327550n });
});

test("6x installment purchase: future installments are owed off-ledger in their own months", () => {
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "600000", tenorMonths: 6, interestMode: "flat_minor",
    interestRatePercent: 0, interestFlatMinorStr: "5000" });
  // Only installment 1 (105k) is posted as the expense.
  const state = credit.scheduleCreditCharge(fresh(), BigInt(plan.firstMonthTotalMinor), NOV_25,
    { activityId: ACT_C, cycle: "current", kind: "expense", installments: terms(plan, 6) });
  assert.ok(creditNote(state).includes(`sch=c3d4e5f6@202701~${(105000).toString(36)}*5+`));
  assert.deepEqual(billsAt(-105000n, state, NOV_25), { current: 105000n, next: 105000n, later: 420000n, total: 630000n });
  assert.equal(credit.computeCreditBills({ balanceMinor: "-105000", note: creditNote(state) }, NOV_25).totalUnpaidMinor,
    BigInt(plan.grandTotalMinor));
  // Paying installment 1, then month 2.
  assert.deepEqual(billsAt(0n, state, DEC_03), { current: 105000n, next: 105000n, later: 315000n, total: 525000n });
  assert.throws(() => credit.scheduleCreditCharge(fresh(), 1000n, NOV_25,
    { activityId: ACT_C, cycle: "current", kind: "transfer", installments: { count: 3, principalMinor: 1000n, interestMinor: 0n } }), /melebihi/);
});

test("void and correction remove or reshape exactly the months an activity owns", () => {
  const plan = plan3x();
  const topUp = credit.scheduleCreditCharge(fresh(), 309850n, NOV_25,
    { activityId: ACT_A, cycle: "current", kind: "transfer", installments: terms(plan, 3) });
  const withNext = meta(credit.scheduleCreditCharge(meta(topUp), 50000n, NOV_25, { activityId: ACT_B, cycle: "next", kind: "expense" }));
  // Void the top-up: its principal and interest months go, the other purchase stays.
  const voided = credit.releaseCreditCharge(withNext, { activityId: ACT_A, occurredAtIso: "2026-11-10T03:00:00.000Z", reversedImpactMinor: 309850n }, NOV_25);
  assert.deepEqual(voided.schedule.map((entry) => entry.ref), ["b2c3d4e5"]);
  assert.deepEqual(billsAt(-150000n, voided, NOV_25), { current: 100000n, next: 50000n, later: 0n, total: 150000n });
  // Correct the next-cycle purchase 50k -> 70k: the replacement owns the January amount.
  const corrected = credit.releaseCreditCharge(meta(voided), { activityId: ACT_B, occurredAtIso: "2026-11-24T03:00:00.000Z",
    reversedImpactMinor: 50000n, replacementActivityId: ACT_D, replacementImpactMinor: 70000n }, NOV_25);
  assert.deepEqual(corrected.schedule, [{ period: "2027-01", amountMinor: 70000n, ref: "d4e5f6a7", offLedger: false }]);
  // Correct the top-up to a smaller 150k (impact 154.85k): months keep their principal while it fits.
  const smaller = credit.releaseCreditCharge(withNext, { activityId: ACT_A, occurredAtIso: "2026-11-10T03:00:00.000Z",
    reversedImpactMinor: 309850n, replacementActivityId: ACT_D, replacementImpactMinor: 154850n }, NOV_25);
  const owned = smaller.schedule.filter((entry) => entry.ref === "d4e5f6a7" && !entry.offLedger);
  assert.equal(owned.reduce((sum, entry) => sum + entry.amountMinor, 0n), 154850n);
});

test("manual cycle overrides are honoured on void because the schedule records the effective cycle", () => {
  // A: after the cutoff, auto -> next (50k). B: after the cutoff, forced to the current bill (30k, not scheduled).
  // C: before the cutoff, forced to the next bill (20k).
  let state = credit.scheduleCreditCharge(fresh(), 50000n, NOV_25, { activityId: ACT_A, cycle: "next", kind: "expense" });
  state = credit.scheduleCreditCharge(meta(state), 30000n, NOV_25, { activityId: ACT_B, cycle: "current", kind: "expense" });
  state = credit.scheduleCreditCharge(meta(state), 20000n, NOV_25, { activityId: ACT_C, cycle: "next", kind: "expense" });
  // A form-typed January amount must never be touched by a void.
  state = { ...state, carryCurrentMinor: state.carryCurrentMinor + 10000n,
    schedule: [...state.schedule, { period: "2027-01", amountMinor: 10000n, ref: null, offLedger: false }] };
  assert.deepEqual(billsAt(-200000n, state, NOV_25), { current: 130000n, next: 80000n, later: 0n, total: 210000n });
  const m = meta(state);
  assert.equal(credit.releaseCreditCharge(m, { activityId: ACT_B, occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: 30000n }, NOV_25), null);
  const afterC = credit.releaseCreditCharge(m, { activityId: ACT_C, occurredAtIso: "2026-11-10T03:00:00.000Z", reversedImpactMinor: 20000n }, NOV_25);
  assert.deepEqual(billsAt(-180000n, afterC, NOV_25), { current: 130000n, next: 60000n, later: 0n, total: 190000n });
});

test("older single-bucket notes convert to monthly schedules without changing the bills", () => {
  const legacy = "[CREDIT:due=1,cutoff=20,cur=-200000,next=200000,def=50000,anchor=2026-12-01] PayLater";
  assert.deepEqual(billsAt(-350000n, legacy, NOV_25), { current: 100000n, next: 250000n, later: 0n, total: 350000n });
  assert.deepEqual(billsAt(-350000n, legacy, DEC_03), { current: 350000n, next: 0n, later: 0n, total: 350000n });
  const m = credit.parseCreditMeta(legacy, NOV_25);
  assert.equal(m.cleanNote, "PayLater");
  // Converted deferred amounts keep the cutoff-date fallback; the converted "next" amount is left alone.
  const released = credit.releaseCreditCharge(m, { activityId: ACT_A, occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: 50000n }, NOV_25);
  assert.deepEqual(billsAt(-300000n, released, NOV_25), { current: 100000n, next: 200000n, later: 0n, total: 300000n });
  assert.equal(credit.releaseCreditCharge(m, { activityId: ACT_A, occurredAtIso: "2026-11-10T03:00:00.000Z", reversedImpactMinor: 50000n }, NOV_25), null);
  // Tracked parts from the previous format keep their owner.
  const tracked = credit.parseCreditMeta(`[CREDIT:due=1,def=70000,dl=a1b2c3d4~${(70000).toString(36)}.b2c3d4e5,anchor=2026-12-01] x`, NOV_25);
  assert.deepEqual(tracked.schedule.map((e) => [e.ref, e.amountMinor]), [["a1b2c3d4", 70000n]]);
  // Re-encoding drops the old keys.
  assert.doesNotMatch(creditNote(m), /next=|def=|anchor=|dl=/);
});

test("credit note stays within 1000 characters without changing the bills", () => {
  const longNote = "x".repeat(900);
  let state = { dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] };
  for (let i = 0; i < 12; i++) {
    const id = `${(0x10000000 + i * 7919).toString(16)}-0000-4000-8000-000000000000`;
    state = credit.scheduleCreditCharge(credit.parseCreditMeta(credit.encodeCreditNote("n", true, state), NOV_25), 1000n + BigInt(i), NOV_25,
      { activityId: id, cycle: "next", kind: "expense" });
  }
  const before = billsAt(-50000n, state, NOV_25);
  const fitted = credit.fitCreditNote(longNote, state, NOV_25);
  assert.ok(fitted.length <= 1000);
  const bills = credit.computeCreditBills({ balanceMinor: "-50000", note: fitted }, NOV_25);
  assert.deepEqual({ current: bills.currentBillMinor, next: bills.nextBillMinor, later: bills.laterBillMinor, total: bills.totalUnpaidMinor }, before);
  // Past months fold into carryCurrent once their owners are no longer needed for exact voids.
  const folded = credit.compactCreditState(state, DEC_03, true);
  assert.equal(folded.schedule.length, 0);
  assert.deepEqual(billsAt(-50000n, folded, DEC_03), billsAt(-50000n, state, DEC_03));
});

test("credit installment reminders are excluded from planning totals so creditDebt counts them once", async () => {
  const plan = plan3x();
  const state = credit.scheduleCreditCharge(fresh(), 309850n, NOV_25,
    { activityId: ACT_A, cycle: "current", kind: "transfer", installments: terms(plan, 3) });
  // Dec 3, installment 1 paid: installment 2 is the current bill (due Jan 1, inside the 30-day horizon)
  // and installment 3 is the next bill (due Feb 1, outside it).
  const bills = credit.computeCreditBills({ balanceMinor: "-200000", note: creditNote(state) }, DEC_03);
  const throughDay = "2027-01-02";
  const creditDebt = bills.currentBillMinor + (bills.nextDueIso <= throughDay ? bills.nextBillMinor : 0n);
  const reminderNote = `${credit.CREDIT_REMINDER_NOTE_PREFIX} cicilan ini sudah termasuk tagihan PayLater jatuh tempo 1 Jan.`;
  const obligations = [
    { amountMinor: 108850n, dueOn: "2027-01-01", note: reminderNote },
    { amountMinor: 108850n, dueOn: "2027-02-01", note: reminderNote },
    { amountMinor: 75000n, dueOn: "2026-12-20", note: "Listrik" },
    { amountMinor: 40000n, dueOn: "2026-12-28", note: null },
  ];
  const dueMinor = obligations.filter((o) => o.dueOn <= throughDay && !credit.isCreditReminderNote(o.note))
    .reduce((sum, o) => sum + o.amountMinor, 0n);
  assert.equal(creditDebt, 108850n);
  assert.equal(dueMinor + creditDebt, 75000n + 40000n + 108850n);
  assert.equal(credit.isCreditReminderNote("Cicilan otomatis dari transaksi X"), false);
  // The SQL used by financeSnapshot and Insights applies the same rule, and the editor writes the prefix.
  const { readFileSync } = await import("node:fs");
  const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.match(source("../src/lib/planning/repository.ts"), /o\.note NOT LIKE \$2[\s\S]*\[throughDay,creditReminderPattern\]/);
  assert.match(source("../src/lib/analytics/queries.ts"), /o\.note NOT LIKE \$4[\s\S]*CREDIT_REMINDER_NOTE_PREFIX/);
  assert.match(source("../src/components/transaction-editor.tsx"), /note: `\$\{CREDIT_REMINDER_NOTE_PREFIX\}/);
});

test("credit deferral counts every charge on the credit account", () => {
  assert.equal(credit.creditSourceImpactMinor({ kind: "expense", amountMinor: "100000", charges: [{ amountMinor: "2500" }, { amountMinor: "1000" }] }), 103500n);
  assert.equal(credit.creditSourceImpactMinor({ kind: "income", amountMinor: "100000" }), 0n);
  // Dual fees: 100k principal, 1k admin at source, 2.5k cut at destination, 3k interest -> credit loses 104k.
  assert.equal(credit.creditSourceImpactMinor({ kind: "transfer", amountMinor: "97500", transferFeeMinor: "6500" }), 104000n);
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
    assetGroupName: null, note: null, assetClass: "asset" };
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "BCA Utama" }), true);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "Piutang & Talangan", assetClass: "receivable" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "Dompet", assetClass: "receivable" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "SPayLater", assetClass: "liability" }), false);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "Dana Cicilan Motor" }), true);
  assert.equal(credit.isReserveSourceAsset({ ...base, displayName: "BCA Utama", normallySpendable: false }), false);
});
