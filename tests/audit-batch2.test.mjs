import test from "node:test";
import assert from "node:assert/strict";
import * as credit from "../src/lib/domain/credit.ts";
import { parseImportDate } from "../src/lib/imports/parser.ts";

test("cutoff 28 dengan jatuh tempo 31 tidak bergantung pada panjang bulan", () => {
  // Februari: due dipendekkan ke 28 Feb, tetapi aturan memakai hari konfigurasi (31) -> tutup 28 Feb, bukan 28 Jan.
  assert.equal(credit.closingCutoffIsoForDue("2026-02-28", 28, 31), "2026-02-28");
  assert.equal(credit.closingCutoffIsoForDue("2024-02-29", 28, 31), "2024-02-28");
  assert.equal(credit.closingCutoffIsoForDue("2026-03-31", 28, 31), "2026-03-28");
  assert.equal(credit.closingCutoffIsoForDue("2026-04-30", 28, 31), "2026-04-28");
  // cutoff >= due konfigurasi tetap jatuh di bulan sebelumnya
  assert.equal(credit.closingCutoffIsoForDue("2026-11-05", 20, 5), "2026-10-20");
});
test("belanja 29 Jan - 28 Feb masuk tagihan Februari, bukan Maret", () => {
  assert.equal(credit.autoCreditPeriodFor("2026-01-30T03:00:00.000Z", 31, 28), "2026-02");
  assert.equal(credit.autoCreditPeriodFor("2026-02-27T03:00:00.000Z", 31, 28), "2026-02");
  assert.equal(credit.autoCreditPeriodFor("2026-03-01T03:00:00.000Z", 31, 28), "2026-03");
});
test("tanggal impor dibaca sebagai WIB, bukan UTC/zona server", () => {
  const text = parseImportDate("2026-09-20 21:00");
  assert.equal(text.occurredAt, "2026-09-20T14:00:00.000Z");
  assert.equal(text.occurredDay, "2026-09-20");
  // serial Excel 46285.75 = 2026-09-20 18:00 WIB
  const serial = parseImportDate("46285.75");
  assert.equal(serial.occurredDay, "2026-09-20");
  assert.equal(serial.occurredAt, "2026-09-20T11:00:00.000Z");
  const withZone = parseImportDate("2026-09-20T20:00:00Z");
  assert.equal(withZone.occurredDay, "2026-09-21");
});

import { connectFinanceDialog } from "../src/lib/finance/dialog-lifecycle.ts";
import { offerFocusReturn } from "../src/lib/finance/focus-return.ts";
import { summarizeActivityTotals } from "../src/lib/domain/activity-totals.ts";
import { publicMessage } from "../src/lib/http/public-error.ts";
import { boundedText, BodyTooLargeError } from "../src/lib/http/bounded-text.ts";
import { minorToInput } from "../src/lib/finance/format.ts";
import { toCsvDocument } from "../src/lib/exports/format.ts";

test("pesan galat PostgreSQL/sistem tidak bocor, pesan domain lolos", () => {
  const pg = Object.assign(new Error('duplicate key value violates unique constraint "assets_pkey"'), { code: "23505", severity: "ERROR" });
  assert.equal(publicMessage(pg, "Gagal."), "Gagal.");
  assert.equal(publicMessage(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" }), "Gagal."), "Gagal.");
  assert.equal(publicMessage(new Error("Pilih setidaknya satu akun."), "Gagal."), "Pilih setidaknya satu akun.");
  assert.equal(publicMessage("x", "Gagal."), "Gagal.");
});
test("boundedText menolak body chunked yang melewati batas", async () => {
  assert.equal(await boundedText(new Request("http://x", { method: "POST", body: "halo" }), 10), "halo");
  await assert.rejects(boundedText(new Request("http://x", { method: "POST", body: "x".repeat(50) }), 10), BodyTooLargeError);
});
test("minorToInput menangani nilai negatif ber-eksponen", () => {
  assert.equal(minorToInput("-150", 2), "-1.50");
  assert.equal(minorToInput("-50", 2), "-0.50");
  assert.equal(minorToInput("1250", 2), "12.50");
  assert.equal(minorToInput("-7", 0), "-7");
});

test("guard formula CSV menetralkan -2+HYPERLINK tetapi membiarkan nominal negatif", () => {
  const lines = toCsvDocument(["a"], [["-2+HYPERLINK(1)"], ["-Rp 15.000"], ["-12345"], ["=1+1"], ["-cmd"]]).replaceAll(String.fromCharCode(13), "").split(String.fromCharCode(10));
  assert.deepEqual(lines.slice(1, 6), ["'-2+HYPERLINK(1)", "-Rp 15.000", "-12345", "'=1+1", "'-cmd"]);
});

test("dialog yang dibuka dari inspector mengembalikan fokus ke baris pemicu saat tombol asalnya sudah hilang", () => {
  const events = [];
  const row = { isConnected: true, focus: () => events.push("row") };
  const gone = { isConnected: false, focus: () => events.push("gone") };
  globalThis.document = { activeElement: gone };
  offerFocusReturn(row);
  const listeners = {};
  const node = { open: false, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {}, showModal() { node.open = true; } };
  connectFinanceDialog(node, () => events.push("closed"));
  node.open = false;
  listeners.close();
  assert.deepEqual(events, ["row", "closed"]);
  // No offer pending: closing a dialog never steals focus.
  const quiet = { open: false, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {}, showModal() { quiet.open = true; } };
  events.length = 0;
  connectFinanceDialog(quiet, () => events.push("closed"));
  quiet.open = false;
  listeners.close();
  assert.deepEqual(events, ["closed"]);
  delete globalThis.document;
});

test("total mutasi: jumlah per jenis dan nominal masuk/keluar mencakup seluruh transaksi", () => {
  const totals = summarizeActivityTotals([
    { currency: "IDR", exponent: 0, kind: "expense", count: 80, baseMinor: "1000000", chargeMinor: "2500" },
    { currency: "IDR", exponent: 0, kind: "income", count: 30, baseMinor: "5000000", chargeMinor: "0" },
    { currency: "IDR", exponent: 0, kind: "transfer", count: 10, baseMinor: "700000", chargeMinor: "6500" },
    { currency: "IDR", exponent: 0, kind: "refund", count: 2, baseMinor: "40000", chargeMinor: "0" },
    { currency: "USD", exponent: 2, kind: "income", count: 1, baseMinor: "1250", chargeMinor: "0" },
  ]);
  assert.equal(totals.total, 123);
  assert.deepEqual(totals.counts, { expense: 80, income: 31, transfer: 10, refund: 2 });
  const idr = totals.currencies.find((entry) => entry.currency === "IDR");
  assert.equal(idr.inMinor, "5000000");
  assert.equal(idr.outMinor, "1009000"); // expense 1.000.000 + 2.500, plus 6.500 fee of the transfer (its principal only moves money)
  assert.equal(idr.feeMinor, "9000");
  assert.equal(totals.currencies.find((entry) => entry.currency === "USD").inMinor, "1250");
  assert.deepEqual(summarizeActivityTotals([]), { total: 0, counts: {}, currencies: [] });
});
