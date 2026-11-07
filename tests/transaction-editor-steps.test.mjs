// The transaction editor is split into steps (jenis, akun & nominal, opsi lanjutan) without changing what it saves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

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
