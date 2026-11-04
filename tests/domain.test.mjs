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
