import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseImportPayload,
  parseImportDate,
  parseImportKind,
  parseImportMinorAmount,
} from "../src/lib/imports/parser.ts";

test("P7 parser: Excel serial dates, ISO dates, and DD/MM/YYYY dates normalize deterministically", () => {
  assert.deepEqual(parseImportDate("46285"), {
    occurredAt: "2026-09-20T00:00:00.000Z",
    occurredDay: "2026-09-20",
  });
  assert.deepEqual(parseImportDate("2026-10-03"), {
    occurredAt: "2026-10-03T00:00:00.000Z",
    occurredDay: "2026-10-03",
  });
  assert.deepEqual(parseImportDate("03/10/2026"), {
    occurredAt: "2026-10-03T00:00:00.000Z",
    occurredDay: "2026-10-03",
  });
  assert.equal(parseImportDate("invalid-date"), null);
});

test("P7 parser: kind and exact minor amount parsing for IDR and subunit currencies", () => {
  assert.equal(parseImportKind("Expense"), "expense");
  assert.equal(parseImportKind("Pemasukan"), "income");
  assert.equal(parseImportKind("Pindah Buku"), "transfer");
  assert.equal(parseImportKind("Revalue"), null);

  assert.equal(parseImportMinorAmount("5000", 0), "5000");
  assert.equal(parseImportMinorAmount("Rp 1.650.000", 0), "1650000");
  assert.equal(parseImportMinorAmount("50,000", 0), "50000");
  assert.equal(parseImportMinorAmount("0", 0), null);
  assert.equal(parseImportMinorAmount("-100", 0), null);
  assert.equal(parseImportMinorAmount("12.50", 2), "1250");
});

test("P7 parser: parses reference workbook Monitor_Keuangan_dengan_Reports_revised.xlsx accurately", () => {
  const buf = readFileSync(new URL("../references/Monitor_Keuangan_dengan_Reports_revised.xlsx", import.meta.url));
  const result = parseImportPayload({
    fileName: "Monitor_Keuangan_dengan_Reports_revised.xlsx",
    contentBase64: buf.toString("base64"),
  });

  assert.equal(result.sourceFormat, "xlsx");
  assert.deepEqual(result.sheets, ["Home", "Transactions", "Accounts", "Plan", "Reports"]);
  assert.equal(result.selectedSheet, "Transactions");
  assert.equal(result.headerRowNumber, 4);
  assert.equal(result.rows.length, 117);
  assert.equal(result.rows.every((r) => r.parseErrors.length === 0), true);

  // Row 5: Expense on 46285 (2026-09-20), BNI Taplus Muda, Makan, yourtea, 5000
  const first = result.rows[0];
  assert.equal(first.rowNumber, 5);
  assert.equal(first.occurredDay, "2026-09-20");
  assert.equal(first.kind, "expense");
  assert.equal(first.sourceAccountName, "BNI Taplus Muda");
  assert.equal(first.destinationAccountName, "");
  assert.equal(first.categoryName, "Makan");
  assert.equal(first.note, "yourtea");
  assert.equal(first.amountMinor, "5000");

  // Row 6: Transfer on 46285, BNI Taplus Muda -> Cash Wallet, tarik tunai, 50000
  const second = result.rows[1];
  assert.equal(second.rowNumber, 6);
  assert.equal(second.kind, "transfer");
  assert.equal(second.sourceAccountName, "BNI Taplus Muda");
  assert.equal(second.destinationAccountName, "Cash Wallet");
  assert.equal(second.categoryName, "");
  assert.equal(second.amountMinor, "50000");

  // Income rows map Account column to destinationAccountName
  const incomes = result.rows.filter((r) => r.kind === "income");
  assert.equal(incomes.length, 3);
  assert.equal(incomes.every((r) => r.destinationAccountName === "Mandiri Gold" && r.sourceAccountName === ""), true);
});

test("P7 parser: CSV delimiter detection, quoted fields, non-posted status, and duplicate-day fingerprint disambiguation", () => {
  const csv = [
    "Tanggal;Jenis;Akun;Akun Tujuan;Kategori;Deskripsi;Nominal (Rp);Status",
    '2026-10-01;Expense;E money;;KRL;"bogor; cawang";5.000;Posted',
    '2026-10-01;Expense;E money;;KRL;"bogor; cawang";5.000;Posted',
    "2026-10-02;Transfer;BNI Taplus Muda;BNI Taplus Muda;Transfer;akun sama;10000;Posted",
    "2026-10-02;Expense;Cash Wallet;;Makan;batal beli;15000;Draft",
  ].join("\r\n");

  const parsed = parseImportPayload({
    fileName: "mutasi.csv",
    contentBase64: Buffer.from(csv, "utf8").toString("base64"),
  });

  assert.equal(parsed.sourceFormat, "csv");
  assert.equal(parsed.rows.length, 4);
  // Two identical KRL trips on the same day receive distinct sequential fingerprints within the file
  assert.notEqual(parsed.rows[0].rowFingerprint, parsed.rows[1].rowFingerprint);
  assert.equal(parsed.rows[0].note, "bogor; cawang");
  assert.equal(parsed.rows[0].amountMinor, "5000");
  // Same-account transfer is flagged with parse error
  assert.match(parsed.rows[2].parseErrors.join(" "), /tidak boleh sama/);
  // Draft status is flagged as nonPostedStatus
  assert.equal(parsed.rows[3].nonPostedStatus, true);
});
