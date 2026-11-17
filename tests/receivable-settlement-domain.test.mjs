import test from "node:test";
import assert from "node:assert/strict";
import { planReceivableSettlement } from "../src/lib/domain/receivable-settlement.ts";
import { automationNote } from "../src/lib/automation/composable-domain.ts";

const plan = (remaining, received, mode = "partial") => planReceivableSettlement({ remainingMinor: BigInt(remaining), receivedMinor: BigInt(received), mode });

test("pelunasan pas: satu transfer, piutang jadi 0, tanpa penyesuaian", () => {
  assert.deepEqual(plan(19900, 19900), { transferMinor: 19900n, adjustment: null, outcome: "exact", remainingAfterMinor: 0n });
});
test("lebih bayar/pembulatan naik: transfer sebesar sisa + pemasukan selisih", () => {
  assert.deepEqual(plan(19900, 20000), { transferMinor: 19900n, adjustment: { kind: "income", amountMinor: 100n }, outcome: "overpaid", remainingAfterMinor: 0n });
  assert.equal(plan(19900, 20000, "close_with_adjustment").outcome, "overpaid");
});
test("kurang bayar parsial: transfer sebesar diterima, sisa tetap di piutang", () => {
  assert.deepEqual(plan(17000, 16500, "partial"), { transferMinor: 16500n, adjustment: null, outcome: "partial", remainingAfterMinor: 500n });
});
test("kurang bayar tutup lunas: transfer sebesar diterima + pengeluaran selisih, piutang 0", () => {
  assert.deepEqual(plan(17000, 16500, "close_with_adjustment"), { transferMinor: 16500n, adjustment: { kind: "expense", amountMinor: 500n }, outcome: "closed_short", remainingAfterMinor: 0n });
});
test("validasi: sisa/diterima harus positif dan mode dikenal", () => {
  assert.throws(() => plan(0, 100), /tidak memiliki sisa/);
  assert.throws(() => plan(-5, 100), /tidak memiliki sisa/);
  assert.throws(() => plan(100, 0), /lebih dari nol/);
  assert.throws(() => plan(100, -1), /lebih dari nol/);
  assert.throws(() => plan(100, 50, "bebas"), /Mode pelunasan/);
});
test("nama aturan otomatisasi dipakai bila catatan kosong atau hanya spasi", () => {
  assert.equal(automationNote(undefined, "KRL Sore · Transportasi Umum"), "KRL Sore · Transportasi Umum");
  assert.equal(automationNote(null, "KRL Sore"), "KRL Sore");
  assert.equal(automationNote("   ", "  KRL Sore "), "KRL Sore");
  assert.equal(automationNote(" Tiket ", "KRL Sore"), "Tiket");
  assert.equal(automationNote("", ""), undefined);
});
