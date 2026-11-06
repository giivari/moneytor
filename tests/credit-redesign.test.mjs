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
