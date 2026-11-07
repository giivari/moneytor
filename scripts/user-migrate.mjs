// Migrasi data pengguna pada SALINAN LOKAL (127.0.0.1:55435, moneytor_prod_copy). Terpisah dari scripts/migrate.mjs dan tidak dipanggil build.
//   Dry-run (default): node scripts/user-migrate.mjs
//   Terapkan:          node scripts/user-migrate.mjs --apply --confirm-db=moneytor_prod_copy
// DATABASE_URL wajib; berkas masukan ada di local-data/ (gitignored): category-map.csv, opening-debts.csv (opsional). Lihat docs/LOCAL-PROD-COPY.md.
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { assertSafeTarget, parseCsv, runUserMigrate } from "./user-migrate-core.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const known = (arg) => arg === "--apply" || arg === "--dry-run" || /^--(confirm-db|map|debts|report)=/.test(arg);
if (args.some((arg) => !known(arg))) throw new Error("Opsi tidak dikenal. Pakai --dry-run (default) atau --apply --confirm-db=moneytor_prod_copy");
if (args.includes("--apply") && args.includes("--dry-run")) throw new Error("Pilih salah satu: --dry-run atau --apply");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
assertSafeTarget(new URL(process.env.DATABASE_URL), args);

const readCsv = async (path, optional) => {
  try { return parseCsv(await readFile(path, "utf8")); } catch (error) { if (optional && error.code === "ENOENT") return []; throw error; }
};
const mapRows = await readCsv(option("map", "local-data/category-map.csv"), false);
const debtRows = await readCsv(option("debts", "local-data/opening-debts.csv"), true);
const apply = args.includes("--apply");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const report = await runUserMigrate(client, { mapRows, debtRows, apply });
  const accounts = Object.keys(report.before.balances);
  const changed = accounts.filter((id) => report.before.balances[id] !== report.after.balances[id]).length;
  console.log(`${apply ? "DITERAPKAN" : "DRY-RUN (rollback)"}: dipetakan ${report.counts.mapped}, dilewati ${report.counts.skipped}, dinonaktifkan ${report.counts.deactivated}, utang awal ${report.counts.debts}`);
  console.log(`Akun ${accounts.length} (saldo berubah: ${changed}), mata uang ${Object.keys(report.after.netWorth).length}, bulan pengeluaran ${report.after.monthly.length}, bulan pemasukan ${report.after.income.length}`);
  console.log(`Snapshot saldo/kekayaan bersih/total bulanan sesudah = sebelum (+ perubahan terencana): ${report.identical ? "identik" : "BEDA"}`);
  // Laporan per akun (id, kelas, saldo sebelum/sesudah) hanya di berkas lokal yang di-gitignore.
  const lines = ["asset_id,asset_class,saldo_sebelum,saldo_sesudah", ...accounts.map((id) => `${id},${report.before.classes[id]},${report.before.balances[id]},${report.after.balances[id]}`)];
  await writeFile(option("report", "local-data/user-migrate-report.csv"), `${lines.join("\n")}\n`);
} finally {
  await client.end();
}
