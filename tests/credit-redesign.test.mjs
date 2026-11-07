// Known credit-logic bugs (docs/REDESIGN-HANDOFF.md, CLAUDE.md "Jebakan logika"). Pure domain tests: no database.
// Scenario, numbers and assertions are the contract; they must not be loosened to make the fix pass.
import test from "node:test";
import assert from "node:assert/strict";
import * as credit from "../src/lib/domain/credit.ts";
import * as purchase from "../src/lib/domain/credit-purchase.ts";
import { summarizeBalances } from "../src/lib/domain/net-worth.ts";
import { horizonDay } from "../src/lib/domain/planning.ts";

const NOW = new Date("2026-11-25T05:00:00Z");
const THROUGH_DAY = horizonDay("2026-11-25", 30);
const CREDIT_NOTE = credit.encodeCreditNote("", true, { dueDay: 1, cutoffDay: 20, limitMinor: 0n, carryCurrentMinor: 0n, schedule: [] });

let serial = 0;
function asset(overrides) {
  serial++;
  return {
    id: `00000000-0000-4000-8000-${String(serial).padStart(12, "0")}`,
    displayName: "Rekening Utama", currency: "IDR", exponent: 0,
    assetTypeId: "type-bank", assetTypeName: "Rekening bank", assetGroupId: null, assetGroupName: null,
    providerId: null, providerName: null, paymentNetworkId: null,
    normallyLiquid: true, normallySpendable: true, safeSuffix: null,
    note: null, isActive: true, openingMinor: "0", balanceMinor: "0",
    assetClass: "asset", creditInstallments: [],
    ...overrides,
  };
}
const creditAccount = (overrides) => asset({ displayName: "Kartu Utama", normallyLiquid: false, normallySpendable: false,
  assetClass: "liability", note: CREDIT_NOTE, ...overrides });
const idr = (assets) => summarizeBalances(assets, [], THROUGH_DAY, NOW).get("IDR");

/** Posts installment purchases and voids them exactly as the transaction editor and finance service do. */
function creditBook(note = CREDIT_NOTE) {
  let state = { note, installments: [] };
  let balance = 0n;
  const impacts = new Map();
  return {
    buy(activityId, plan, tenorMonths) {
      const request = purchase.installmentPurchaseRequest(plan, tenorMonths, "interest-charge-type");
      const impact = BigInt(request.amountMinor) + request.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
      const terms = request.creditInstallments;
      state = purchase.applyCreditPost(state, { activityId, impactMinor: impact, cycle: "current", kind: "expense",
        installments: { count: terms.count, principalMinor: BigInt(terms.principalMinor), interestMinor: BigInt(terms.interestMinor) } }, NOW);
      balance -= impact;
      impacts.set(activityId, impact);
    },
    void(activityId) {
      const impact = impacts.get(activityId);
      state = purchase.applyCreditVoid(state, { activityId, occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: impact }, NOW) ?? state;
      balance += impact;
    },
    asset: (overrides = {}) => creditAccount({ balanceMinor: balance.toString(), note: state.note, creditInstallments: state.installments, ...overrides }),
    get state() { return state; },
  };
}
const plan12x = (principal, ratePercent) => credit.calculateCreditInstallmentPlan({
  principalMinorStr: String(principal), tenorMonths: 12, interestMode: "percent", interestRatePercent: ratePercent, interestFlatMinorStr: "0",
});

test("(a) nama berkata kredit/cicilan/pinjaman tidak membuat akun jadi kredit; kelas akun yang menentukan", () => {
  assert.equal(credit.isCreditAsset(asset({ displayName: "Piutang Pinjaman ke Budi", assetClass: "receivable" })), false);
  assert.equal(credit.isCreditAsset(asset({ displayName: "Dana Kredit Mahasiswa", assetClass: "asset" })), false);
  assert.equal(credit.isCreditAsset(asset({ displayName: "Dana Cicilan Motor", assetClass: "asset" })), false);
  assert.equal(credit.isCreditAsset(asset({ displayName: "Kartu Utama", assetClass: "liability", note: null })), true);
  assert.equal(credit.isReceivableAsset(asset({ displayName: "Piutang Pinjaman ke Budi", assetClass: "receivable" })), true);
  assert.equal(credit.isReceivableAsset(asset({ displayName: "Uang di Andi", assetClass: "receivable" })), true);
});

test("(a) saldo Piutang Pinjaman ke Budi masuk total aset, bukan dana siap pakai", () => {
  const totals = idr([asset({ displayName: "Piutang Pinjaman ke Budi", assetClass: "receivable", balanceMinor: "500000" })]);
  assert.equal(totals.total, 500000n);
  assert.equal(totals.liquid, 0n);
  assert.equal(totals.spendable, 0n);
  assert.equal(totals.creditDebt, 0n);
  assert.equal(totals.netWorth, 500000n);
});

test("(b) kelebihan bayar akun kredit masuk kekayaan bersih dan berstatus Lebih bayar", () => {
  const overpaid = creditAccount({ balanceMinor: "50000" });
  const totals = idr([asset({ balanceMinor: "1000000" }), overpaid]);
  assert.equal(totals.netWorth, 1050000n);
  const bills = credit.computeCreditBills(overpaid, NOW);
  assert.equal(bills.totalUnpaidMinor, 0n);
  assert.equal(bills.overpaidMinor, 50000n);
  assert.equal(credit.creditAccountStatus(bills), "lebih-bayar");
  assert.equal(credit.CREDIT_STATUS_LABEL[credit.creditAccountStatus(bills)], "Lebih bayar");
  const settled = credit.computeCreditBills(creditAccount({ balanceMinor: "0" }), NOW);
  assert.equal(settled.overpaidMinor, 0n);
  assert.equal(credit.CREDIT_STATUS_LABEL[credit.creditAccountStatus(settled)], "Lunas");
});

test("(c) kekayaan bersih memuat seluruh sisa cicilan, termasuk bulan ke-3 dst", () => {
  const plan = plan12x(1200000, 2.95); // 100.000 pokok + 35.400 bunga per bulan
  const book = creditBook();
  book.buy("1a2b3c4d-0000-4000-8000-000000000001", plan, 12);
  const totals = idr([asset({ balanceMinor: "10000000" }), book.asset()]);
  assert.equal(BigInt(plan.grandTotalMinor), 1624800n);
  assert.equal(totals.netWorth, 10000000n - 1624800n);
  // Planning still sees only the bill due within 30 days.
  assert.equal(totals.creditDebt, 135400n);
  const bills = credit.computeCreditBills(book.asset(), NOW);
  assert.equal(bills.totalUnpaidMinor, 1624800n);
  assert.equal(bills.currentBillMinor + bills.nextBillMinor + bills.laterBillMinor, 1624800n);
});

test("(e) void satu dari 60 pembelian 12x tidak meninggalkan cicilan masa depannya", () => {
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "99600", tenorMonths: 12, interestMode: "flat_minor",
    interestRatePercent: 0, interestFlatMinorStr: "0" }); // 8.300 x 12
  const book = creditBook();
  const ids = Array.from({ length: 60 }, (_, i) => `${(0x10000000 + i).toString(16)}-0000-4000-8000-000000000000`);
  for (const id of ids) book.buy(id, plan, 12);
  assert.ok((book.state.note ?? "").length <= 1000);
  assert.equal(credit.computeCreditBills(book.asset(), NOW).totalUnpaidMinor, 60n * 12n * 8300n);
  book.void(ids[17]);
  const bills = credit.computeCreditBills(book.asset(), NOW);
  assert.equal(bills.totalUnpaidMinor, 59n * 12n * 8300n);
  assert.equal(bills.nextBillMinor + bills.laterBillMinor, 59n * 11n * 8300n);
});

test("koreksi pembelian cicilan: editor mengirim ulang tenor dan seluruh request cicilan", () => {
  const original = purchase.installmentPurchaseRequest(plan12x(1200000, 2.95), 12, "interest-type");
  assert.deepEqual(original, { amountMinor: "1200000", charges: [{ typeId: "interest-type", amountMinor: "424800" }],
    creditInstallments: { count: 12, principalMinor: "100000", interestMinor: "35400" } });
  // What listActivities returns for the stored purchase: tenor, month-2 principal, monthly interest.
  const rows = purchase.installmentRowsFor("act", 1624800n, { count: 12, principalMinor: 100000n, interestMinor: 35400n }, "2026-12");
  const stored = { count: rows.length, principalMinor: rows[1].principalMinor, interestMinor: rows[0].interestMinor };
  const defaults = purchase.installmentEditDefaults(stored);
  assert.deepEqual(defaults, { tenorMonths: 12, interestMode: "flat_minor", interestFlatMinor: "35400" });
  const replan = (principal, tenor) => credit.calculateCreditInstallmentPlan({ principalMinorStr: String(principal), tenorMonths: tenor,
    interestMode: defaults.interestMode, interestRatePercent: 0, interestFlatMinorStr: defaults.interestFlatMinor });
  // Unchanged correction reproduces the original request exactly.
  assert.deepEqual(purchase.installmentPurchaseRequest(replan(1200000, defaults.tenorMonths), defaults.tenorMonths, "interest-type"), original);
  // New principal and tenor: a complete new request, from which the server builds the new schedule.
  assert.deepEqual(purchase.installmentPurchaseRequest(replan(900000, 6), 6, "interest-type"), { amountMinor: "900000",
    charges: [{ typeId: "interest-type", amountMinor: "212400" }], creditInstallments: { count: 6, principalMinor: "150000", interestMinor: "35400" } });
  assert.deepEqual(purchase.installmentRowsFor("act2", 1112400n, { count: 6, principalMinor: 150000n, interestMinor: 35400n }, "2026-12")
    .map((row) => [row.period, row.principalMinor, row.interestMinor]), [
    ["2026-12", "150000", "35400"], ["2027-01", "150000", "35400"], ["2027-02", "150000", "35400"],
    ["2027-03", "150000", "35400"], ["2027-04", "150000", "35400"], ["2027-05", "150000", "35400"]]);
  // The stored interest charge is rebuilt, never sent twice; other charges stay editable.
  const charges = [{ typeId: "interest-type", systemKey: "installment_interest" }, { typeId: "admin", systemKey: "admin_fee" }];
  assert.deepEqual(purchase.editableInstallmentCharges(charges).map((charge) => charge.typeId), ["admin"]);
  assert.deepEqual(purchase.editableInstallmentCharges([{ typeId: "interest-type" }], "interest-type"), []);
  assert.equal(purchase.installmentEditDefaults(undefined), null);
  assert.equal(purchase.installmentEditDefaults({ count: 1, principalMinor: "0", interestMinor: "0" }), null);
  assert.throws(() => purchase.installmentPurchaseRequest(plan12x(1200000, 2.95), 12), /Bunga cicilan/);
});

test("(e) top-up cicilan: pokok dan seluruh bunga masuk ledger, jadwal di tabel, catatan kredit tidak dipakai", () => {
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "900000", tenorMonths: 3, interestMode: "percent", interestRatePercent: 2.95, interestFlatMinorStr: "0" });
  // 900.000 over 3x at 2,95%: 300.000 principal + 26.550 interest per month.
  const request = purchase.installmentTopUpRequest(plan, 3);
  assert.deepEqual(request, { transferFeeMinor: "79650", creditInstallments: { count: 3, principalMinor: "300000", interestMinor: "26550" } });
  const impact = 900000n + BigInt(request.transferFeeMinor);
  const terms = request.creditInstallments;
  const state = purchase.applyCreditPost({ note: CREDIT_NOTE, installments: [] }, { activityId: "topup", impactMinor: impact, cycle: "current", kind: "transfer",
    installments: { count: terms.count, principalMinor: BigInt(terms.principalMinor), interestMinor: BigInt(terms.interestMinor) } }, NOW);
  assert.equal(state.note, CREDIT_NOTE, "the credit note carries no schedule for new top-ups");
  assert.deepEqual(state.installments.map((row) => [row.period, row.principalMinor, row.interestMinor]),
    [["2026-12", "300000", "26550"], ["2027-01", "300000", "26550"], ["2027-02", "300000", "26550"]]);
  assert.equal(state.installments.reduce((sum, row) => sum + BigInt(row.principalMinor) + BigInt(row.interestMinor), 0n), impact);

  const account = creditAccount({ balanceMinor: (-impact).toString(), note: state.note, creditInstallments: state.installments });
  const bills = credit.computeCreditBills(account, NOW);
  assert.equal(bills.totalUnpaidMinor, impact);
  assert.equal(bills.currentBillMinor + bills.nextBillMinor + bills.laterBillMinor, impact);
  assert.equal(idr([account]).liabilities, impact);

  // Void: every row is cancelled by the voiding activity and nothing is owed.
  const voided = purchase.applyCreditVoid(state, { activityId: "topup", occurredAtIso: "2026-11-24T03:00:00.000Z", reversedImpactMinor: impact }, NOW);
  assert.ok(voided.installments.every((row) => row.status === "cancelled"));
  assert.equal(credit.computeCreditBills(creditAccount({ balanceMinor: "0", note: voided.note, creditInstallments: voided.installments }), NOW).totalUnpaidMinor, 0n);
});

test("(e) top-up satu bulan: bunga tetap seluruhnya di biaya transfer dan tidak ada jadwal cicilan", () => {
  const plan = credit.calculateCreditInstallmentPlan({ principalMinorStr: "500000", tenorMonths: 1, interestMode: "percent", interestRatePercent: 2, interestFlatMinorStr: "0" });
  assert.deepEqual(purchase.installmentTopUpRequest(plan, 1), { transferFeeMinor: "10000", creditInstallments: null });
  assert.throws(() => purchase.installmentTopUpRequest(plan, 0), /Tenor/);
});
