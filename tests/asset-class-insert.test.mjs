// (a) Setiap jalur yang membuat baris assets harus menulis asset_class secara eksplisit,
// supaya klasifikasi kredit/piutang tidak bergantung pada DEFAULT kolom atau pada nama akun.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function sources(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await sources(path));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

test("setiap INSERT INTO assets menyebut kolom asset_class", async () => {
  const offenders = [];
  for (const file of await sources(new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/INSERT\s+INTO\s+assets\s*\(([^)]*)\)/gi)) {
      if (!/asset_class/.test(match[1])) offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test("jalur split bill atomik membuat akun piutang dengan kelas receivable, bukan lewat default", async () => {
  const text = await readFile(new URL("../src/lib/finance/split-bill-service.ts", import.meta.url), "utf8");
  assert.match(text, /assetClass:\s*"receivable"/);
});
