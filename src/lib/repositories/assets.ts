import { requireOwnerSession } from "@/lib/auth/session";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { inDatabaseTransaction, database } from "@/lib/db/pool";
import { hasOpeningCorrections } from "@/lib/db/opening-capability";
import { addDays, jakartaToday, occursOn, scheduledAt, type Frequency, type Schedule } from "@/lib/automation/schedule";
import { saveRule, setRuleStatus } from "@/lib/automation/service";
import { encodeAssetTermsNote, parseAssetTerms } from "@/lib/domain/asset-terms";
import { assertUuid, requireActive, validateCatalogName } from "@/lib/domain/catalog";
import { parseCreditMeta } from "@/lib/domain/credit";
import { assertCurrencyCode, assertStoredMinor, money, parseMinor, type Money } from "@/lib/domain/money";
import { LifecycleError } from "./lifecycle";
import { ASSET_CLASSES, type AssetClass, type CreditInstallment, type FinanceAsset } from "@/lib/finance/types";

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
  /** Defaults to "asset" when created; kept as is when an update leaves it out. */
  assetClass?: AssetClass;
}>;

function assetClassOf(value: unknown): AssetClass | undefined {
  if (value === undefined) return undefined;
  if (!ASSET_CLASSES.includes(value as AssetClass)) throw new Error("Invalid asset class");
  return value as AssetClass;
}

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
  const id = await inDatabaseTransaction((client) => insertAssetOnClient(client, input));
  const terms = parseAssetTerms(input.note);
  if (terms.autoPostAdminFee || terms.adminRuleId) {
    await syncAssetAdminAutomation(id, null);
  }
  return id;
}

/** Same validation and inserts as insertAssetWithOpening, inside the caller's transaction (caller authorizes). */
export async function insertAssetOnClient(client: PoolClient, input: NewAsset): Promise<string> {
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
  {
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
       payment_network_id, currency_code, normally_liquid, normally_spendable, safe_suffix, note, asset_class)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, displayName, input.providerId ?? null, input.assetTypeId, input.assetGroupId ?? null,
        input.paymentNetworkId ?? null, currency, input.normallyLiquid, input.normallySpendable,
        input.safeSuffix ?? null, input.note ?? null, assetClassOf(input.assetClass) ?? "asset"],
    );
    await client.query(
      "INSERT INTO asset_opening_states (asset_id, amount_minor, effective_at) VALUES ($1,$2,$3)",
      [id, openingAmountMinor.toString(), input.openingEffectiveAt],
    );
  }
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
    note: string | null; is_active: boolean; opening_minor: string; balance_minor: string; asset_class: AssetClass;
  }>(`SELECT a.id, a.display_name, a.currency_code, c.minor_unit_exponent, a.asset_class,
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
  const installments = await readScheduledInstallments(client ?? database());
  return result.rows.map((row) => ({
    id: row.id, displayName: row.display_name, currency: row.currency_code, exponent: row.minor_unit_exponent,
    assetTypeId: row.asset_type_id, assetTypeName: row.asset_type_name,
    assetGroupId: row.asset_group_id, assetGroupName: row.asset_group_name,
    providerId: row.provider_id, providerName: row.provider_name, paymentNetworkId: row.payment_network_id,
    normallyLiquid: row.normally_liquid, normallySpendable: row.normally_spendable,
    safeSuffix: row.safe_suffix, note: row.note, isActive: row.is_active,
    openingMinor: row.opening_minor, balanceMinor: row.balance_minor, assetClass: row.asset_class,
    ...(row.asset_class === "liability" ? { creditInstallments: installments.get(row.id) ?? [] } : {}),
  }));
}

/** Scheduled installment rows from last month on, per asset; earlier months are simply part of the current bill. */
async function readScheduledInstallments(client: PoolClient | ReturnType<typeof database>): Promise<Map<string, CreditInstallment[]>> {
  const result = await client.query<{ asset_id: string; activity_id: string; seq: number; period: string; principal: string; interest: string }>(
    `SELECT asset_id, activity_id, seq, to_char(due_period, 'YYYY-MM') AS period, principal_minor::text AS principal, interest_minor::text AS interest
     FROM credit_installments
     WHERE status = 'scheduled' AND due_period >= (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') - interval '1 month')::date
     ORDER BY asset_id, due_period, activity_id, seq`);
  const byAsset = new Map<string, CreditInstallment[]>();
  for (const row of result.rows) {
    const list = byAsset.get(row.asset_id) ?? [];
    list.push({ activityId: row.activity_id, seq: row.seq, period: row.period, principalMinor: row.principal, interestMinor: row.interest, status: "scheduled" });
    byAsset.set(row.asset_id, list);
  }
  return byAsset;
}

export async function updateAsset(id: string, input: Omit<NewAsset, "currency" | "openingAmountMinor" | "openingEffectiveAt">): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const displayName = validateCatalogName(input.displayName);
  if (input.normallySpendable && !input.normallyLiquid) throw new Error("Spendable asset must also be liquid");
  if (input.safeSuffix && !/^[A-Za-z0-9]{1,4}$/.test(input.safeSuffix)) throw new Error("Invalid safe suffix");
  if (input.note && input.note.length > 1000) throw new Error("Asset note is too long");
  let previousNote: string | null = null;
  await inDatabaseTransaction(async (client) => {
    const current = (await client.query("SELECT * FROM assets WHERE id=$1 AND is_active FOR UPDATE", [id])).rows[0];
    if (!current) throw new Error("Aset aktif tidak ditemukan");
    previousNote = current.note ?? null;
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
      safe_suffix=$9, note=$10, asset_class=COALESCE($11, asset_class) WHERE id=$1 AND is_active RETURNING id`,
    [id, displayName, input.providerId ?? null, input.assetTypeId, input.assetGroupId ?? null,
      input.paymentNetworkId ?? null, input.normallyLiquid, input.normallySpendable,
      input.safeSuffix ?? null, input.note ?? null, assetClassOf(input.assetClass) ?? null]);
    if (!result.rowCount) throw new Error("Aset aktif tidak ditemukan");
  });
  const prevTerms = parseAssetTerms(previousNote);
  const nextTerms = parseAssetTerms(input.note);
  if (nextTerms.autoPostAdminFee || prevTerms.adminRuleId || nextTerms.adminRuleId) {
    await syncAssetAdminAutomation(id, previousNote);
  }
}

export async function archiveAsset(id: string): Promise<void> {
  await requireOwnerSession();
  assertUuid(id);
  const result = await database().query<{ id: string; note: string | null }>(
    "UPDATE assets SET is_active=false WHERE id=$1 AND is_active RETURNING id, note",
    [id],
  );
  if (!result.rowCount) throw new Error("Aset aktif tidak ditemukan");
  const terms = parseAssetTerms(result.rows[0]?.note);
  if (terms.adminRuleId) {
    await pauseAdminRuleIfPresent(terms.adminRuleId);
  }
}

export async function restoreAsset(id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  const result = await database().query<{ id: string; note: string | null }>(
    "UPDATE assets SET is_active=true WHERE id=$1 RETURNING id, note",
    [id],
  );
  if (!result.rowCount) throw new Error("Aset tidak ditemukan");
  const terms = parseAssetTerms(result.rows[0]?.note);
  if (terms.autoPostAdminFee && terms.adminFeeMinor > 0n) {
    await syncAssetAdminAutomation(id, result.rows[0]?.note ?? null);
  }
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

async function hasRecurringRulesTable(): Promise<boolean> {
  try {
    const res = await database().query<{ ready: boolean }>(
      "SELECT to_regclass('recurring_transaction_rules') IS NOT NULL AS ready",
    );
    return Boolean(res.rows[0]?.ready);
  } catch {
    return false;
  }
}

async function pauseAdminRuleIfPresent(ruleId: string): Promise<void> {
  try {
    if (!(await hasRecurringRulesTable())) return;
    const row = await database().query<{ status: string }>(
      "SELECT status FROM recurring_transaction_rules WHERE id=$1",
      [ruleId],
    );
    if (row.rows[0] && row.rows[0].status === "active") {
      await setRuleStatus(ruleId, "paused");
    }
  } catch {
    // Non-fatal: asset mutation itself already succeeded.
  }
}

async function ensureAdminExpenseCategoryId(): Promise<string | undefined> {
  const existing = await database().query<{ id: string }>(
    `SELECT id FROM transaction_categories
     WHERE applies_to = 'expense' AND is_active
       AND (system_key = 'bank_admin_fee' OR display_name ~* '^(biaya\\s*admin|biaya\\s*admin\\s*rekening|biaya\\s*bank)$')
     ORDER BY is_builtin DESC, created_at ASC LIMIT 1`,
  );
  if (existing.rows[0]?.id) {
    await database().query(
      "UPDATE transaction_categories SET system_key = 'bank_admin_fee', is_builtin = true WHERE id = $1 AND (system_key IS NULL OR system_key = '')",
      [existing.rows[0].id],
    );
    return existing.rows[0].id;
  }
  const createdId = randomUUID();
  const inserted = await database().query<{ id: string }>(
    `INSERT INTO transaction_categories (id, display_name, applies_to, is_builtin, system_key)
     VALUES ($1, 'Biaya Admin Rekening', 'expense', true, 'bank_admin_fee')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [createdId],
  );
  if (inserted.rows[0]?.id) return inserted.rows[0].id;
  const fallback = await database().query<{ id: string }>(
    `SELECT id FROM transaction_categories
     WHERE applies_to = 'expense' AND is_active
     ORDER BY created_at ASC LIMIT 1`,
  );
  return fallback.rows[0]?.id;
}

export async function syncAssetAdminAutomation(
  assetId: string,
  previousNote?: string | null,
): Promise<void> {
  await requireOwnerSession();
  assertUuid(assetId);
  if (!(await hasRecurringRulesTable())) return;

  const assetRow = (
    await database().query<{
      id: string;
      display_name: string;
      note: string | null;
      is_active: boolean;
    }>("SELECT id, display_name, note, is_active FROM assets WHERE id=$1", [assetId])
  ).rows[0];
  if (!assetRow) return;

  const prevTerms = parseAssetTerms(previousNote);
  const terms = parseAssetTerms(assetRow.note);
  const isCredit = parseCreditMeta(assetRow.note).isCreditFlagged;
  const candidateRuleId = terms.adminRuleId ?? prevTerms.adminRuleId;

  if (isCredit || !assetRow.is_active || terms.adminFeeMinor <= 0n || !terms.autoPostAdminFee) {
    if (candidateRuleId) {
      await pauseAdminRuleIfPresent(candidateRuleId);
    }
    return;
  }

  try {
    const frequency: Frequency = terms.adminDay === 0 ? "monthly_last_day" : "monthly_day";
    const monthDay = terms.adminDay === 0 ? undefined : terms.adminDay;
    const localTime = "08:00";
    const today = jakartaToday();
    const probeSchedule: Schedule = {
      frequency,
      monthDay: monthDay ?? null,
      weekday: null,
      localTime,
      startOn: today,
      endOn: null,
    };
    const startOn =
      occursOn(probeSchedule, today) && new Date(scheduledAt(today, localTime)) <= new Date()
        ? addDays(today, 1)
        : today;

    const categoryId = await ensureAdminExpenseCategoryId();
    const ruleInput = {
      title: `Biaya admin ${assetRow.display_name}`.slice(0, 120),
      kind: "expense" as const,
      amountMode: "fixed" as const,
      amountMinor: terms.adminFeeMinor.toString(),
      executionMode: "auto_post" as const,
      sourceAssetId: assetId,
      categoryId,
      note: `Biaya admin bulanan · ${assetRow.display_name}`,
      frequency,
      monthDay,
      localTime,
      startOn,
    };

    let existingRuleId: string | undefined;
    if (candidateRuleId) {
      const check = await database().query<{ id: string; status: string }>(
        "SELECT id, status FROM recurring_transaction_rules WHERE id=$1",
        [candidateRuleId],
      );
      if (check.rows[0]) {
        existingRuleId = check.rows[0].id;
      }
    }

    const savedRuleId = await saveRule(ruleInput, existingRuleId);
    if (existingRuleId) {
      await setRuleStatus(savedRuleId, "active");
    }

    if (savedRuleId !== terms.adminRuleId) {
      const updatedNote = encodeAssetTermsNote(terms.cleanNote, {
        adminFeeMinor: terms.adminFeeMinor,
        adminDay: terms.adminDay,
        autoPostAdminFee: terms.autoPostAdminFee,
        interestRateBps: terms.interestRateBps,
        interestTaxBps: terms.interestTaxBps,
        interestCycle: terms.interestCycle,
        interestDay: terms.interestDay,
        adminRuleId: savedRuleId,
      });
      if (!updatedNote || updatedNote.length <= 1000) {
        await database().query("UPDATE assets SET note=$2 WHERE id=$1", [assetId, updatedNote ?? null]);
      }
    }
  } catch {
    // Non-fatal if automation subsystem is unavailable; asset terms remain stored in note.
  }
}

export type AssetRecentActivity = Readonly<{
  id: string;
  kind: "income" | "expense" | "transfer";
  direction: "in" | "out";
  amountMinor: string;
  chargesMinor: string;
  categoryName: string | null;
  counterpartyName: string | null;
  note: string | null;
  occurredAt: string;
}>;

export type AssetDetailInfo = Readonly<{
  assetId: string;
  paymentNetworkName: string | null;
  openingEffectiveAt: string | null;
  createdAt: string;
  adminAutomationStatus: "active" | "paused" | "archived" | null;
  activitySummary: {
    activityCount: number;
    incomeMinor: string;
    expenseMinor: string;
    transferInMinor: string;
    transferOutMinor: string;
  };
  recentActivities: AssetRecentActivity[];
}>;

export async function readAssetDetail(assetId: string): Promise<AssetDetailInfo> {
  await requireOwnerSession();
  assertUuid(assetId);

  const metaRes = await database().query<{
    id: string;
    note: string | null;
    created_at: Date;
    effective_at: Date | null;
    network_name: string | null;
  }>(
    `SELECT a.id, a.note, a.created_at, o.effective_at, pn.display_name AS network_name
     FROM assets a
     LEFT JOIN asset_opening_states o ON o.asset_id = a.id
     LEFT JOIN payment_networks pn ON pn.id = a.payment_network_id
     WHERE a.id = $1`,
    [assetId],
  );
  const metaRow = metaRes.rows[0];
  if (!metaRow) throw new OpeningCorrectionError("Aset tidak ditemukan.");

  const terms = parseAssetTerms(metaRow.note);
  let adminAutomationStatus: "active" | "paused" | "archived" | null = null;
  if (terms.adminRuleId && (await hasRecurringRulesTable())) {
    const ruleRes = await database().query<{ status: "active" | "paused" | "archived" }>(
      "SELECT status FROM recurring_transaction_rules WHERE id = $1",
      [terms.adminRuleId],
    );
    adminAutomationStatus = ruleRes.rows[0]?.status ?? null;
  }

  const summaryRes = await database().query<{
    activity_count: string;
    income_minor: string;
    expense_minor: string;
    transfer_in_minor: string;
    transfer_out_minor: string;
  }>(
    `SELECT
       COUNT(*)::text AS activity_count,
       COALESCE(SUM(CASE WHEN f.kind = 'income' AND f.destination_asset_id = $1 THEN f.base_amount_minor ELSE 0 END), 0)::text AS income_minor,
       COALESCE(SUM(CASE WHEN f.kind = 'expense' AND f.source_asset_id = $1 THEN f.base_amount_minor + COALESCE(ch.charges_minor, 0) ELSE 0 END), 0)::text AS expense_minor,
       COALESCE(SUM(CASE WHEN f.kind = 'transfer' AND f.destination_asset_id = $1 THEN f.base_amount_minor ELSE 0 END), 0)::text AS transfer_in_minor,
       COALESCE(SUM(CASE WHEN f.kind = 'transfer' AND f.source_asset_id = $1 THEN f.base_amount_minor + COALESCE(ch.charges_minor, 0) ELSE 0 END), 0)::text AS transfer_out_minor
     FROM financial_activities f
     LEFT JOIN (
       SELECT activity_id, SUM(amount_minor)::numeric AS charges_minor
       FROM activity_charges
       GROUP BY activity_id
     ) ch ON ch.activity_id = f.id
     WHERE f.status = 'posted'
       AND (f.source_asset_id = $1 OR f.destination_asset_id = $1)`,
    [assetId],
  );

  const recentRes = await database().query<{
    id: string;
    kind: "income" | "expense" | "transfer";
    base_amount_minor: string;
    charges_minor: string;
    source_asset_id: string | null;
    source_name: string | null;
    destination_asset_id: string | null;
    destination_name: string | null;
    category_name: string | null;
    note: string | null;
    occurred_at: Date;
  }>(
    `SELECT
       f.id,
       f.kind,
       f.base_amount_minor::text,
       COALESCE(ch.charges_minor, 0)::text AS charges_minor,
       f.source_asset_id,
       s.display_name AS source_name,
       f.destination_asset_id,
       d.display_name AS destination_name,
       cat.display_name AS category_name,
       f.note,
       f.occurred_at
     FROM financial_activities f
     LEFT JOIN assets s ON s.id = f.source_asset_id
     LEFT JOIN assets d ON d.id = f.destination_asset_id
     LEFT JOIN transaction_categories cat ON cat.id = f.category_id
     LEFT JOIN (
       SELECT activity_id, SUM(amount_minor)::numeric AS charges_minor
       FROM activity_charges
       GROUP BY activity_id
     ) ch ON ch.activity_id = f.id
     WHERE f.status = 'posted'
       AND (f.source_asset_id = $1 OR f.destination_asset_id = $1)
     ORDER BY f.occurred_at DESC, f.id DESC
     LIMIT 6`,
    [assetId],
  );

  const sumRow = summaryRes.rows[0];
  return {
    assetId,
    paymentNetworkName: metaRow.network_name,
    openingEffectiveAt: metaRow.effective_at ? metaRow.effective_at.toISOString() : null,
    createdAt: metaRow.created_at.toISOString(),
    adminAutomationStatus,
    activitySummary: {
      activityCount: Number(sumRow?.activity_count ?? "0"),
      incomeMinor: sumRow?.income_minor ?? "0",
      expenseMinor: sumRow?.expense_minor ?? "0",
      transferInMinor: sumRow?.transfer_in_minor ?? "0",
      transferOutMinor: sumRow?.transfer_out_minor ?? "0",
    },
    recentActivities: recentRes.rows.map((row) => {
      const isInflow = row.destination_asset_id === assetId && row.source_asset_id !== assetId;
      const totalOutflow = (BigInt(row.base_amount_minor) + BigInt(row.charges_minor)).toString();
      const counterpartyName =
        row.kind === "transfer"
          ? isInflow
            ? row.source_name
            : row.destination_name
          : null;
      return {
        id: row.id,
        kind: row.kind,
        direction: isInflow ? "in" : "out",
        amountMinor: isInflow ? row.base_amount_minor : totalOutflow,
        chargesMinor: isInflow ? "0" : row.charges_minor,
        categoryName: row.category_name,
        counterpartyName,
        note: row.note,
        occurredAt: row.occurred_at.toISOString(),
      };
    }),
  };
}

export type AssetClassChange = Readonly<{ assetId: string; assetClass: AssetClass; changed: boolean }>;

/**
 * Changes assets.asset_class. Refused while the account still has scheduled credit installments (the schedule
 * only makes sense on a liability). Idempotent by key; each real change is logged in asset_class_changes.
 */
export async function changeAssetClass(assetId: string, assetClass: unknown, key: string): Promise<AssetClassChange> {
  await requireOwnerSession();
  assertUuid(assetId); assertUuid(key);
  if (!ASSET_CLASSES.includes(assetClass as AssetClass)) throw new Error("Kelas aset tidak valid");
  const target = assetClass as AssetClass;
  const requestHash = createHash("sha256").update(JSON.stringify({ operation: "asset-class", assetId, target })).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const prior = await client.query<{ request_hash: string; asset_id: string; new_class: AssetClass }>(
      "SELECT request_hash,asset_id,new_class FROM asset_class_changes WHERE idempotency_key=$1", [key]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== requestHash) throw new Error("Kunci permintaan sudah digunakan untuk perubahan lain");
      return { assetId, assetClass: prior.rows[0].new_class, changed: true };
    }
    const row = (await client.query<{ asset_class: AssetClass }>("SELECT asset_class FROM assets WHERE id=$1 FOR UPDATE", [assetId])).rows[0];
    if (!row) throw new Error("Aset tidak ditemukan");
    if (row.asset_class === target) return { assetId, assetClass: target, changed: false };
    const scheduled = await client.query("SELECT 1 FROM credit_installments WHERE asset_id=$1 AND status='scheduled' LIMIT 1", [assetId]);
    if (scheduled.rowCount) throw new LifecycleError("Kelas akun tidak dapat diubah selama masih ada jadwal cicilan. Batalkan atau lunasi cicilannya dulu.");
    await client.query("UPDATE assets SET asset_class=$2 WHERE id=$1", [assetId, target]);
    await client.query(`INSERT INTO asset_class_changes (id,idempotency_key,asset_id,previous_class,new_class,request_hash)
      VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), key, assetId, row.asset_class, target, requestHash]);
    return { assetId, assetClass: target, changed: true };
  });
}
