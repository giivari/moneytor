// docs/CATALOG.md adalah sumber tunggal katalog bawaan; tes ini menjaga strukturnya konsisten sebelum seed (migrasi 019) dibuat darinya.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CURATED_PAYMENT_NETWORKS, CURATED_PROVIDERS } from "../src/lib/domain/provider-marks.ts";

const text = (await readFile(new URL("../docs/CATALOG.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const NATURES = ["need", "want", "obligation", "social", "saving"];
const KEY = /^[a-z][a-z0-9_]*$/;

/** Rows of the first table under the heading (and optional sub-title) as arrays of cells; header and separator dropped. */
function tables(heading) {
  const start = text.indexOf(`\n## ${heading}\n`);
  assert.ok(start >= 0, `bagian "${heading}" tidak ada`);
  const next = text.indexOf("\n## ", start + 4);
  const lines = text.slice(start, next < 0 ? undefined : next).split("\n");
  const out = []; let current = null;
  for (const line of lines) {
    if (!line.startsWith("|")) { current = null; continue; }
    if (!current) { current = []; out.push(current); }
    current.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return out.map((rows) => rows.filter((row, index) => index > 0 && !row.every((cell) => /^-+$/.test(cell))));
}
const key = (cell) => cell.replace(/\s*\*$/, "");

test("kategori pengeluaran: induk, anak, sifat, dan kunci valid", () => {
  const [parents, children] = tables("Kategori pengeluaran");
  const seen = new Set();
  for (const [k, , nature] of parents) {
    const id = key(k);
    assert.match(id, KEY); assert.ok(!seen.has(id), `kunci ganda ${id}`); seen.add(id);
    assert.ok(nature === "-" || NATURES.includes(nature), `sifat ${id}: ${nature}`);
  }
  const roots = new Set(parents.map((row) => key(row[0])));
  for (const [parent, k, name, nature] of children) {
    assert.ok(roots.has(parent), `induk ${parent} tidak ada untuk ${k}`);
    assert.match(k, KEY); assert.ok(!seen.has(k), `kunci ganda ${k}`); seen.add(k); assert.ok(name);
    assert.ok(nature === "-" || NATURES.includes(nature), `sifat ${k}: ${nature}`);
  }
  assert.ok(children.length >= parents.length);
});

test("kategori pemasukan: induk '-' atau induk tingkat 1, tanpa sifat, kunci unik terhadap pengeluaran", () => {
  const expenseKeys = new Set(tables("Kategori pengeluaran").flatMap((rows) => rows.map((row) => key(row.length === 3 ? row[0] : row[1]))));
  const [rows] = tables("Kategori pemasukan");
  const roots = new Set(rows.filter((row) => row[0] === "-").map((row) => key(row[1])));
  const seen = new Set();
  for (const [parent, k] of rows) {
    const id = key(k);
    assert.match(id, KEY); assert.ok(!seen.has(id), `kunci ganda ${id}`); seen.add(id);
    assert.ok(!expenseKeys.has(id), `${id} juga ada di kategori pengeluaran`);
    if (parent !== "-") assert.ok(roots.has(parent), `induk ${parent} bukan akar pemasukan`);
  }
});

test("jenis aset dan jenis biaya: kunci valid dan unik, kelas aset valid", () => {
  const [assets] = tables("Jenis aset");
  const [charges] = tables("Jenis biaya");
  for (const rows of [assets, charges]) {
    const seen = new Set();
    for (const row of rows) { const id = key(row[0]); assert.match(id, KEY); assert.ok(!seen.has(id), `kunci ganda ${id}`); seen.add(id); }
  }
  for (const row of assets) assert.ok(["asset", "liability", "receivable"].includes(row[2]), `kelas ${row[0]}`);
  for (const must of ["bank_account", "e_wallet", "physical_cash", "investment_account"]) assert.ok(assets.some((row) => key(row[0]) === must));
  for (const must of ["admin_fee", "transfer_fee", "tax", "service_fee", "platform_fee", "installment_interest", "loan_interest"]) assert.ok(charges.some((row) => key(row[0]) === must));
});

test("penyedia dan jaringan bersumber dari provider-marks.ts (kunci unik, tanpa daftar kedua)", () => {
  const keys = CURATED_PROVIDERS.map((p) => p.key.replaceAll("-", "_"));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((k) => KEY.test(k)));
  const networks = CURATED_PAYMENT_NETWORKS.map((n) => n.key.replaceAll("-", "_"));
  assert.equal(new Set(networks).size, networks.length);
});
