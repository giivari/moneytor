// Membangkitkan contoh JSON nyata untuk docs/CONTRACT.md dari fixture sintetis, dan menulisnya ke bagian bertanda di CONTRACT.md.
// Hanya DB uji (container 55434):
//   MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify DATABASE_URL=postgres://moneytor_credit_verify:<password>@127.0.0.1:55434/moneytor_credit_verify \
//     node --conditions=react-server scripts/contract-examples.mjs
// UUID diganti penanda stabil (<id-1>, <id-2>, ...) menurut urutan kemunculan; waktu pembuatan baris dibuang, sehingga hasilnya dapat diulang.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import pg from "pg";

if (process.env.MONEYTOR_CREDIT_DB_TEST !== "moneytor_credit_verify") throw new Error("Hanya untuk DB uji: set MONEYTOR_CREDIT_DB_TEST=moneytor_credit_verify");
const target = new URL(process.env.DATABASE_URL);
if (target.hostname !== "127.0.0.1" || target.port !== "55434" || target.pathname !== "/moneytor_credit_verify") throw new Error("DATABASE_URL harus 127.0.0.1:55434/moneytor_credit_verify");
const admin = new pg.Client({ connectionString: target.toString() });
await admin.connect();
const schema = `contract_${randomUUID().replaceAll("-", "")}`;
let pool, hooks;
try {
  await admin.query(`CREATE SCHEMA ${schema}`); await admin.query(`SET search_path TO ${schema}`);
  for (const name of (await readdir(new URL("../db/migrations/", import.meta.url))).filter((n) => n.endsWith(".sql")).sort()) {
    await admin.query(await readFile(new URL(`../db/migrations/${name}`, import.meta.url), "utf8"));
  }
  target.searchParams.set("options", `-c search_path=${schema}`); process.env.DATABASE_URL = target.toString();
  hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === "@/lib/auth/session") return { url: "data:text/javascript,export async function requireOwnerSession(){return {credentialId:'synthetic'}}export async function currentOwnerSession(){return null}", shortCircuit: true };
    if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  } });
  const assets = await import("../src/lib/repositories/assets.ts");
  const catalogs = await import("../src/lib/repositories/catalogs.ts");
  const { postActivity, replaceActivity, listActivities } = await import("../src/lib/finance/service.ts");
  const { postSplitBill } = await import("../src/lib/finance/split-bill-service.ts");
  const { financeSnapshot } = await import("../src/lib/finance/summary.ts");
  const { readAggregates, readExpenseItems, readSpendingItems } = await import("../src/lib/analytics/queries.ts");
  const { reportingPeriod } = await import("../src/lib/analytics/periods.ts");
  const { database } = await import("../src/lib/db/pool.ts");
  pool = database();

  const one = async (sql, p = []) => (await admin.query(sql, p)).rows[0];
  const typeId = (await one("SELECT id FROM asset_types WHERE system_key='bank_account'")).id;
  const charge = async (k) => (await one("SELECT id FROM additional_charge_types WHERE system_key=$1", [k])).id;
  const cat = async (k) => (await one("SELECT id FROM transaction_categories WHERE system_key=$1", [k])).id;
  const make = (displayName, assetClass, opening = 0n, spendable = true) => assets.insertAssetWithOpening({ displayName, currency: "IDR", assetTypeId: typeId,
    normallyLiquid: spendable, normallySpendable: spendable, openingAmountMinor: opening, openingEffectiveAt: new Date("2026-01-01T00:00:00Z"), assetClass });
  const wallet = await make("Dompet", "asset", 10000000n), card = await make("Kartu kredit", "liability", 0n, false), loan = await make("Pinjaman", "liability", 0n, false);
  const post = (draft, options) => postActivity({ occurredAt: "2026-10-10T05:00:00.000Z", ...draft }, randomUUID(), options);
  await post({ kind: "income", amountMinor: "5000000", destinationAssetId: wallet, occurredAt: "2026-10-01T03:00:00.000Z" });
  await post({ kind: "expense", amountMinor: "600000", sourceAssetId: card, charges: [{ typeId: await charge("installment_interest"), amountMinor: "30000" }] },
    { creditCycle: "current", creditInstallments: { count: 3, principalMinor: "200000", interestMinor: "10000" } });
  const e1 = await post({ kind: "expense", amountMinor: "400000", sourceAssetId: wallet, categoryId: await cat("shopping"), occurredAt: "2026-10-20T05:00:00.000Z" });
  const e1b = await replaceActivity(e1, { kind: "expense", amountMinor: "420000", sourceAssetId: wallet, categoryId: await cat("shopping"), occurredAt: "2026-10-20T05:00:00.000Z" }, randomUUID());
  await post({ kind: "borrow", amountMinor: "2000000", sourceAssetId: loan, destinationAssetId: wallet, occurredAt: "2026-10-26T05:00:00.000Z" });
  await post({ kind: "repay", amountMinor: "500000", sourceAssetId: wallet, destinationAssetId: loan, charges: [{ typeId: await charge("loan_interest"), amountMinor: "20000" }], occurredAt: "2026-10-28T05:00:00.000Z" });
  await post({ kind: "refund", amountMinor: "100000", destinationAssetId: wallet, refundOfActivityId: e1b, occurredAt: "2026-11-02T05:00:00.000Z" });
  await post({ kind: "adjustment", amountMinor: "700", adjustmentReason: "reconciliation", destinationAssetId: wallet, occurredAt: "2026-10-30T05:00:00.000Z" });
  const split = await postSplitBill({ sourceAssetId: wallet, totalMinor: "300000", reimbursedMinor: "120000", occurredAt: "2026-10-25T05:00:00.000Z", person: "Budi" }, randomUUID());

  const activities = await listActivities(true, 100);
  const byKind = (kind) => activities.find((a) => a.kind === kind && a.status === "posted");
  const list = await assets.listAssets();
  const period = reportingPeriod({ kind: "custom", startDay: "2026-10-01", endDay: "2026-11-30" }, new Date("2026-12-15T00:00:00Z"));
  const client = await pool.connect();
  let rows, spendingItems, expenseItems;
  try { rows = await readAggregates(client, period, "IDR"); spendingItems = await readSpendingItems(client, period, "IDR"); expenseItems = await readExpenseItems(client, period, "IDR"); } finally { client.release(); }
  const snapshot = await financeSnapshot({ includeRecent: false });
  const categories = await catalogs.listCatalog("transactionCategories");
  const dining = categories.find((c) => c.systemKey === "food_dining");
  const mine = await catalogs.insertCustomCategory("Kopi susu", "expense", categories.find((c) => c.systemKey === "food").id);
  await catalogs.setCategoryNature(mine.id, "saving");
  const mineListed = (await catalogs.listCatalog("transactionCategories")).find((c) => c.id === mine.id);
  const dim = (dimension) => rows.filter((r) => r.dimension === dimension);
  const pick = (value, keys) => Object.fromEntries(keys.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]));
  const measure = ["key", "name", "expensePrincipalMinor", "spendingMinor", "netMinor", "adjustmentInMinor", "debtBorrowedMinor", "debtRepaidMinor", "refundCount"];
  const idr = snapshot.currencies.find((c) => c.currency === "IDR");
  const cardAsset = list.find((a) => a.id === card);

  const examples = [
    { title: "Aktivitas `borrow` (hasil `listActivities`)", note: "Pinjaman cair: dari akun liability ke akun tujuan. Bukan pemasukan.", value: pick(byKind("borrow"), ["id", "kind", "baseAmountMinor", "currency", "sourceAssetId", "destinationAssetId", "status", "occurredAt"]) },
    { title: "Aktivitas `repay`", note: "Pokok pelunasan bukan pengeluaran; bunga ada di `charges` (jenis loan_interest) dan adalah biaya.", value: pick(byKind("repay"), ["id", "kind", "baseAmountMinor", "sourceAssetId", "destinationAssetId", "charges", "status"]) },
    { title: "Aktivitas `refund`", note: "Mengurangi pengeluaran asal (`refundOfActivityId`), tidak masuk pemasukan; kategori mengikuti pengeluaran asal.", value: pick(byKind("refund"), ["id", "kind", "baseAmountMinor", "destinationAssetId", "categoryId", "categoryName", "refundOfActivityId", "status"]) },
    { title: "Aktivitas `adjustment`", note: "Selisih saldo; hanya satu sisi akun; dilaporkan terpisah dari pemasukan/pengeluaran.", value: pick(byKind("adjustment"), ["id", "kind", "baseAmountMinor", "destinationAssetId", "adjustmentReason", "status"]) },
    { title: "Hasil `POST /api/finance/split-bill`", note: "Satu transaksi, satu kunci idempoten.", value: split },
    { title: "Akun kredit dengan `assetClass` dan `creditInstallments` (`listAssets`/`options`)", note: "`assetClass` adalah satu-satunya sumber klasifikasi; `balanceMinor` akun liability bernilai negatif.",
      value: pick(cardAsset, ["id", "displayName", "assetClass", "balanceMinor", "openingMinor", "creditInstallments"]) },
    { title: "Katalog kategori (`listCatalog`/`catalogs.transactionCategories`) bawaan", note: "Anak katalog dengan `parentId`, `nature` sendiri, dan `effectiveNature`.", value: dining },
    { title: "Katalog kategori buatan pengguna dengan override (`category-nature`)", note: "Request `POST /api/finance/category-nature` = `{ \"id\": \"<id kategori>\", \"nature\": \"saving\" }` -> `{ \"ok\": true }`; hasilnya terlihat di sini.", value: mineListed },
    { title: "`spendingItems[]` (refund dan biaya repay)", note: "Satu baris per aktivitas yang membelanjakan uang dalam periode; jumlahnya persis `spendingMinor` periode.",
      value: spendingItems.filter((i) => i.kind === "refund" || i.kind === "repay" || i.kind === "expense").slice(0, 3) },
    { title: "`expenseItems[]` dengan `refundedMinor` dan `netMinor`", note: "`spendingMinor` tetap bruto; `refundedMinor` total refund sampai kini; `netMinor` = bruto - refund.",
      value: expenseItems.filter((i) => BigInt(i.refundedMinor ?? "0") > 0n).map((i) => pick(i, ["id", "baseAmountMinor", "chargesMinor", "spendingMinor", "refundedMinor", "netMinor", "categoryName"])) },
    { title: "`activitySummary` pada detail akun (`GET /api/finance/asset-detail`)", note: "Ringkasan akun dompet.", value: (await assets.readAssetDetail(wallet)).activitySummary },
    { title: "`byCategoryParent` dan `byNature` (analitik)", note: "Pengeluaran dikelompokkan ke induk katalog dan sifat efektif (`none` = tanpa sifat).",
      value: { byCategoryParent: dim("category_parent").map((r) => pick(r, measure)), byNature: dim("category_nature").map((r) => pick(r, measure)) } },
    { title: "Ringkasan mata uang di `financeSnapshot().currencies[]`", note: "`netWorthMinor` dan `availableMinor` (dana siap pakai).", value: pick(idr, ["currency", "totalMinor", "liabilitiesMinor", "creditDebtMinor", "netWorthMinor", "eligibleMinor", "reservedMinor", "uncoveredMinor", "availableMinor", "expenseMinor"]) },
  ];

  const fields = {
    "Aktivitas": "`kind` jenis aktivitas; `baseAmountMinor` pokok (string minor unit, selalu positif); `sourceAssetId`/`destinationAssetId` akun asal/tujuan; `status` posted|voided|superseded; `charges[]` biaya (`amountMinor` > 0); `refundOfActivityId` pengeluaran yang di-refund; `adjustmentReason` reconciliation|opening_debt.",
    "Akun": "`assetClass` asset|liability|receivable; `balanceMinor` saldo = saldo awal + ledger (**boleh negatif** untuk liability); `openingMinor` saldo awal (>= 0); `creditInstallments[]` jadwal tagihan per bulan (`period` YYYY-MM, `principalMinor`, `interestMinor`, `status` scheduled|cancelled).",
    "Katalog": "`parentId` induk tingkat 1 (null = induk); `nature` sifat sendiri; `natureOverride` sifat pilihan pengguna; `effectiveNature` = override, lalu sifat sendiri, lalu sifat induk (null = tanpa sifat).",
    "Item": "`id` aktivitas; `kind` expense|transfer|repay|refund; `amountMinor` (**refund negatif**); `refundedMinor` total refund atas pengeluaran itu; `netMinor` bruto dikurangi refund.",
    "Ringkasan akun": "`expenseMinor` pengeluaran bersih yang dibayar dari akun (sudah dikurangi refund; **boleh negatif**); `refundMinor` refund yang diterima atas pengeluaran akun itu; `transferOutMinor` pokok transfer keluar.",
    "Analitik": "`expensePrincipalMinor` pokok pengeluaran dikurangi refund (**boleh negatif**); `spendingMinor` pengeluaran bersih termasuk semua biaya (**boleh negatif**); `netMinor` pemasukan - pengeluaran (**boleh negatif**); `debtBorrowedMinor`/`debtRepaidMinor` arus pokok utang (bukan pemasukan/pengeluaran); `adjustmentInMinor`/`adjustmentOutMinor` penyesuaian saldo; `refundCount` jumlah refund.",
    "Snapshot": "`totalMinor` total aset; `liabilitiesMinor` seluruh kewajiban kredit; `creditDebtMinor` tagihan jatuh tempo s.d. horizon; `netWorthMinor` kekayaan bersih (**boleh negatif**); `eligibleMinor` saldo akun yang dapat dipakai; `availableMinor` dana siap pakai = eligible - reserved - uncovered (**boleh negatif**); `expenseMinor` pengeluaran bulan berjalan (**boleh negatif** bila refund melebihi).",
  };

  // Normalisasi: UUID -> penanda stabil, buang waktu pembuatan.
  const ids = new Map();
  const normalize = (text) => text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => {
    if (/^[0-9]{8}-0000-4000-8000-/.test(m)) return m; // id katalog bawaan bersifat tetap
    if (!ids.has(m)) ids.set(m, `<id-${ids.size + 1}>`);
    return ids.get(m);
  });
  const body = examples.map((e) => `#### ${e.title}\n\n${e.note}\n\n\`\`\`json\n${normalize(JSON.stringify(e.value, null, 2))}\n\`\`\`\n`).join("\n");
  const fieldText = Object.entries(fields).map(([k, v]) => `- **${k}:** ${v}`).join("\n");
  const section = `<!-- contract-examples:start -->\n## Contoh nyata dari fixture tes\n\nDibangkitkan oleh \`scripts/contract-examples.mjs\` (jangan edit tangan; jalankan ulang untuk memperbarui). Nominal selalu string minor unit; **boleh negatif** ditandai di arti field.\n\n### Arti field\n\n${fieldText}\n\n### Contoh\n\n${body}<!-- contract-examples:end -->\n`;
  const path = new URL("../docs/CONTRACT.md", import.meta.url);
  let doc = (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
  const start = doc.indexOf("<!-- contract-examples:start -->"), end = doc.indexOf("<!-- contract-examples:end -->");
  doc = start >= 0 && end > start ? doc.slice(0, start) + section.trimEnd() + doc.slice(end + "<!-- contract-examples:end -->".length) : `${doc.trimEnd()}\n\n${section}`;
  await writeFile(path, doc);
  console.log(`CONTRACT.md diperbarui: ${examples.length} contoh`);
  hooks.deregister();
} finally {
  await pool?.end();
  await admin.query("RESET search_path").catch(() => {});
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
