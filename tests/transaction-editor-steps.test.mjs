// The transaction editor provides a 5-scenario Fluent 2 modal without changing what it saves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildEditorDraft } from "../src/lib/domain/transaction-preset.ts";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const editor = read("src/components/transaction-editor.tsx");

test("5 scenario tabs with layout toggle, and a preset kind or a correction activates the matching scenario", () => {
  assert.match(editor, /const scenarioTabs =/);
  assert.match(editor, /"pengeluaran"/);
  assert.match(editor, /"transfer"/);
  assert.match(editor, /"splitbill"/);
  assert.match(editor, /"pemasukan"/);
  assert.match(editor, /"pelunasan"/);
  assert.match(editor, /resolveInitialTab\(initial, preset\)/);
  assert.match(editor, /data-mode=\{layoutMode\}/);
});

test("every scenario tab contains its dedicated financial fields", () => {
  assert.match(editor, /Skema Kredit Otomatis/);
  assert.match(editor, /Skema Potongan Biaya Admin/);
  assert.match(editor, /Pilihan Sifat Uang Masuk/);
  assert.match(editor, /Metode Bagi:/);
  assert.match(editor, /Melunasi Tagihan Kartu Kredit/);
  assert.match(editor, /InlineCatalogSelect/);
  assert.match(editor, /OptionalChargesEditor/);
  assert.match(editor, /type="datetime-local"/);
});

test("saving is possible with form validation from all active scenarios", () => {
  assert.match(editor, /type="submit"/);
  assert.match(editor, /form="tx-form"/);
  assert.match(editor, /onSubmit=\{save\}/);
});

test("save keeps the same request, idempotent replay and credit/split handling", () => {
  for (const text of [/financeRequest\(initial \? "replace" : "post"/, /replay\.current/, /splitReplay\.current/, /CREDIT_REMINDER_NOTE_PREFIX/, /installmentPurchaseRequest/]) assert.match(editor, text);
});

test("Catat with a kind opens the editor on that kind", () => {
  const quick = read("src/components/quick-add.tsx");
  assert.match(quick, /preset=\{kind \? \{ kind \} : undefined\}/);
});

test("an installment top-up books the interest of every month and a correction restores its tenor and own fee", () => {
  assert.match(editor, /installmentTopUpRequest\(plan, tenorMonths\)\.transferFeeMinor/);
  assert.match(editor, /initial\?\.kind === "expense" \|\| initial\?\.kind === "transfer" \? installmentEditDefaults/);
  assert.match(editor, /storedTopUpInterest = initialInstallment && initial\?\.kind === "transfer"/);
  assert.match(editor, /BigInt\(initial\.charges\[0\]\.amountMinor\) - storedTopUpInterest/);
});

test("borrow, repay, refund and adjustment build request drafts matching CONTRACT.md", () => {
  assert.match(editor, /buildEditorDraft\(/);
  const at = "2026-03-01T05:00:00.000Z";
  const borrow = buildEditorDraft({
    kind: "borrow",
    amountMinor: "2000000",
    occurredAt: at,
    note: "Pinjaman cair",
    primaryAssetId: "loan-1",
    destinationAssetId: "wallet-1",
    categoryId: "ignored-cat",
  });
  assert.deepEqual(borrow, {
    kind: "borrow",
    amountMinor: "2000000",
    occurredAt: at,
    note: "Pinjaman cair",
    sourceAssetId: "loan-1",
    destinationAssetId: "wallet-1",
  });

  const repay = buildEditorDraft({
    kind: "repay",
    amountMinor: "1000000",
    occurredAt: at,
    note: "Cicilan",
    primaryAssetId: "wallet-1",
    destinationAssetId: "loan-1",
    repayInterestMinor: "50000",
    loanInterestChargeTypeId: "60000000-0000-4000-8000-000000000007",
    categoryId: "ignored-cat",
  });
  assert.deepEqual(repay, {
    kind: "repay",
    amountMinor: "1000000",
    occurredAt: at,
    note: "Cicilan",
    sourceAssetId: "wallet-1",
    destinationAssetId: "loan-1",
    charges: [{ typeId: "60000000-0000-4000-8000-000000000007", amountMinor: "50000" }],
  });

  const refund = buildEditorDraft({
    kind: "refund",
    amountMinor: "40000",
    occurredAt: at,
    note: "Refund belanja",
    primaryAssetId: "wallet-1",
    refundOfActivityId: "expense-1",
    categoryId: "ignored-cat",
  });
  assert.deepEqual(refund, {
    kind: "refund",
    amountMinor: "40000",
    occurredAt: at,
    note: "Refund belanja",
    destinationAssetId: "wallet-1",
    refundOfActivityId: "expense-1",
  });

  const adjIncrease = buildEditorDraft({
    kind: "adjustment",
    amountMinor: "700",
    occurredAt: at,
    note: "Selisih naik",
    primaryAssetId: "wallet-1",
    adjustmentReason: "reconciliation",
    adjustmentDirection: "increase",
  });
  assert.deepEqual(adjIncrease, {
    kind: "adjustment",
    amountMinor: "700",
    occurredAt: at,
    note: "Selisih naik",
    destinationAssetId: "wallet-1",
    adjustmentReason: "reconciliation",
  });

  const adjOpeningDebt = buildEditorDraft({
    kind: "adjustment",
    amountMinor: "800000",
    occurredAt: at,
    note: "Utang lama",
    primaryAssetId: "loan-1",
    adjustmentReason: "opening_debt",
    adjustmentDirection: "increase",
  });
  assert.deepEqual(adjOpeningDebt, {
    kind: "adjustment",
    amountMinor: "800000",
    occurredAt: at,
    note: "Utang lama",
    sourceAssetId: "loan-1",
    adjustmentReason: "opening_debt",
  });
});
