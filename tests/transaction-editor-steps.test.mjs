// The transaction editor is split into steps (jenis, akun & nominal, opsi lanjutan) without changing what it saves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildEditorDraft } from "../src/lib/domain/transaction-preset.ts";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const editor = read("src/components/transaction-editor.tsx");
const stepBody = (n) => {
  const start = editor.indexOf(`{step === ${n} && <>`);
  assert.ok(start > 0, `step ${n} exists`);
  const end = editor.indexOf("</>}", start);
  return editor.slice(start, end);
};

test("three steps with a stepper, and a preset kind or a correction starts at step 2", () => {
  assert.match(editor, /const stepTitles = \["Jenis", "Akun & nominal", "Opsi lanjutan"\] as const/);
  assert.match(editor, /useState<1 \| 2 \| 3>\(initial \|\| preset\?\.kind \? 2 : 1\)/);
  assert.match(editor, /aria-current=\{step === index \+ 1 \? "step" : undefined\}/);
});

test("every field sits in the step it belongs to", () => {
  const one = stepBody(1), two = stepBody(2), three = stepBody(3);
  assert.match(one, /Jenis transaksi/);
  assert.match(one, /goTo\(2\)/);
  for (const text of [/Jumlah \(\$\{currency\}\)/, /Aset penerima/, /Aset tujuan/, /credit-payment-scheme/]) assert.match(two, text);
  for (const text of [/Ada biaya transfer/, /InlineCatalogSelect/, /OptionalChargesEditor/, /Split Bill/, /type="datetime-local"/, /Catatan/]) assert.match(three, text);
  assert.doesNotMatch(two, /OptionalChargesEditor|datetime-local|Ada biaya transfer/);
});

test("saving is possible from step 2 and 3; going forward from step 2 validates required fields", () => {
  assert.match(editor, /\{step > 1 && <button type="submit"/);
  assert.match(editor, /formRef\.current\.reportValidity\(\)/);
  assert.match(editor, /step === 1 && next === 3 \? 2 : next/);
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
