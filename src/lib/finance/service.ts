import { activityReadOrder, type ActivityReadOrder } from "./activity-order.ts";
import "server-only";
import { temporalOrderSql } from "../list-order.ts";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid } from "@/lib/domain/catalog";
import { parseCreditMeta, type CreditInstallmentTerms } from "@/lib/domain/credit";
import { applyCreditPost, applyCreditVoid } from "@/lib/domain/credit-purchase";
import { planActivity, type ActivityInput, type AssetReference, type CategoryReference, type ChargeInput } from "@/lib/domain/ledger";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import type { ActivityDraft, ActivityKind, AnyActivityKind, AdjustmentReason, AssetClass, CreditInstallment, FinanceActivity } from "./types";

function positive(raw: unknown): bigint {
  if (typeof raw !== "string") throw new Error("Jumlah harus berupa bilangan bulat dalam unit terkecil");
  const value = assertStoredMinor(parseMinor(raw));
  if (value <= 0n) throw new Error("Jumlah harus lebih dari nol");
  return value;
}
function dateFrom(raw: unknown): Date {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) throw new Error("Tanggal tidak valid");
  const value = new Date(raw);
  if (Number.isNaN(value.getTime()) || value.toISOString() !== raw) throw new Error("Tanggal tidak valid");
  return value;
}
function noteFrom(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 1000) throw new Error("Catatan terlalu panjang");
  return raw.trim() || null;
}
function normalizeDraft(raw: ActivityDraft): ActivityDraft {
  if (!raw || !["income", "expense", "transfer", "borrow", "repay", "refund", "adjustment"].includes(raw.kind)) throw new Error("Jenis transaksi tidak valid");
  const amountMinor = positive(raw.amountMinor).toString();
  const occurredAt = dateFrom(raw.occurredAt).toISOString();
  const note = noteFrom(raw.note) ?? undefined;
  const sourceAssetId = raw.sourceAssetId ? assertUuid(raw.sourceAssetId) : undefined;
  const destinationAssetId = raw.destinationAssetId ? assertUuid(raw.destinationAssetId) : undefined;
  const categoryId = raw.categoryId ? assertUuid(raw.categoryId) : undefined;
  if (raw.kind === "borrow" || raw.kind === "repay") {
    if (!sourceAssetId || !destinationAssetId || categoryId || raw.transferFeeMinor) throw new Error("Bentuk pinjaman/pelunasan tidak valid");
    if (raw.kind === "borrow" && raw.charges?.length) throw new Error("Pinjaman tidak memiliki biaya tambahan");
    if (raw.charges && (!Array.isArray(raw.charges) || raw.charges.length > 1)) throw new Error("Pelunasan hanya memiliki satu bunga");
    const charges = (raw.charges ?? []).map((charge) => ({ typeId: assertUuid(charge.typeId), amountMinor: positive(charge.amountMinor).toString() }));
    return { kind: raw.kind, amountMinor, sourceAssetId, destinationAssetId, charges: charges.length ? charges : undefined, occurredAt, note };
  }
  if (raw.kind === "refund") {
    if (!destinationAssetId || sourceAssetId || raw.charges?.length || raw.transferFeeMinor || !raw.refundOfActivityId) throw new Error("Bentuk refund tidak valid");
    return { kind: "refund", amountMinor, destinationAssetId, refundOfActivityId: assertUuid(raw.refundOfActivityId), occurredAt, note };
  }
  if (raw.kind === "adjustment") {
    if (Boolean(sourceAssetId) === Boolean(destinationAssetId) || categoryId || raw.charges?.length || raw.transferFeeMinor
      || !["reconciliation", "opening_debt"].includes(raw.adjustmentReason as string)) throw new Error("Bentuk penyesuaian tidak valid");
    return { kind: "adjustment", amountMinor, sourceAssetId, destinationAssetId, adjustmentReason: raw.adjustmentReason, occurredAt, note };
  }
  if (raw.kind === "income") {
    if (!destinationAssetId || sourceAssetId || raw.charges?.length || raw.transferFeeMinor) throw new Error("Bentuk pemasukan tidak valid");
    return { kind: "income", amountMinor, destinationAssetId, categoryId, occurredAt, note };
  }
  if (raw.kind === "expense") {
    if (!sourceAssetId || destinationAssetId || raw.transferFeeMinor) throw new Error("Bentuk pengeluaran tidak valid");
    if (raw.charges && (!Array.isArray(raw.charges) || raw.charges.length > 20)) throw new Error("Terlalu banyak biaya tambahan");
    const charges = (raw.charges ?? []).map((charge) => ({ typeId: assertUuid(charge.typeId), amountMinor: positive(charge.amountMinor).toString() }));
    return { kind: "expense", amountMinor, sourceAssetId, categoryId, charges, occurredAt, note };
  }
  if (!sourceAssetId || !destinationAssetId || categoryId || raw.charges?.length) throw new Error("Bentuk transfer tidak valid");
  const transferFeeMinor = raw.transferFeeMinor && raw.transferFeeMinor !== "0" ? positive(raw.transferFeeMinor).toString() : undefined;
  return { kind: "transfer", amountMinor, sourceAssetId, destinationAssetId, transferFeeMinor, occurredAt, note };
}

async function activeAsset(client: PoolClient, id: string): Promise<AssetReference> {
  const result = await client.query<{ id: string; currency_code: string; is_active: boolean; asset_class: AssetClass }>(
    "SELECT id, currency_code, is_active, asset_class FROM assets WHERE id=$1 FOR SHARE", [id]);
  const row = result.rows[0];
  if (!row || !row.is_active) throw new Error("Pilih aset aktif");
  return { id: row.id, currency: row.currency_code, isActive: true, assetClass: row.asset_class };
}
async function activeCategory(client: PoolClient, id: string | undefined, kind: "income" | "expense"): Promise<CategoryReference | undefined> {
  if (!id) return undefined;
  const result = await client.query<{ id: string; display_name: string; system_key: string | null; is_builtin: boolean; is_active: boolean; applies_to: "income" | "expense" }>(
    "SELECT id,display_name,system_key,is_builtin,is_active,applies_to FROM transaction_categories WHERE id=$1 FOR SHARE", [id]);
  const row = result.rows[0];
  if (!row || !row.is_active || row.applies_to !== kind) throw new Error("Kategori tidak cocok");
  return { id: row.id, displayName: row.display_name, systemKey: row.system_key,
    isBuiltIn: row.is_builtin, isActive: row.is_active, appliesTo: row.applies_to };
}
async function activeCharge(client: PoolClient, typeId: string, amountMinor: string): Promise<ChargeInput> {
  const result = await client.query<{ id: string; display_name: string; system_key: string | null; is_builtin: boolean; is_active: boolean }>(
    "SELECT id,display_name,system_key,is_builtin,is_active FROM additional_charge_types WHERE id=$1 FOR SHARE", [typeId]);
  const row = result.rows[0];
  if (!row || !row.is_active) throw new Error("Jenis biaya tidak aktif");
  return { id: randomUUID(), amountMinor: positive(amountMinor), type: {
    id: row.id, displayName: row.display_name, systemKey: row.system_key, isBuiltIn: row.is_builtin, isActive: row.is_active,
  } };
}
async function buildInput(client: PoolClient, draft: ActivityDraft): Promise<ActivityInput> {
  const amountMinor = positive(draft.amountMinor);
  if (draft.kind === "income") return { kind: "income", amountMinor,
    destination: await activeAsset(client, draft.destinationAssetId!),
    category: await activeCategory(client, draft.categoryId, "income") };
  if (draft.kind === "expense") {
    const charges: ChargeInput[] = [];
    for (const charge of draft.charges ?? []) charges.push(await activeCharge(client, charge.typeId, charge.amountMinor));
    return { kind: "expense", amountMinor,
      source: await activeAsset(client, draft.sourceAssetId!),
      category: await activeCategory(client, draft.categoryId, "expense"), charges };
  }
  if (draft.kind === "borrow") return { kind: "borrow", amountMinor,
    source: await activeAsset(client, draft.sourceAssetId!), destination: await activeAsset(client, draft.destinationAssetId!) };
  if (draft.kind === "repay") return { kind: "repay", amountMinor,
    source: await activeAsset(client, draft.sourceAssetId!), destination: await activeAsset(client, draft.destinationAssetId!),
    interest: draft.charges?.[0] ? await activeCharge(client, draft.charges[0].typeId, draft.charges[0].amountMinor) : undefined };
  if (draft.kind === "refund") {
    const origin = (await client.query<{ category_id: string | null }>(
      "SELECT o.category_id FROM expense_versions ev JOIN financial_activities o ON o.id=ev.current_id WHERE ev.version_id=$1", [draft.refundOfActivityId])).rows[0];
    if (!origin) throw new Error("Pengeluaran asal refund tidak ditemukan");
    // The category is copied from the expense even if it has since been archived.
    const category = origin.category_id ? (await client.query<{ id: string; display_name: string; system_key: string | null; is_builtin: boolean }>(
      "SELECT id,display_name,system_key,is_builtin FROM transaction_categories WHERE id=$1", [origin.category_id])).rows[0] : undefined;
    return { kind: "refund", amountMinor, destination: await activeAsset(client, draft.destinationAssetId!),
      category: category && { id: category.id, displayName: category.display_name, systemKey: category.system_key, isBuiltIn: category.is_builtin, isActive: true, appliesTo: "expense" } };
  }
  if (draft.kind === "adjustment") return { kind: "adjustment", amountMinor, reason: draft.adjustmentReason!,
    source: draft.sourceAssetId ? await activeAsset(client, draft.sourceAssetId) : undefined,
    destination: draft.destinationAssetId ? await activeAsset(client, draft.destinationAssetId) : undefined };
  const fee = draft.transferFeeMinor
    ? await client.query<{ id: string }>("SELECT id FROM additional_charge_types WHERE system_key='transfer_fee' AND is_active") : null;
  if (draft.transferFeeMinor && !fee?.rows[0]) throw new Error("Jenis biaya transfer tidak tersedia");
  return { kind: "transfer", amountMinor,
    source: await activeAsset(client, draft.sourceAssetId!),
    destination: await activeAsset(client, draft.destinationAssetId!),
    transferFee: draft.transferFeeMinor ? await activeCharge(client, fee!.rows[0].id, draft.transferFeeMinor) : undefined };
}

async function insertPosted(client: PoolClient, draft: ActivityDraft, replacesId?: string): Promise<string> {
  const input = await buildInput(client, draft);
  const plan = planActivity(input);
  const categoryId = input.kind === "refund" ? input.category?.id : draft.categoryId;
  for (const movement of plan.movements) assertStoredMinor(movement.amountMinor);
  assertStoredMinor(plan.totalOutflowMinor);
  const id = randomUUID();
  await client.query(`INSERT INTO financial_activities
    (id,kind,base_amount_minor,currency_code,source_asset_id,destination_asset_id,category_id,category_kind,occurred_at,note,replaces_activity_id,
     refund_of_activity_id,adjustment_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, draft.kind, plan.baseAmountMinor.toString(), plan.currency, draft.sourceAssetId ?? null,
      draft.destinationAssetId ?? null, categoryId ?? null, categoryId ? (draft.kind === "refund" ? "expense" : draft.kind) : null,
      dateFrom(draft.occurredAt), draft.note ?? null, replacesId ?? null,
      draft.kind === "refund" ? draft.refundOfActivityId : null, draft.kind === "adjustment" ? draft.adjustmentReason : null]);
  for (const charge of plan.charges) {
    await client.query(`INSERT INTO activity_charges (id,activity_id,activity_kind,charge_type_id,amount_minor)
      VALUES ($1,$2,$3,$4,$5)`, [charge.id, id, draft.kind, charge.type.id, charge.amountMinor.toString()]);
  }
  for (const movement of plan.movements) {
    await client.query(`INSERT INTO ledger_movements
      (id,activity_id,asset_id,currency_code,component,charge_id,amount_minor)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), id, movement.assetId, movement.currency, movement.component,
        movement.chargeId ?? null, movement.amountMinor.toString()]);
  }
  return id;
}

async function reversePosted(client: PoolClient, id: string, status: "voided" | "superseded"): Promise<void> {
  const row = await client.query<{ status: string }>("SELECT status FROM financial_activities WHERE id=$1 FOR UPDATE", [id]);
  if (!row.rows[0] || row.rows[0].status !== "posted") throw new Error("Transaksi ini sudah tidak aktif");
  const movements = await client.query<{ id: string; asset_id: string; currency_code: string; amount_minor: string }>(
    "SELECT id,asset_id,currency_code,amount_minor::text FROM ledger_movements WHERE activity_id=$1 AND component <> 'reversal' ORDER BY id", [id]);
  if (!movements.rowCount) throw new Error("Ledger transaksi tidak lengkap");
  for (const movement of movements.rows) {
    const opposite = assertStoredMinor(-parseMinor(movement.amount_minor));
    await client.query(`INSERT INTO ledger_movements
      (id,activity_id,asset_id,currency_code,component,amount_minor,reverses_movement_id)
      VALUES ($1,$2,$3,$4,'reversal',$5,$6)`,
      [randomUUID(), id, movement.asset_id, movement.currency_code, opposite.toString(), movement.id]);
  }
  await client.query("UPDATE financial_activities SET status=$2,voided_at=now() WHERE id=$1", [id, status]);
}

/** Billing cycle an outflow from a credit/PayLater account is assigned to. */
export type CreditCycle = "current" | "next";

/** Balance reduction an activity caused on one asset, from its original (non-reversal) ledger movements. */
async function sourceImpactMinor(client: PoolClient, activityId: string, assetId: string): Promise<bigint> {
  const row = await client.query<{ impact: string }>(`SELECT (-COALESCE(sum(amount_minor),0))::text AS impact
    FROM ledger_movements WHERE activity_id=$1 AND asset_id=$2 AND component <> 'reversal'`, [activityId, assetId]);
  return parseMinor(row.rows[0]?.impact ?? "0");
}
async function writeCreditNote(client: PoolClient, assetId: string, note: string | null): Promise<void> {
  await client.query("UPDATE assets SET note=$2 WHERE id=$1", [assetId, note]);
}
/** How a credit outflow is billed: its cycle, and for installments the per-month principal and interest. */
export type CreditPosting = {
  creditCycle?: CreditCycle;
  creditInstallments?: { count: number; principalMinor: string; interestMinor: string };
};
type CreditSchedulePlan = { cycle: CreditCycle; installments?: CreditInstallmentTerms };
/** The credit-schedule kind of an outflow from the source account, or null when the draft is not one. */
function scheduleKindOf(draft: ActivityDraft): "expense" | "transfer" | null {
  if (!draft.sourceAssetId) return null;
  if (draft.kind === "expense") return "expense";
  if (draft.kind === "transfer" || draft.kind === "repay" || draft.kind === "borrow") return "transfer";
  return draft.kind === "adjustment" && draft.adjustmentReason === "opening_debt" ? "transfer" : null;
}
/** Borrowed money and opening debt are only scheduled as principal-only installments; the legacy note branch is never used for them. */
function debtPlanFor(draft: ActivityDraft, posting: CreditPosting): CreditSchedulePlan | null {
  const plan = creditPlanFor(posting);
  if (!plan) return null;
  if (draft.kind !== "borrow" && !(draft.kind === "adjustment" && draft.adjustmentReason === "opening_debt")) return plan;
  if (!plan.installments) return null;
  if (plan.installments.interestMinor !== 0n) throw new Error("Jadwal pinjaman hanya memuat pokok; bunga dibukukan saat pelunasan");
  return plan;
}
function creditPlanFor(posting: CreditPosting): CreditSchedulePlan | null {
  if (posting.creditCycle !== "current" && posting.creditCycle !== "next") return null;
  const raw = posting.creditInstallments;
  let installments: CreditInstallmentTerms | undefined;
  if (raw) {
    if (!Number.isInteger(raw.count) || raw.count < 2 || raw.count > 36) throw new Error("Tenor cicilan tidak valid");
    const principalMinor = assertStoredMinor(parseMinor(raw.principalMinor));
    const interestMinor = assertStoredMinor(parseMinor(raw.interestMinor));
    if (principalMinor < 0n || interestMinor < 0n) throw new Error("Rincian cicilan tidak valid");
    installments = { count: raw.count, principalMinor, interestMinor };
  }
  if (posting.creditCycle === "current" && !installments) return null; // billed now: nothing to schedule
  return { cycle: posting.creditCycle, installments };
}
/** Schedules a freshly posted credit outflow by due month inside the posting transaction. */
async function scheduleCreditOutflow(client: PoolClient, activityId: string, kind: "expense" | "transfer", assetId: string,
  plan: CreditSchedulePlan): Promise<void> {
  const asset = await client.query<{ note: string | null; currency_code: string; asset_class: AssetClass }>("SELECT note,currency_code,asset_class FROM assets WHERE id=$1 FOR UPDATE", [assetId]);
  if (!asset.rows[0]) return;
  if (asset.rows[0].asset_class !== "liability") throw new Error("Jadwal tagihan hanya untuk akun kredit");
  const impact = await sourceImpactMinor(client, activityId, assetId);
  if (impact <= 0n) return;
  const before = { note: asset.rows[0].note, installments: [] };
  const next = applyCreditPost(before, { activityId, impactMinor: impact, cycle: plan.cycle, kind, installments: plan.installments });
  if (next.note !== before.note) await writeCreditNote(client, assetId, next.note);
  for (const row of next.installments) {
    await client.query(`INSERT INTO credit_installments (id,asset_id,currency_code,activity_id,seq,due_period,principal_minor,interest_minor)
      VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8)`, [randomUUID(), assetId, asset.rows[0].currency_code, row.activityId, row.seq,
      `${row.period}-01`, row.principalMinor, row.interestMinor]);
  }
}
async function scheduledInstallments(client: PoolClient, activityId: string): Promise<CreditInstallment[]> {
  const rows = await client.query<{ seq: number; period: string; principal: string; interest: string }>(
    `SELECT seq,to_char(due_period,'YYYY-MM') AS period,principal_minor::text AS principal,interest_minor::text AS interest
     FROM credit_installments WHERE activity_id=$1 AND status='scheduled' ORDER BY seq FOR UPDATE`, [activityId]);
  return rows.rows.map((row) => ({ activityId, seq: row.seq, period: row.period, principalMinor: row.principal, interestMinor: row.interest, status: "scheduled" }));
}
/**
 * Keeps a credit account's schedule in step with a voided or corrected outflow. With `rescheduled`, the
 * replacement brings its own schedule, so everything of the old outflow is released.
 */
async function releaseCreditSchedule(client: PoolClient, reversedId: string, replacementId?: string, rescheduled = false): Promise<void> {
  const activity = await client.query<{ kind: string; source_asset_id: string | null; occurred_at: Date }>(
    "SELECT kind,source_asset_id,occurred_at FROM financial_activities WHERE id=$1", [reversedId]);
  const row = activity.rows[0];
  if (!row || row.kind === "income" || !row.source_asset_id) return;
  const asset = await client.query<{ note: string | null }>("SELECT note FROM assets WHERE id=$1 FOR UPDATE", [row.source_asset_id]);
  if (!asset.rows[0]) return;
  const installments = await scheduledInstallments(client, reversedId);
  const meta = parseCreditMeta(asset.rows[0].note);
  if (!installments.length && (!meta.isCreditFlagged || meta.schedule.length === 0)) return; // skips the impact reads
  const keepShape = replacementId && !rescheduled;
  const updated = applyCreditVoid({ note: asset.rows[0].note, installments }, {
    activityId: reversedId,
    occurredAtIso: row.occurred_at.toISOString(),
    reversedImpactMinor: await sourceImpactMinor(client, reversedId, row.source_asset_id),
    replacementActivityId: keepShape ? replacementId : undefined,
    replacementImpactMinor: keepShape ? await sourceImpactMinor(client, replacementId, row.source_asset_id) : 0n,
  });
  if (!updated) return;
  if (updated.note !== asset.rows[0].note) await writeCreditNote(client, row.source_asset_id, updated.note);
  for (const cancelled of updated.installments.filter((item) => item.status === "cancelled")) {
    await client.query(`UPDATE credit_installments SET status='cancelled',cancelled_by_activity_id=$3
      WHERE activity_id=$1 AND seq=$2 AND status='scheduled'`, [cancelled.activityId, cancelled.seq, replacementId ?? reversedId]);
  }
}

async function idempotentOnClient(client: PoolClient, operation: "post" | "replace" | "void", key: string, payload: unknown,
  action: (client: PoolClient) => Promise<string>): Promise<string> {
  assertUuid(key);
  const requestHash = createHash("sha256").update(JSON.stringify({ operation, payload })).digest("hex");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  const prior = await client.query<{ operation: string; request_hash: string; result_activity_id: string }>(
    "SELECT operation,request_hash,result_activity_id FROM finance_operations WHERE idempotency_key=$1", [key]);
  if (prior.rows[0]) {
    if (prior.rows[0].operation !== operation || prior.rows[0].request_hash !== requestHash) throw new Error("Kunci permintaan sudah digunakan untuk perubahan lain");
    return prior.rows[0].result_activity_id;
  }
  const id = await action(client);
  await client.query("INSERT INTO finance_operations (idempotency_key,operation,request_hash,result_activity_id) VALUES ($1,$2,$3,$4)",
    [key, operation, requestHash, id]);
  return id;
}
async function withIdempotency(operation: "post" | "replace" | "void", key: string, payload: unknown,
  action: (client: PoolClient) => Promise<string>): Promise<string> {
  await requireOwnerSession();
  return inDatabaseTransaction((client) => idempotentOnClient(client,operation,key,payload,action));
}

export async function postActivity(raw: ActivityDraft, key: string, options: CreditPosting = {}): Promise<string> {
  const draft = normalizeDraft(raw);
  const plan = scheduleKindOf(draft) ? debtPlanFor(draft, options) : null;
  // Plain posts keep their historical request hash; a scheduled credit post hashes its billing as well.
  const payload = plan ? { draft, creditCycle: plan.cycle, creditInstallments: options.creditInstallments ?? null } : draft;
  return withIdempotency("post", key, payload, async (client) => {
    if (plan) await client.query("SELECT id FROM assets WHERE id=$1 FOR UPDATE", [draft.sourceAssetId]);
    const id = await insertPosted(client, draft);
    if (plan) await scheduleCreditOutflow(client, id, scheduleKindOf(draft)!, draft.sourceAssetId!, plan);
    return id;
  });
}
/** Caller must authorize before opening the enclosing transaction. Uses ordinary P3 posting and idempotency. */
export async function postActivityInTransaction(client: PoolClient, raw: ActivityDraft, key: string): Promise<string> {
  const draft = normalizeDraft(raw);
  return idempotentOnClient(client,"post",key,draft,(connection) => insertPosted(connection,draft));
}
export async function replaceActivity(oldId: string, raw: ActivityDraft, key: string, options: CreditPosting = {}): Promise<string> {
  assertUuid(oldId);
  const draft = normalizeDraft(raw);
  const plan = scheduleKindOf(draft) ? debtPlanFor(draft, options) : null;
  // Plain corrections keep their historical request hash; a rescheduled credit correction hashes its billing as well.
  // A correction that moves a charge back to the current bill has no new schedule but must release the old one.
  const rebill = Boolean(plan) || (scheduleKindOf(draft) !== null && options.creditCycle === "current");
  const payload = plan ? { oldId, draft, creditCycle: plan.cycle, creditInstallments: options.creditInstallments ?? null }
    : rebill ? { oldId, draft, creditCycle: "current" } : { oldId, draft };
  return withIdempotency("replace", key, payload, async (client) => {
    if (plan) await client.query("SELECT id FROM assets WHERE id=$1 FOR UPDATE", [draft.sourceAssetId]);
    await reversePosted(client, oldId, "superseded");
    const id = await insertPosted(client, draft, oldId);
    // The old schedule is cancelled first; a replacement with its own billing then gets fresh rows.
    await releaseCreditSchedule(client, oldId, id, rebill);
    if (plan) await scheduleCreditOutflow(client, id, scheduleKindOf(draft)!, draft.sourceAssetId!, plan);
    return id;
  });
}
export async function voidActivity(id: string, key: string): Promise<string> {
  assertUuid(id);
  return withIdempotency("void", key, { id }, async (client) => {
    await reversePosted(client, id, "voided");
    await releaseCreditSchedule(client, id);
    return id;
  });
}
/** Caller must authorize before opening the enclosing transaction. Uses ordinary P3 voiding and idempotency. */
export async function voidActivityInTransaction(client: PoolClient, id: string, key: string): Promise<string> {
  assertUuid(id);
  return idempotentOnClient(client, "void", key, { id }, async (connection) => {
    await reversePosted(connection, id, "voided");
    await releaseCreditSchedule(connection, id);
    return id;
  });
}

export async function listActivities(includeHistory = false, limit: number | null = 500, options: ActivityReadOrder = {}): Promise<FinanceActivity[]> {
  await requireOwnerSession();
  if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 500)) throw new Error("Invalid activity read limit");
  const ordering = activityReadOrder(options);
  const result = await database().query<{
    cursor_time: string; id: string; kind: AnyActivityKind; base_amount_minor: string; currency_code: string; minor_unit_exponent: number;
    refund_of_activity_id: string | null; adjustment_reason: AdjustmentReason | null;
    refunded_minor: string | null; net_minor: string | null;
    source_asset_id: string | null; source_name: string | null; destination_asset_id: string | null; destination_name: string | null;
    category_id: string | null; category_name: string | null; occurred_at: Date; note: string | null;
    status: "posted" | "voided" | "superseded"; replaces_activity_id: string | null;
  }>(`SELECT f.occurred_at::text AS cursor_time,f.id,f.kind,f.base_amount_minor::text,f.currency_code,c.minor_unit_exponent,
    f.source_asset_id,s.display_name AS source_name,f.destination_asset_id,d.display_name AS destination_name,
    f.category_id,cat.display_name AS category_name,f.occurred_at,f.note,f.status,f.replaces_activity_id,
    f.refund_of_activity_id,f.adjustment_reason,
    CASE WHEN f.kind='expense' AND f.status='posted' THEN refunded_in_chain(f.id)::text END AS refunded_minor,
    CASE WHEN f.kind='expense' AND f.status='posted' THEN (
      COALESCE((SELECT sum(se.amount_minor) FROM spending_effects se WHERE se.activity_id=f.id), 0) - refunded_in_chain(f.id)
    )::text END AS net_minor
    FROM financial_activities f JOIN currencies c ON c.code=f.currency_code
    LEFT JOIN assets s ON s.id=f.source_asset_id LEFT JOIN assets d ON d.id=f.destination_asset_id
    LEFT JOIN transaction_categories cat ON cat.id=f.category_id
    WHERE ($1::boolean OR f.status='posted') AND ($3::text IS NULL OR f.kind=$3)
      AND ($4::timestamptz IS NULL OR (f.occurred_at,f.id) ${ordering.operator} ($4::timestamptz,$5::uuid))
    ORDER BY ${temporalOrderSql("f.occurred_at", "f.id", ordering.direction)} LIMIT $2`, [includeHistory, limit,ordering.kind,ordering.after?.at??null,ordering.after?.id??null]);
  const ids = result.rows.map((row) => row.id);
  const charges = ids.length ? await database().query<{ id: string; activity_id: string; charge_type_id: string; display_name: string; system_key: string | null; amount_minor: string }>(
    `SELECT ac.id,ac.activity_id,ac.charge_type_id,t.display_name,t.system_key,ac.amount_minor::text
     FROM activity_charges ac JOIN additional_charge_types t ON t.id=ac.charge_type_id
     WHERE ac.activity_id=ANY($1::uuid[]) ORDER BY ac.created_at,ac.id`, [ids]) : { rows: [] };
  // Terms are the same in every month except month 1's principal remainder, so month 2 carries the base principal.
  const installmentTerms = ids.length ? await database().query<{ activity_id: string; count: number; principal: string; interest: string }>(
    `SELECT activity_id,count(*)::int AS count,(max(principal_minor) FILTER (WHERE seq=2))::text AS principal,max(interest_minor)::text AS interest
     FROM credit_installments WHERE activity_id=ANY($1::uuid[]) GROUP BY activity_id`, [ids]) : { rows: [] };
  const termsByActivity = new Map(installmentTerms.rows.map((row) => [row.activity_id,
    { count: row.count, principalMinor: row.principal ?? "0", interestMinor: row.interest }]));
  const ready = ids.length ? (await database().query<{
    recurring: boolean; event: boolean; general: boolean; allocation: boolean;
  }>(`SELECT
    to_regclass('recurring_transaction_occurrences') IS NOT NULL AS recurring,
    to_regclass('income_event_instances') IS NOT NULL AS event,
    to_regclass('automation_action_results') IS NOT NULL AS general,
    to_regclass('automation_allocation_adjustments') IS NOT NULL AS allocation`)).rows[0] : {
    recurring: false, event: false, general: false, allocation: false,
  };
  const lineageCte = `WITH RECURSIVE lineage AS (
    SELECT id,id AS origin_id,0 AS depth FROM financial_activities WHERE id=ANY($1::uuid[])
    UNION ALL SELECT lineage.id,f.replaces_activity_id,lineage.depth+1 FROM lineage
      JOIN financial_activities f ON f.id=lineage.origin_id WHERE f.replaces_activity_id IS NOT NULL AND lineage.depth<30)`;
  const recurring = ready.recurring ? await database().query<{ id: string; title: string }>(`${lineageCte}
    SELECT lineage.id,r.title FROM lineage JOIN recurring_transaction_occurrences o ON o.activity_id=lineage.origin_id
      JOIN recurring_transaction_rules r ON r.id=o.rule_id`, [ids]) : { rows: [] };
  const recurringNames = new Map(recurring.rows.map((entry) => [entry.id,entry.title]));
  const eventOrigins = ready.event ? await database().query<{id:string;instance_id:string;title:string;
    root_activity_id:string;base_amount_minor:string;currency_code:string;occurred_at:Date;source_exponent:number}>(`${lineageCte}
    SELECT lineage.id,i.id AS instance_id,v.title,i.root_activity_id,source.base_amount_minor::text,
      source.currency_code,source.occurred_at,source_currency.minor_unit_exponent AS source_exponent
    FROM lineage JOIN income_event_instances i ON i.result_activity_id=lineage.origin_id
      JOIN income_event_rule_versions v ON v.rule_id=i.rule_id AND v.version_no=i.rule_version
      JOIN financial_activities source ON source.id=i.effective_activity_id JOIN currencies source_currency ON source_currency.code=source.currency_code`,[ids]) : {rows:[]};
  const eventNames = new Map(eventOrigins.rows.map((entry) => [entry.id,entry]));
  const generalOrigins = ready.general ? await database().query<{id:string;instance_id:string;title:string;root_activity_id:string|null;
    source_kind:"income"|"expense"|"transfer"|null;base_amount_minor:string|null;currency_code:string|null;occurred_at:Date|null;source_exponent:number|null}>(`${lineageCte}
    SELECT lineage.id,i.id AS instance_id,v.title,i.root_activity_id,source.kind AS source_kind,
      source.base_amount_minor::text,source.currency_code,source.occurred_at,source_currency.minor_unit_exponent AS source_exponent
    FROM lineage JOIN automation_action_results a ON a.activity_id=lineage.origin_id JOIN automation_instances i ON i.id=a.instance_id
      JOIN automation_rule_versions v ON v.rule_id=i.rule_id AND v.version_no=i.version_no
      LEFT JOIN financial_activities source ON source.id=i.effective_activity_id LEFT JOIN currencies source_currency ON source_currency.code=source.currency_code`,[ids]) : {rows:[]};
  const generalNames = new Map(generalOrigins.rows.map((entry) => [entry.id,entry]));
  const allocationOrigins = ready.allocation ? await database().query<{id:string;instance_id:string;storage:string;adjustment_id:string;assessment_id:string;
    title:string;root_activity_id:string;original_result_id:string;base_amount_minor:string;currency_code:string;occurred_at:Date;source_exponent:number}>(`${lineageCte}
    SELECT lineage.id,COALESCE(a.legacy_instance_id,a.general_instance_id) AS instance_id,
      CASE WHEN a.legacy_instance_id IS NOT NULL THEN 'income_event' ELSE 'general' END AS storage,
      p.id AS adjustment_id,a.id AS assessment_id,a.rule_snapshot->>'title' AS title,a.root_activity_id,a.original_result_id,
      source.base_amount_minor::text,source.currency_code,source.occurred_at,c.minor_unit_exponent AS source_exponent
    FROM lineage JOIN automation_allocation_adjustments p ON p.result_activity_id=lineage.origin_id
      JOIN automation_allocation_assessments a ON a.id=p.assessment_id JOIN financial_activities source ON source.id=a.effective_activity_id
      JOIN currencies c ON c.code=source.currency_code`,[ids]) : {rows:[]};
  const allocationNames = new Map(allocationOrigins.rows.map(entry=>[entry.id,entry]));
  return result.rows.map((row) => ({
    cursorTime: row.cursor_time, id: row.id, kind: row.kind as ActivityKind, baseAmountMinor: row.base_amount_minor, currency: row.currency_code, exponent: row.minor_unit_exponent,
    sourceAssetId: row.source_asset_id, sourceName: row.source_name, destinationAssetId: row.destination_asset_id,
    destinationName: row.destination_name, categoryId: row.category_id, categoryName: row.category_name,
    occurredAt: row.occurred_at.toISOString(), note: row.note, status: row.status, replacesActivityId: row.replaces_activity_id,
    refundOfActivityId: row.refund_of_activity_id, adjustmentReason: row.adjustment_reason,
    ...(row.refunded_minor !== null ? { refundedMinor: row.refunded_minor, netMinor: row.net_minor! } : {}),
    recurringRuleName: allocationNames.get(row.id)?.title ?? recurringNames.get(row.id) ?? eventNames.get(row.id)?.title ?? generalNames.get(row.id)?.title,
    automationInstanceId:allocationNames.get(row.id)?.instance_id ?? generalNames.get(row.id)?.instance_id,
    allocationAdjustmentId:allocationNames.get(row.id)?.adjustment_id,
    allocationAssessmentId:allocationNames.get(row.id)?.assessment_id,
    originalAutomationResultId:allocationNames.get(row.id)?.original_result_id,
    automationSourceActivityId:allocationNames.get(row.id)?.root_activity_id ?? generalNames.get(row.id)?.root_activity_id ?? undefined,
    automationSourceKind:allocationNames.has(row.id) ? "income" : generalNames.get(row.id)?.source_kind ?? undefined,
    eventInstanceId:eventNames.get(row.id)?.instance_id,
    eventSourceIncomeId:eventNames.get(row.id)?.root_activity_id,
    eventSourceAmountMinor:allocationNames.get(row.id)?.base_amount_minor ?? eventNames.get(row.id)?.base_amount_minor ?? generalNames.get(row.id)?.base_amount_minor ?? undefined,
    eventSourceCurrency:allocationNames.get(row.id)?.currency_code ?? eventNames.get(row.id)?.currency_code ?? generalNames.get(row.id)?.currency_code ?? undefined,
    eventSourceOccurredAt:allocationNames.get(row.id)?.occurred_at.toISOString() ?? eventNames.get(row.id)?.occurred_at.toISOString() ?? generalNames.get(row.id)?.occurred_at?.toISOString(),
    eventSourceExponent:allocationNames.get(row.id)?.source_exponent ?? eventNames.get(row.id)?.source_exponent??generalNames.get(row.id)?.source_exponent??undefined,
    charges: charges.rows.filter((charge) => charge.activity_id === row.id).map((charge) => ({
      id: charge.id, typeId: charge.charge_type_id, typeName: charge.display_name, systemKey: charge.system_key, amountMinor: charge.amount_minor,
    })),
    ...(termsByActivity.has(row.id) ? { creditInstallments: termsByActivity.get(row.id) } : {}),
  }));
}
