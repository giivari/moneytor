// Presets the transaction editor opens with (Catat per jenis, Bayar tagihan). Pure: no database.
import test from "node:test";
import assert from "node:assert/strict";
import { pickTransferSource } from "../src/lib/domain/transaction-preset.ts";

let serial = 0;
const asset = (overrides) => ({ id: `a${++serial}`, displayName: `Akun ${serial}`, currency: "IDR", exponent: 0, normallyLiquid: true, normallySpendable: true,
  note: null, isActive: true, balanceMinor: "0", assetClass: "asset", creditInstallments: [], ...overrides });

test("the source of a bill payment is a spendable non-credit account in the credit account's currency", () => {
  const card = asset({ displayName: "Kartu", assetClass: "liability", normallyLiquid: false, normallySpendable: false });
  const usd = asset({ displayName: "USD", currency: "USD" });
  const savings = asset({ displayName: "Tabungan", normallySpendable: false });
  const archived = asset({ displayName: "Arsip", isActive: false });
  const receivable = asset({ displayName: "Talangan", assetClass: "receivable" });
  const wallet = asset({ displayName: "Dompet" });
  assert.equal(pickTransferSource([card, usd, archived, receivable, savings, wallet], card.id).displayName, "Dompet");
  assert.equal(pickTransferSource([card, usd, savings], card.id).displayName, "Tabungan");
  assert.equal(pickTransferSource([card, usd], card.id), undefined);
  assert.equal(pickTransferSource([usd], "missing"), undefined);
});
