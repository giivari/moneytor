// Logika migrasi data pengguna (Tugas 4B). Dipisah dari CLI supaya bisa diuji pada fixture sintetis.
// Hanya: (e) parent_id kategori pengguna (NULL -> nilai), penonaktifan kategori tak terpakai, dan (d) utang awal (adjustment opening_debt).
// Satu transaksi; snapshot saldo, kekayaan bersih (Σ saldo akun), dan total pengeluaran/pemasukan per bulan (WIB) sebelum dan sesudah
// harus sama (kecuali perubahan saldo yang direncanakan dari utang awal); tidak ada void+replace.
import { createHash, randomUUID } from "node:crypto";

export const SAFE_HOST = "127.0.0.1", SAFE_PORT = "55435", SAFE_DB = "moneytor_prod_copy";

/** The CLI only ever runs against the local Postgres 18 copy of the owner's data, never Neon or the test container. */
export function assertSafeTarget(url, args) {
  if (url.hostname !== SAFE_HOST) throw new Error(`Target harus ${SAFE_HOST} (salinan lokal), bukan ${url.hostname}`);
  if (url.port !== SAFE_PORT) throw new Error(`Target harus port ${SAFE_PORT} (container moneytor-prod-copy-18), bukan ${url.port || "default"}`);
  if (url.pathname !== `/${SAFE_DB}`) throw new Error(`Database harus ${SAFE_DB}`);
  if (args.includes("--apply") && !args.includes(`--confirm-db=${SAFE_DB}`)) throw new Error(`--apply wajib disertai --confirm-db=${SAFE_DB}`);
}

/** Minimal CSV (header row, quoted fields allowed) -> array of objects; empty lines ignored. */
export function parseCsv(text) {
  const rows = []; let row = [], field = "", quoted = false;
  const push = () => { row.push(field); field = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; push(); if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else field += c;
  }
  push(); if (row.some((x) => x !== "")) rows.push(row);
  const [header, ...body] = rows;
  return (body ?? []).map((cells) => Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] ?? "").trim()])));
}

const uuidFrom = (text) => { const h = createHash("sha256").update(text).digest("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };

async function snapshot(client) {
  const balances = (await client.query(`SELECT a.id, a.asset_class, a.currency_code,
      (COALESCE(oc.corrected_amount_minor, o.amount_minor, 0) + COALESCE(m.d, 0))::text AS balance
    FROM assets a LEFT JOIN asset_opening_states o ON o.asset_id = a.id
    LEFT JOIN LATERAL (SELECT corrected_amount_minor FROM asset_opening_corrections WHERE asset_id = a.id ORDER BY correction_order DESC LIMIT 1) oc ON true
    LEFT JOIN (SELECT asset_id, sum(amount_minor) AS d FROM ledger_movements GROUP BY asset_id) m ON m.asset_id = a.id ORDER BY a.id`)).rows;
  const netWorth = {};
  for (const b of balances) netWorth[b.currency_code] = (BigInt(netWorth[b.currency_code] ?? 0) + BigInt(b.balance)).toString();
  const monthly = (await client.query(`SELECT currency_code AS c, to_char(occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM') AS m, sum(amount_minor)::text AS v
    FROM spending_effects GROUP BY 1, 2 ORDER BY 1, 2`)).rows.map((r) => `${r.c}|${r.m}|${r.v}`);
  const income = (await client.query(`SELECT currency_code AS c, to_char(occurred_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM') AS m, sum(base_amount_minor)::text AS v
    FROM financial_activities WHERE kind = 'income' AND status = 'posted' GROUP BY 1, 2 ORDER BY 1, 2`)).rows.map((r) => `${r.c}|${r.m}|${r.v}`);
  return { balances: Object.fromEntries(balances.map((b) => [b.id, b.balance])), classes: Object.fromEntries(balances.map((b) => [b.id, b.asset_class])), netWorth, monthly, income };
}

async function categoryStep(client, row, counts) {
  const { nama_kategori: name, applies_to: scope, induk_system_key: parentKey, aksi: action } = row;
  if (!["income", "expense"].includes(scope)) throw new Error(`applies_to tidak valid untuk "${name}"`);
  const found = (await client.query(`SELECT id, parent_id, is_active FROM transaction_categories
    WHERE (NOT is_builtin OR system_key = 'bank_admin_fee') AND applies_to = $1 AND lower(btrim(display_name)) = lower(btrim($2)) FOR UPDATE`, [scope, name])).rows;
  if (found.length === 0) throw new Error(`Kategori "${name}" (${scope}) tidak ditemukan`);
  if (found.length > 1) throw new Error(`Kategori "${name}" (${scope}) ambigu: ${found.length} kecocokan`);
  const category = found[0];
  if (action === "map") {
    const parent = (await client.query("SELECT id FROM transaction_categories WHERE system_key = $1 AND applies_to = $2 AND parent_id IS NULL", [parentKey, scope])).rows[0];
    if (!parent) throw new Error(`Induk katalog "${parentKey}" (${scope}) untuk "${name}" tidak ditemukan sebagai kategori tingkat 1`);
    if (category.parent_id) { counts.skipped++; return; } // parent_id hanya NULL -> nilai
    await client.query("UPDATE transaction_categories SET parent_id = $2 WHERE id = $1 AND parent_id IS NULL", [category.id, parent.id]);
    counts.mapped++;
  } else if (action === "nonaktifkan") {
    if (!category.is_active) { counts.skipped++; return; }
    const used = (await client.query(`SELECT (SELECT count(*) FROM financial_activities WHERE category_id = $1)
      + COALESCE((SELECT count(*) FROM planning_budgets WHERE category_id = $1), 0) AS n`, [category.id])).rows[0].n;
    if (Number(used) > 0) throw new Error(`Kategori "${name}" masih dipakai (${used} rujukan); tidak dinonaktifkan`);
    await client.query("UPDATE transaction_categories SET is_active = false WHERE id = $1 AND is_active", [category.id]);
    counts.deactivated++;
  } else throw new Error(`aksi tidak dikenal untuk "${name}": ${action}`);
}

async function debtStep(client, row, counts, expected) {
  const amount = BigInt(row.amount_minor);
  if (amount <= 0n) throw new Error("amount_minor utang awal harus positif");
  const asset = (await client.query("SELECT id, asset_class, currency_code, is_active FROM assets WHERE id = $1 FOR UPDATE", [row.asset_id])).rows[0];
  if (!asset || !asset.is_active) throw new Error("Akun utang awal tidak ditemukan atau tidak aktif");
  if (asset.asset_class !== "liability") throw new Error("Utang awal hanya untuk akun liability");
  const id = uuidFrom(`opening-debt:${asset.id}:${amount}:${new Date(row.occurred_at).toISOString()}`);
  if ((await client.query("SELECT 1 FROM financial_activities WHERE id = $1", [id])).rowCount) return; // sudah ada: idempoten
  await client.query(`INSERT INTO financial_activities (id, kind, base_amount_minor, currency_code, source_asset_id, occurred_at, note, adjustment_reason)
    VALUES ($1, 'adjustment', $2, $3, $4, $5, 'Utang awal', 'opening_debt')`, [id, amount.toString(), asset.currency_code, asset.id, new Date(row.occurred_at)]);
  await client.query(`INSERT INTO ledger_movements (id, activity_id, asset_id, currency_code, component, amount_minor) VALUES ($1, $2, $3, $4, 'principal', $5)`,
    [randomUUID(), id, asset.id, asset.currency_code, (-amount).toString()]);
  await client.query(`INSERT INTO finance_operations (idempotency_key, operation, request_hash, result_activity_id) VALUES ($1, 'post', $2, $1)`,
    [id, createHash("sha256").update(`user-migrate:${id}`).digest("hex")]);
  expected.balances[asset.id] = (BigInt(expected.balances[asset.id]) - amount).toString();
  expected.netWorth[asset.currency_code] = (BigInt(expected.netWorth[asset.currency_code]) - amount).toString();
  counts.debts++;
}

/** Runs everything in ONE transaction; dry-run (apply=false) always rolls back. Throws on any problem or unexpected difference. */
export async function runUserMigrate(client, { mapRows, debtRows, apply }) {
  const counts = { mapped: 0, skipped: 0, deactivated: 0, debts: 0 };
  await client.query("BEGIN");
  try {
    const before = await snapshot(client);
    const expected = structuredClone(before);
    for (const row of mapRows) await categoryStep(client, row, counts);
    for (const row of debtRows) await debtStep(client, row, counts, expected);
    const after = await snapshot(client);
    const identical = JSON.stringify(after) === JSON.stringify(expected);
    if (!identical) throw new Error("Selisih terdeteksi pada saldo, kekayaan bersih, atau total bulanan; dibatalkan");
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { applied: apply, identical, counts, before, after };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
