import { requireOwnerSession } from "@/lib/auth/session";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { inDatabaseTransaction, database } from "@/lib/db/pool";
import { hasOpeningCorrections } from "@/lib/db/opening-capability";
import { assertUuid, requireActive, validateCatalogName } from "@/lib/domain/catalog";
import { assertCurrencyCode, assertStoredMinor, money, parseMinor, type Money } from "@/lib/domain/money";
import type { FinanceAsset } from "@/lib/finance/types";

export type NewAsset = Readonly<{
  displayName: string;
  currency: string;
  assetTypeId: string;
  assetGroupId?: string;
  providerId?: string;
  paymentNetworkId?: string;
  normallyLiquid: boolean;
  normallySpendable: boolean;
  openingAmountMinor: bigint;
  openingEffectiveAt: Date;
  safeSuffix?: string;
  note?: string;
}>;

const relationTables = {
  assetTypeId: "asset_types",
  assetGroupId: "asset_groups",
  providerId: "financial_providers",
  paymentNetworkId: "payment_networks",
} as const;

async function activeReference(client: PoolClient, table: string, id: string): Promise<void> {
  assertUuid(id);
  const result = await client.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM ${table} WHERE id = $1 FOR SHARE`,
    [id],
  );
  requireActive(result.rows[0] && { id: result.rows[0].id, isActive: result.rows[0].is_active }, id);
}

/** Original opening is immutable; corrections have their own append-only history. */
export async function insertAssetWithOpening(input: NewAsset): Promise<string> {
  await requireOwnerSession();
  const displayName = validateCatalogName(input.displayName);
  const currency = assertCurrencyCode(input.currency);
  const openingAmountMinor = assertStoredMinor(input.openingAmountMinor);
  if (openingAmountMinor < 0n) throw new Error("Opening asset amount cannot be negative");
  if (input.normallySpendable && !input.normallyLiquid) throw new Error("Spendable asset must also be liquid");
  if (!(input.openingEffectiveAt instanceof Date) || Number.isNaN(input.openingEffectiveAt.getTime())) {
    throw new Error("Valid opening time is required");
  }
  if (input.safeSuffix && !/^[A-Za-z0-9]{1,4}$/.test(input.safeSuffix)) throw new Error("Invalid safe suffix");
  if (input.note && input.note.length > 1000) throw new Error("Asset note is too long");
  const id = randomUUID();
  await inDatabaseTransaction(async (client) => {
    const currencyResult = await client.query<{ code: string; is_active: boolean }>(
      "SELECT code, is_active FROM currencies WHERE code = $1 FOR SHARE",
      [currency],
    );
    requireActive(currencyResult.rows[0] && {
      id: currencyResult.rows[0].code,
      isActive: currencyResult.rows[0].is_active,
    }, currency);
    for (const [field, table] of Object.entries(relationTables)) {
      const relatedId = input[field as keyof typeof relationTables];
      if (relatedId) await activeReference(client, table, relatedId);
      else if (field === "assetTypeId") throw new Error("Asset type is required");
    }
    await client.query(
      `INSERT INTO assets (id, display_name, provider_id, asset_type_id, asset_group_id,
       payment_network_id, currency_code, normally_liquid, normally_spendable, safe_suffix, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, displayName, input.providerId ?? null, input.assetTypeId, input.assetGroupId ?? null,
        input.paymentNetworkId ?? null, currency, input.normallyLiquid, input.normallySpendable,
        input.safeSuffix ?? null, input.note ?? null],
    );
    await client.query(
      "INSERT INTO asset_opening_states (asset_id, amount_minor, effective_at) VALUES ($1,$2,$3)",
      [id, openingAmountMinor.toString(), input.openingEffectiveAt],
    );
  });
  return id;
}

export type AssetBalance = Readonly<{ assetId: string; displayName: string; balance: Money }>;

/** Read-only exact projection: opening amount plus all signed ledger movements. */
export async function listAssetBalances(): Promise<AssetBalance[]> {
  await requireOwnerSession();
  const ready = await hasOpeningCorrections(database());
  const opening = ready ? "COALESCE(oc.corrected_amount_minor, o.amount_minor, 0)" : "COALESCE(o.amount_minor, 0)";
  const correctionJoin = ready ? "LEFT JOIN LATERAL (SELECT corrected_amount_minor FROM asset_opening_corrections WHERE asset_id=a.id ORDER BY correction_order DESC LIMIT 1) oc ON true" : "";
  const result = await database().query<{
    id: string;
    display_name: string;
    currency_code: string;
    balance_minor: string;
  }>(`SELECT a.id, a.display_name, a.currency_code,
       (${opening}::numeric + COALESCE(m.delta_minor, 0))::text AS balance_minor
     FROM assets a
     LEFT JOIN asset_opening_states o ON o.asset_id = a.id
     ${correctionJoin}
     LEFT JOIN (
       SELECT asset_id, SUM(amount_minor)::numeric AS delta_minor
       FROM ledger_movements GROUP BY asset_id
     ) m ON m.asset_id = a.id
     ORDER BY a.sort_order, a.created_at, a.id`);
  return result.rows.map((row) => ({
    assetId: row.id,
    displayName: row.display_name,
    balance: money(parseMinor(row.balance_minor), row.currency_code),
  }));
}

export async function listAssets(includeArchived = true, client?: PoolClient): Promise<FinanceAsset[]> {
  const read = await prepareOwnerAssetRead();
  return read(includeArchived, client);
}

/** Request-local authorized reader for a shared snapshot; authorize before borrowing its connection. */
export async function prepareOwnerAssetRead() {
  await requireOwnerSession();
  return readAssets;
}

async function readAssets(includeArchived = true, client?: PoolClient): Promise<FinanceAsset[]> {
  const ready = await hasOpeningCorrections(client ?? database());
  const opening = ready ? "COALESCE(oc.corrected_amount_minor,o.amount_minor)" : "o.amount_minor";
  const correctionJoin = ready ? "LEFT JOIN LATERAL (SELECT corrected_amount_minor FROM asset_opening_corrections WHERE asset_id=a.id ORDER BY correction_order DESC LIMIT 1) oc ON true" : "";
  const result = await (client ?? database()).query<{
    id: string; display_name: string; currency_code: string; minor_unit_exponent: number;
    asset_type_id: string; asset_type_name: string; asset_group_id: string | null; asset_group_name: string | null;
    provider_id: string | null; provider_name: string | null; payment_network_id: string | null;
    normally_liquid: boolean; normally_spendable: boolean; safe_suffix: string | null;
    note: string | null; is_active: boolean; opening_minor: string; balance_minor: string;
  }>(`SELECT a.id, a.display_name, a.currency_code, c.minor_unit_exponent,
      a.asset_type_id, t.display_name AS asset_type_name, a.asset_group_id,
      g.display_name AS asset_group_name, a.provider_id, p.display_name AS provider_name,
      a.payment_network_id, a.normally_liquid, a.normally_spendable, a.safe_suffix,
      a.note, a.is_active, ${opening}::text AS opening_minor,
      (${opening}::numeric + COALESCE(m.delta_minor, 0))::text AS balance_minor
    FROM assets a
    JOIN asset_opening_states o ON o.asset_id = a.id
    ${correctionJoin}
    JOIN currencies c ON c.code = a.currency_code
    JOIN asset_types t ON t.id = a.asset_type_id
    LEFT JOIN asset_groups g ON g.id = a.asset_group_id
    LEFT JOIN financial_providers p ON p.id = a.provider_id
    LEFT JOIN (SELECT asset_id, SUM(amount_minor)::numeric AS delta_minor FROM ledger_movements GROUP BY asset_id) m ON m.asset_id = a.id
    WHERE ($1::boolean OR a.is_active)
    ORDER BY a.is_active DESC, a.sort_order, a.created_at, a.id`, [includeArchived]);
  return result.rows.map((row) => ({
    id: row.id, displayName: row.display_name, currency: row.currency_code, exponent: row.minor_unit_exponent,
    assetTypeId: row.asset_type_id, assetTypeName: row.asset_type_name,
    assetGroupId: row.asset_group_id, assetGroupName: row.asset_group_name,
    providerId: row.provider_id, providerName: row.provider_name, paymentNetworkId: row.payment_network_id,
    normallyLiquid: row.normally_liquid, normallySpendable: row.normally_spendable,
    safeSuffix: row.safe_suffix, note: row.note, isActive: row.is_active,
    openingMinor: row.opening_minor, balanceMinor: row.balance_minor,
  }));
}

export async function updateAsset(id: string, input: Omit<NewAsset, "currency" | "openingAmountMinor" | "openingEffectiveAt">): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const displayName = validateCatalogName(input.displayName);
  if (input.normallySpendable && !input.normallyLiquid) throw new Error("Spendable asset must also be liquid");
  if (input.safeSuffix && !/^[A-Za-z0-9]{1,4}$/.test(input.safeSuffix)) throw new Error("Invalid safe suffix");
  if (input.note && input.note.length > 1000) throw new Error("Asset note is too long");
  await inDatabaseTransaction(async (client) => {
    const current = (await client.query("SELECT * FROM assets WHERE id=$1 AND is_active FOR UPDATE", [id])).rows[0];
    if (!current) throw new Error("Aset aktif tidak ditemukan");
    const columns = { assetTypeId: "asset_type_id", assetGroupId: "asset_group_id", providerId: "provider_id", paymentNetworkId: "payment_network_id" } as const;
    for (const [field, table] of Object.entries(relationTables)) {
      const relatedId = input[field as keyof typeof relationTables];
      if (relatedId) {
        assertUuid(relatedId);
        // Existing archived classifications remain valid historical metadata;
        // changing to another classification still requires an active row.
        if (relatedId !== current[columns[field as keyof typeof columns]]) await activeReference(client, table, relatedId);
      }
      else if (field === "assetTypeId") throw new Error("Asset type is required");
    }
    const result = await client.query(`UPDATE assets SET display_name=$2, provider_id=$3, asset_type_id=$4,
      asset_group_id=$5, payment_network_id=$6, normally_liquid=$7, normally_spendable=$8,
      safe_suffix=$9, note=$10 WHERE id=$1 AND is_active RETURNING id`,
    [id, displayName, input.providerId ?? null, input.assetTypeId, input.assetGroupId ?? null,
      input.paymentNetworkId ?? null, input.normallyLiquid, input.normallySpendable,
      input.safeSuffix ?? null, input.note ?? null]);
    if (!result.rowCount) throw new Error("Aset aktif tidak ditemukan");
  });
}

export async function archiveAsset(id: string): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const result = await database().query("UPDATE assets SET is_active=false WHERE id=$1 AND is_active RETURNING id", [id]);
  if (!result.rowCount) throw new Error("Aset aktif tidak ditemukan");
}

export async function restoreAsset(id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  const result = await database().query("UPDATE assets SET is_active=true WHERE id=$1 RETURNING id", [id]);
  if (!result.rowCount) throw new Error("Aset tidak ditemukan");
}

export class OpeningCorrectionError extends Error {}
export type AssetOpeningHistory = { originalMinor: string; effectiveMinor: string; currency: string; exponent: number;
  corrections: { id: string; previousMinor: string; correctedMinor: string; note: string | null; createdAt: string }[] };

export async function assetOpeningHistory(assetId: string): Promise<AssetOpeningHistory> {
  await requireOwnerSession(); assertUuid(assetId);
  if (!await hasOpeningCorrections(database())) throw new OpeningCorrectionError("Koreksi saldo awal belum tersedia di database lokal.");
  const original = (await database().query(`SELECT o.amount_minor::text,a.currency_code,c.minor_unit_exponent
    FROM asset_opening_states o JOIN assets a ON a.id=o.asset_id JOIN currencies c ON c.code=a.currency_code WHERE o.asset_id=$1`, [assetId])).rows[0];
  if (!original) throw new OpeningCorrectionError("Aset tidak ditemukan.");
  const rows = (await database().query(`SELECT id,previous_amount_minor::text,corrected_amount_minor::text,note,created_at
    FROM asset_opening_corrections WHERE asset_id=$1 ORDER BY correction_order DESC`, [assetId])).rows;
  return { originalMinor: original.amount_minor, effectiveMinor: rows[0]?.corrected_amount_minor ?? original.amount_minor,
    currency: original.currency_code, exponent: original.minor_unit_exponent,
    corrections: rows.map((row) => ({ id: row.id, previousMinor: row.previous_amount_minor,
      correctedMinor: row.corrected_amount_minor, note: row.note, createdAt: row.created_at.toISOString() })) };
}

export async function correctAssetOpening(input: { assetId: string; expectedMinor: string; correctedMinor: string; note?: string; idempotencyKey: string }): Promise<string> {
  await requireOwnerSession(); assertUuid(input.assetId); assertUuid(input.idempotencyKey);
  const expected = assertStoredMinor(parseMinor(input.expectedMinor));
  const corrected = assertStoredMinor(parseMinor(input.correctedMinor));
  if (expected < 0n || corrected < 0n) throw new OpeningCorrectionError("Saldo awal tidak boleh negatif.");
  const note = input.note?.trim() || null;
  if (note && note.length > 1000) throw new OpeningCorrectionError("Catatan terlalu panjang.");
  const payload = { assetId: input.assetId, expectedMinor: expected.toString(), correctedMinor: corrected.toString(), note };
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return inDatabaseTransaction(async (client) => {
    if (!await hasOpeningCorrections(client)) throw new OpeningCorrectionError("Koreksi saldo awal belum tersedia di database lokal.");
    // Serializes competing corrections and archive operations for this asset.
    const asset = (await client.query("SELECT id,is_active FROM assets WHERE id=$1 FOR UPDATE", [input.assetId])).rows[0];
    if (!asset) throw new OpeningCorrectionError("Aset tidak ditemukan.");
    const prior = (await client.query("SELECT id,request_hash FROM asset_opening_corrections WHERE idempotency_key=$1", [input.idempotencyKey])).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new OpeningCorrectionError("Kunci permintaan sudah dipakai untuk koreksi lain.");
      return prior.id as string;
    }
    if (!asset.is_active) throw new OpeningCorrectionError("Pulihkan aset sebelum mengoreksi saldo awal.");
    const opening = (await client.query("SELECT amount_minor::text FROM asset_opening_states WHERE asset_id=$1", [input.assetId])).rows[0];
    const latest = (await client.query("SELECT corrected_amount_minor::text FROM asset_opening_corrections WHERE asset_id=$1 ORDER BY correction_order DESC LIMIT 1", [input.assetId])).rows[0];
    const effective = latest?.corrected_amount_minor ?? opening?.amount_minor;
    if (effective === undefined) throw new OpeningCorrectionError("Saldo awal tidak ditemukan.");
    if (BigInt(effective) !== expected) throw new OpeningCorrectionError("Saldo awal sudah berubah. Muat ulang lalu periksa nilainya.");
    if (corrected === expected) throw new OpeningCorrectionError("Masukkan saldo awal yang berbeda.");
    const id = randomUUID();
    await client.query(`INSERT INTO asset_opening_corrections (id,asset_id,previous_amount_minor,corrected_amount_minor,note,idempotency_key,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id,input.assetId,expected.toString(),corrected.toString(),note,input.idempotencyKey,hash]);
    return id;
  });
}
