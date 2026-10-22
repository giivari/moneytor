import test from "node:test";
import assert from "node:assert/strict";
import {
  addMoney, defineCurrency, deserializeMoney, majorDecimal, money, serializeMoney,
} from "../src/lib/domain/money.ts";
import {
  assertUniqueSystemKeys, customCatalogItem, validateCatalogName,
} from "../src/lib/domain/catalog.ts";
import { planActivity } from "../src/lib/domain/ledger.ts";

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
