import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CURATED_PAYMENT_NETWORKS,
  CURATED_PROVIDERS,
  resolveProviderMark,
} from "../src/lib/domain/provider-marks.ts";
import {
  parseWorkbookAccountsSheet,
  toCsvDocument,
  toStatementPdfBuffer,
  toXlsxBuffer,
} from "../src/lib/exports/format.ts";
import { parseXlsxBuffer } from "../src/lib/imports/parser.ts";

test("P8 provider marks: curated local providers and networks resolve monograms and tones deterministically", () => {
  assert.ok(CURATED_PROVIDERS.length >= 15);
  assert.ok(CURATED_PAYMENT_NETWORKS.length >= 4);

  const bni = resolveProviderMark(null, "BNI Taplus Muda");
  assert.equal(bni.monogram, "BNI");
  assert.equal(bni.tone, "teal");
  assert.equal(bni.inferredProviderName, "Bank Negara Indonesia (BNI)");

  const mandiri = resolveProviderMark(null, "Mandiri Gold");
  assert.equal(mandiri.monogram, "MDR");
  assert.equal(mandiri.tone, "amber");
  assert.equal(mandiri.inferredProviderName, "Bank Mandiri");

  const emoney = resolveProviderMark(null, "E money");
  assert.equal(emoney.monogram, "EMN");
  assert.equal(emoney.matchedKey, "emoney");
  assert.equal(emoney.inferredProviderName, "e-Money / Flazz");

  const umbrella = resolveProviderMark("e-Money / Flazz", "e-Money / Flazz");
  assert.equal(umbrella.matchedKey, "emoney");

  const flazz = resolveProviderMark("e-Money / Flazz", "Flazz BCA");
  assert.equal(flazz.matchedKey, "flazz");
  assert.equal(flazz.inferredProviderName, "BCA Flazz");

  const tapcash = resolveProviderMark("Bank Negara Indonesia (BNI)", "Kartu TapCash");
  assert.equal(tapcash.matchedKey, "tapcash");
  assert.equal(tapcash.inferredProviderName, "BNI TapCash");

  const brizzi = resolveProviderMark("e-Money / Flazz", "Brizzi Toll");
  assert.equal(brizzi.matchedKey, "brizzi");
  assert.equal(brizzi.inferredProviderName, "BRI Brizzi");

  const mandiriEmoney = resolveProviderMark("Bank Mandiri", "Mandiri e-Money");
  assert.equal(mandiriEmoney.matchedKey, "mandiri-emoney");
  assert.equal(mandiriEmoney.inferredProviderName, "Mandiri e-Money");

  const cash = resolveProviderMark(null, "Cash Wallet");
  assert.equal(cash.monogram, "KAS");
  assert.equal(cash.tone, "teal");
  assert.equal(cash.inferredProviderName, null);

  const custom = resolveProviderMark("Koperasi Simpan Pinjam", "Simpanan Pokok", "violet");
  assert.equal(custom.monogram, "KSP");
  assert.equal(custom.tone, "violet");
});

test("P8 CSV export serializer: UTF-8 BOM, RFC-4180 quoting, and spreadsheet formula-injection sanitization", () => {
  const csv = toCsvDocument(
    ["Account", "Amount", "Note"],
    [
      ["BNI Taplus Muda", -15000, "Makan siang, kopi"],
      ["Mandiri", "250000", "=SUM(A1:A2)"],
      ["Cash", 0, 'Catatan "khusus"'],
    ],
  );
  assert.equal(csv.startsWith("\uFEFFAccount,Amount,Note\r\n"), true);
  assert.match(csv, /BNI Taplus Muda,-15000,"Makan siang, kopi"\r\n/);
  assert.match(csv, /Mandiri,250000,'=SUM\(A1:A2\)\r\n/);
  assert.match(csv, /Cash,0,"Catatan ""khusus"""\r\n/);
});

test("P8 XLSX & PDF e-Statement generators: valid round-trip OpenXML workbook and PDF 1.4 bank statement", () => {
  const xlsx = toXlsxBuffer(
    "Mutasi Transaksi",
    ["Tanggal", "Jenis", "Akun", "Nominal"],
    [
      ["20 Sep 2026", "Pengeluaran", "BNI Taplus Muda", 15000],
      ["21 Sep 2026", "Pemasukan", "Mandiri Gold", 1650000],
    ],
  );
  assert.ok(Buffer.isBuffer(xlsx));
  const parsed = parseXlsxBuffer(xlsx);
  assert.deepEqual(parsed.sheets, ["Mutasi Transaksi"]);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].cells.A, "Tanggal");
  assert.equal(parsed.rows[1].cells.C, "BNI Taplus Muda");
  assert.equal(parsed.rows[2].cells.D, "1650000");

  const pdf = toStatementPdfBuffer({
    title: "Mutasi & Riwayat Transaksi",
    subtitle: "Total 2 aktivitas tercatat",
    generatedAt: "21 Okt 2026 16:00 WIB",
    summaryItems: [
      { label: "Total Pemasukan", value: "Rp 1.650.000" },
      { label: "Total Pengeluaran", value: "Rp 15.000" },
    ],
    headers: ["Tanggal", "Jenis", "Akun", "Nominal"],
    rows: [
      ["20 Sep 2026", "Pengeluaran", "BNI Taplus Muda", "-Rp 15.000"],
      ["21 Sep 2026", "Pemasukan", "Mandiri Gold", "+Rp 1.650.000"],
    ],
    rightAlignCols: [3],
  });
  assert.ok(Buffer.isBuffer(pdf));
  const pdfText = pdf.toString("latin1");
  assert.equal(pdfText.startsWith("%PDF-1.4"), true);
  assert.match(pdfText, /MONEYTOR  \|  E-STATEMENT & LAPORAN KEUANGAN PRIBADI/);
  assert.match(pdfText, /Mutasi & Riwayat Transaksi/);
  assert.match(pdfText, /BNI Taplus Muda/);
  assert.match(pdfText, /Halaman 1 dari 1/);
  assert.equal(pdfText.trimEnd().endsWith("%%EOF"), true);
});

test("P8 workbook migration parser: parses Accounts sheet from Monitor_Keuangan_dengan_Reports_revised.xlsx", () => {
  const buf = readFileSync(new URL("../references/Monitor_Keuangan_dengan_Reports_revised.xlsx", import.meta.url));
  const result = parseWorkbookAccountsSheet(buf, [
    { id: "existing-bni", displayName: "BNI Taplus Muda", currency: "IDR" },
  ]);

  assert.equal(result.sheetName, "Accounts");
  assert.equal(result.accounts.length, 10);
  assert.equal(result.summary.totalDetected, 10);
  assert.equal(result.summary.existingAccountsCount, 1);
  assert.equal(result.summary.newAccountsCount, 9);

  const mandiri = result.accounts[0];
  assert.equal(mandiri.displayName, "Mandiri Gold");
  assert.equal(mandiri.openingAmountMinor, "199000");
  assert.equal(mandiri.assetTypeSystemKey, "bank_account");
  assert.equal(mandiri.assetGroupSystemKey, "liquid");
  assert.equal(mandiri.normallyLiquid, true);
  assert.equal(mandiri.normallySpendable, true);
  assert.equal(mandiri.inferredProviderName, "Bank Mandiri");
  assert.equal(mandiri.alreadyExists, false);
  assert.equal(mandiri.defaultSelected, true);

  const bni = result.accounts[1];
  assert.equal(bni.displayName, "BNI Taplus Muda");
  assert.equal(bni.openingAmountMinor, "622382");
  assert.equal(bni.alreadyExists, true);
  assert.equal(bni.existingAssetId, "existing-bni");
  assert.equal(bni.defaultSelected, false);

  const emergencyFund = result.accounts.find((a) => a.displayName === "Emergency Fund");
  assert.ok(emergencyFund);
  assert.equal(emergencyFund.assetGroupSystemKey, "reserve");
  assert.equal(emergencyFund.normallyLiquid, true);
  assert.equal(emergencyFund.normallySpendable, false);

  const rdpu = result.accounts.find((a) => a.displayName === "RDPU");
  assert.ok(rdpu);
  assert.equal(rdpu.assetTypeSystemKey, "investment_account");
  assert.equal(rdpu.assetGroupSystemKey, "investment");
  assert.equal(rdpu.normallyLiquid, false);
});
