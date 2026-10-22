import "server-only";
import { readAutomationReviewContexts } from "./review-service";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid } from "@/lib/domain/catalog";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { postActivityInTransaction, voidActivityInTransaction } from "@/lib/finance/service";
import type { ActivityDraft, ActivityKind } from "@/lib/finance/types";
import { addDays, dateOnly, jakartaToday, occursOn, scheduledAt, type Frequency, type Schedule } from "./schedule";

export type RuleInput = Schedule & {
  title: string; kind: ActivityKind; amountMode: "fixed" | "confirm_amount"; amountMinor?: string;
  executionMode: "auto_post" | "confirm_before_post"; sourceAssetId?: string;
  destinationAssetId?: string; categoryId?: string; transferFeeMinor?: string; note?: string;
  charges?: { typeId: string; amountMinor: string }[];
};
type Row = Record<string, unknown>;
export class AutomationError extends Error {}
const maximumDailyScan = 31;
const maximumPostsPerVisit = 10;
const genericFailure = "Transaksi belum dapat dicatat. Periksa aset, kategori, dan biaya, lalu coba lagi.";

function positive(value: unknown): string {
  if (typeof value !== "string") throw new AutomationError("Jumlah harus diisi dalam unit terkecil.");
  const minor = assertStoredMinor(parseMinor(value));
  if (minor <= 0n) throw new AutomationError("Jumlah harus lebih dari nol.");
  return minor.toString();
}
function uuid(value: unknown): string | null { return value ? assertUuid(value as string) : null; }
function normalize(raw: RuleInput): RuleInput {
  if (!raw || !["income", "expense", "transfer"].includes(raw.kind)) throw new AutomationError("Jenis transaksi tidak valid.");
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title || title.length > 120) throw new AutomationError("Nama otomatisasi harus 1–120 karakter.");
  if (!["fixed", "confirm_amount"].includes(raw.amountMode) || !["auto_post", "confirm_before_post"].includes(raw.executionMode)) throw new AutomationError("Mode otomatisasi tidak valid.");
  if (raw.amountMode === "confirm_amount" && raw.executionMode !== "confirm_before_post") throw new AutomationError("Jumlah berubah harus dikonfirmasi sebelum dicatat.");
  const amountMinor = raw.amountMode === "fixed" ? positive(raw.amountMinor) : undefined;
  if (!["daily", "weekdays", "weekly", "monthly_day", "monthly_last_day"].includes(raw.frequency)) throw new AutomationError("Frekuensi tidak valid.");
  const startOn = dateOnly(raw.startOn);
  const endOn = raw.endOn ? dateOnly(raw.endOn) : undefined;
  if (endOn && endOn < startOn) throw new AutomationError("Tanggal akhir mendahului tanggal mulai.");
  scheduledAt(startOn, raw.localTime);
  const weekday = raw.frequency === "weekly" ? Number(raw.weekday) : undefined;
  const monthDay = raw.frequency === "monthly_day" ? Number(raw.monthDay) : undefined;
  if (raw.frequency === "weekly" && (!Number.isInteger(weekday) || weekday! < 1 || weekday! > 7)) throw new AutomationError("Pilih hari mingguan.");
  if (raw.frequency === "monthly_day" && (!Number.isInteger(monthDay) || monthDay! < 1 || monthDay! > 28)) throw new AutomationError("Tanggal bulanan harus 1–28.");
  const sourceAssetId = uuid(raw.sourceAssetId) ?? undefined;
  const destinationAssetId = uuid(raw.destinationAssetId) ?? undefined;
  const categoryId = uuid(raw.categoryId) ?? undefined;
  const charges = raw.charges ?? [];
  if (!Array.isArray(charges) || charges.length > 20) throw new AutomationError("Terlalu banyak biaya tambahan.");
  if (raw.kind === "income" && (!destinationAssetId || sourceAssetId || raw.transferFeeMinor || charges.length)) throw new AutomationError("Pemasukan memerlukan aset tujuan.");
  if (raw.kind === "expense" && (!sourceAssetId || destinationAssetId || raw.transferFeeMinor)) throw new AutomationError("Pengeluaran memerlukan aset sumber.");
  if (raw.kind === "transfer" && (!sourceAssetId || !destinationAssetId || sourceAssetId === destinationAssetId || categoryId || charges.length)) throw new AutomationError("Transfer memerlukan dua aset berbeda.");
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length > 1000) throw new AutomationError("Catatan terlalu panjang.");
  return { title, kind: raw.kind, amountMode: raw.amountMode, amountMinor, executionMode: raw.executionMode,
    sourceAssetId, destinationAssetId, categoryId, transferFeeMinor: raw.kind === "transfer" && raw.transferFeeMinor && raw.transferFeeMinor !== "0" ? positive(raw.transferFeeMinor) : undefined,
    note, charges: raw.kind === "expense" ? charges.map((item) => ({ typeId: assertUuid(item.typeId), amountMinor: positive(item.amountMinor) })) : [],
    frequency: raw.frequency, weekday, monthDay, localTime: raw.localTime, startOn, endOn };
}
async function validateReferences(client: PoolClient, item: RuleInput): Promise<void> {
  const ids = [item.sourceAssetId, item.destinationAssetId].filter(Boolean);
  const assets = await client.query<{ id: string; currency_code: string }>("SELECT id,currency_code FROM assets WHERE id=ANY($1::uuid[]) AND is_active FOR SHARE", [ids]);
  if (assets.rowCount !== ids.length || new Set(assets.rows.map((row) => row.currency_code)).size !== 1) throw new AutomationError("Pilih aset aktif dengan mata uang yang sama.");
  if (item.categoryId) {
    const category = await client.query("SELECT id FROM transaction_categories WHERE id=$1 AND applies_to=$2 AND is_active FOR SHARE", [item.categoryId, item.kind]);
    if (!category.rowCount) throw new AutomationError("Kategori tidak cocok atau sudah diarsipkan.");
  }
  for (const charge of item.charges ?? []) {
    const type = await client.query("SELECT id FROM additional_charge_types WHERE id=$1 AND is_active FOR SHARE", [charge.typeId]);
    if (!type.rowCount) throw new AutomationError("Jenis biaya tidak aktif.");
  }
  if (item.transferFeeMinor) {
    const type = await client.query("SELECT id FROM additional_charge_types WHERE system_key='transfer_fee' AND is_active");
    if (!type.rowCount) throw new AutomationError("Biaya transfer tidak tersedia.");
  }
}
const ruleColumns = `title,kind,amount_mode,amount_minor,execution_mode,source_asset_id,destination_asset_id,category_id,transfer_fee_minor,note,
  frequency,weekday,month_day,local_time,start_on,end_on`;
function ruleValues(item: RuleInput) { return [item.title,item.kind,item.amountMode,item.amountMinor ?? null,item.executionMode,item.sourceAssetId ?? null,
  item.destinationAssetId ?? null,item.categoryId ?? null,item.transferFeeMinor ?? null,item.note || null,item.frequency,item.weekday ?? null,
  item.monthDay ?? null,item.localTime,item.startOn,item.endOn ?? null]; }
async function replaceCharges(client: PoolClient, ruleId: string, charges: RuleInput["charges"]) {
  await client.query("DELETE FROM recurring_rule_charges WHERE rule_id=$1", [ruleId]);
  for (const [ordinal, charge] of (charges ?? []).entries()) await client.query(
    "INSERT INTO recurring_rule_charges(rule_id,ordinal,type_id,amount_minor) VALUES($1,$2,$3,$4)", [ruleId,ordinal,charge.typeId,charge.amountMinor]);
}
export async function saveRule(raw: RuleInput, id?: string, requestKey: string = randomUUID()): Promise<string> {
  await requireOwnerSession();
  const item = normalize(raw);
  assertUuid(requestKey);
  const hash = createHash("sha256").update(JSON.stringify({ id:id ?? null,item })).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[requestKey]);
    const prior = await client.query<{ request_hash: string; result_rule_id: string }>(
      "SELECT request_hash,result_rule_id FROM recurring_mutation_requests WHERE idempotency_key=$1",[requestKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== hash) throw new AutomationError("Kunci permintaan sudah dipakai untuk perubahan lain.");
      return prior.rows[0].result_rule_id;
    }
    await validateReferences(client, item);
    const values = ruleValues(item);
    let ruleId: string;
    if (!id) {
      ruleId = randomUUID();
      await client.query(`INSERT INTO recurring_transaction_rules(id,${ruleColumns},materialized_through) VALUES($1,${values.map((_, index) => `$${index + 2}`).join(",")},$18)`,
        [ruleId,...values,addDays(item.startOn,-1)]);
      await replaceCharges(client, ruleId, item.charges);
    } else {
      assertUuid(id);
      ruleId = id;
      const existing = await client.query<{ status: string }>("SELECT status FROM recurring_transaction_rules WHERE id=$1 FOR UPDATE", [id]);
      if (!existing.rows[0]) throw new AutomationError("Otomatisasi tidak ditemukan.");
      await client.query(`UPDATE recurring_transaction_rules SET ${ruleColumns.split(",").map((column,index) => `${column.trim()}=$${index + 2}`).join(",")},
        version=version+1,updated_at=now(),materialized_through=$18 WHERE id=$1`, [id,...values,addDays(jakartaToday(),-1)]);
      await client.query("DELETE FROM recurring_occurrence_charges WHERE occurrence_id IN (SELECT id FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='upcoming' AND scheduled_at>now())", [id]);
      await client.query("DELETE FROM recurring_transaction_occurrences WHERE rule_id=$1 AND status='upcoming' AND scheduled_at>now()", [id]);
      await replaceCharges(client,id,item.charges);
    }
    await client.query("INSERT INTO recurring_mutation_requests(idempotency_key,action,request_hash,result_rule_id) VALUES($1,'save_rule',$2,$3)",
      [requestKey,hash,ruleId]);
    return ruleId;
  });
}

export async function setRuleStatus(id: string, status: "active" | "paused" | "archived"): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  await inDatabaseTransaction(async (client) => {
    const row = await client.query<{ status: string }>("SELECT status FROM recurring_transaction_rules WHERE id=$1 FOR UPDATE", [id]);
    if (!row.rows[0]) throw new AutomationError("Otomatisasi tidak ditemukan.");
    if (status === "active" && row.rows[0].status !== "active") {
      await client.query("UPDATE recurring_transaction_occurrences SET status='skipped',skipped_at=now(),updated_at=now() WHERE rule_id=$1 AND status IN ('upcoming','due','pending_confirmation','failed') AND scheduled_at<now()", [id]);
      await client.query("UPDATE recurring_transaction_rules SET materialized_through=$2 WHERE id=$1", [id,addDays(jakartaToday(),-1)]);
    }
    await client.query("UPDATE recurring_transaction_rules SET status=$2,updated_at=now() WHERE id=$1", [id,status]);
  });
}

function scheduleFrom(row: Row): Schedule {
  return { frequency: row.frequency as Frequency, weekday: row.weekday as number | null, monthDay: row.month_day as number | null,
    localTime: String(row.local_time).slice(0,5), startOn: sqlDay(row.start_on), endOn: row.end_on ? sqlDay(row.end_on) : null };
}
function sqlDay(value: unknown): string { return value instanceof Date ? jakartaToday(value) : String(value).slice(0,10); }
async function materializeRule(client: PoolClient, rule: Row, now: Date) {
  const today = jakartaToday(now);
  const horizon = addDays(today,30);
  const start = addDays(sqlDay(rule.materialized_through),1);
  const end = addDays(start,maximumDailyScan-1) < horizon ? addDays(start,maximumDailyScan-1) : horizon;
  if (start > end) return;
  const schedule = scheduleFrom(rule);
  const charges = await client.query<{ ordinal: number; type_id: string; amount_minor: string }>(
    "SELECT ordinal,type_id,amount_minor::text FROM recurring_rule_charges WHERE rule_id=$1 ORDER BY ordinal", [rule.id]);
  for (let day = start; day <= end; day = addDays(day,1)) {
    if (!occursOn(schedule,day)) continue;
    const at = scheduledAt(day,schedule.localTime);
    const status = new Date(at) <= now ? (rule.execution_mode === "auto_post" ? "due" : "pending_confirmation") : "upcoming";
    const id = randomUUID();
    const inserted = await client.query(`INSERT INTO recurring_transaction_occurrences
      (id,rule_id,rule_version,scheduled_at,local_date,kind,amount_mode,amount_minor,execution_mode,source_asset_id,destination_asset_id,category_id,transfer_fee_minor,note,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT(rule_id,scheduled_at) DO NOTHING RETURNING id`, [id,rule.id,rule.version,at,day,rule.kind,rule.amount_mode,rule.amount_minor,
      rule.execution_mode,rule.source_asset_id,rule.destination_asset_id,rule.category_id,rule.transfer_fee_minor,rule.note,status]);
    if (inserted.rowCount) for (const charge of charges.rows) await client.query(
      "INSERT INTO recurring_occurrence_charges(occurrence_id,ordinal,type_id,amount_minor) VALUES($1,$2,$3,$4)",
      [id,charge.ordinal,charge.type_id,charge.amount_minor]);
  }
  await client.query("UPDATE recurring_transaction_rules SET materialized_through=$2 WHERE id=$1", [rule.id,end]);
}

export async function reconcileAutomation(now = new Date()): Promise<{ ready: boolean; processed: number }> {
  await requireOwnerSession();
  const available = await database().query<{ ready: boolean }>("SELECT to_regclass('recurring_transaction_rules') IS NOT NULL AS ready");
  if (!available.rows[0].ready) return { ready: false, processed: 0 };
  // The rule lock serializes materialization across concurrent app requests.
  const ruleIds = await database().query<{ id: string }>("SELECT id FROM recurring_transaction_rules WHERE status='active' ORDER BY materialized_through,created_at LIMIT 20");
  for (const { id } of ruleIds.rows) await inDatabaseTransaction(async (client) => {
    const locked = await client.query<Row>("SELECT * FROM recurring_transaction_rules WHERE id=$1 FOR UPDATE", [id]);
    if (locked.rows[0]?.status === "active") await materializeRule(client,locked.rows[0],now);
  });
  await database().query(`UPDATE recurring_transaction_occurrences o SET status=CASE WHEN o.execution_mode='auto_post' THEN 'due' ELSE 'pending_confirmation' END,updated_at=now()
    FROM recurring_transaction_rules r WHERE o.rule_id=r.id AND r.status='active' AND o.status='upcoming' AND o.scheduled_at<=$1`, [now]);
  const due = await database().query<{ id: string }>(`SELECT o.id FROM recurring_transaction_occurrences o JOIN recurring_transaction_rules r ON r.id=o.rule_id
    WHERE r.status='active' AND o.status='due' AND o.scheduled_at<=$1 ORDER BY o.scheduled_at,o.id LIMIT $2`, [now,maximumPostsPerVisit]);
  for (const { id } of due.rows) await processOccurrence(id,undefined,true);
  return { ready: true, processed: due.rows.length };
}

function draftFrom(row: Row, charges: { type_id: string; amount_minor: string }[], amount?: string): ActivityDraft {
  return { kind: row.kind as ActivityKind, amountMinor: amount ?? String(row.amount_minor),
    sourceAssetId: row.source_asset_id as string | undefined, destinationAssetId: row.destination_asset_id as string | undefined,
    categoryId: row.category_id as string | undefined, charges: row.kind === "expense" ? charges.map((c) => ({ typeId:c.type_id,amountMinor:c.amount_minor })) : undefined,
    transferFeeMinor: row.transfer_fee_minor as string | undefined, note: row.note as string | undefined,
    occurredAt: (row.scheduled_at as Date).toISOString() };
}
export async function processOccurrence(id: string, rawAmount?: string, automatic = false): Promise<string> {
  await requireOwnerSession(); assertUuid(id);
  const result = await inDatabaseTransaction(async (client) => {
    const identity = await client.query<{ rule_id: string }>("SELECT rule_id FROM recurring_transaction_occurrences WHERE id=$1", [id]);
    if (!identity.rows[0]) throw new AutomationError("Jadwal tidak ditemukan.");
    await client.query("SELECT status FROM recurring_transaction_rules WHERE id=$1 FOR SHARE", [identity.rows[0].rule_id]);
    const found = await client.query<Row>(`SELECT o.*,r.status AS rule_status FROM recurring_transaction_occurrences o
      JOIN recurring_transaction_rules r ON r.id=o.rule_id WHERE o.id=$1 FOR UPDATE OF o`, [id]);
    const row = found.rows[0];
    if (!row) throw new AutomationError("Jadwal tidak ditemukan.");
    if (row.activity_id) return String(row.activity_id);
    if (row.rule_status !== "active" || !["due","pending_confirmation","failed"].includes(String(row.status))) throw new AutomationError("Jadwal ini belum dapat dicatat.");
    if ((row.scheduled_at as Date) > new Date()) throw new AutomationError("Jadwal belum jatuh tempo.");
    if (automatic && (row.execution_mode !== "auto_post" || row.amount_mode !== "fixed")) throw new AutomationError("Jadwal memerlukan konfirmasi.");
    const amount = row.amount_mode === "confirm_amount" ? (row.amount_minor ? String(row.amount_minor) : positive(rawAmount)) : String(row.amount_minor);
    if (row.amount_mode === "confirm_amount" && !row.amount_minor) await client.query(
      "UPDATE recurring_transaction_occurrences SET amount_minor=$2 WHERE id=$1", [id,amount]);
    await client.query("UPDATE recurring_transaction_occurrences SET attempted_at=now(),updated_at=now() WHERE id=$1",[id]);
    const charges = await client.query<{ type_id: string; amount_minor: string }>(
      "SELECT type_id,amount_minor::text FROM recurring_occurrence_charges WHERE occurrence_id=$1 ORDER BY ordinal", [id]);
    await client.query("SAVEPOINT process_occurrence_post");
    try {
      // Shares the enclosing transaction via SAVEPOINT so locks and ledger postings commit atomically without nested pool connections.
      const activityId = await postActivityInTransaction(client, draftFrom(row, charges.rows, amount), id);
      await client.query("RELEASE SAVEPOINT process_occurrence_post");
      await client.query("UPDATE recurring_transaction_occurrences SET status='posted',activity_id=$2,amount_minor=$3,posted_at=now(),failure_reason=NULL,updated_at=now() WHERE id=$1", [id,activityId,amount]);
      return activityId;
    } catch (error) {
      // Roll back only the failed P3 attempt while keeping the occurrence row lock and recording the failure audit.
      await client.query("ROLLBACK TO SAVEPOINT process_occurrence_post");
      await client.query("RELEASE SAVEPOINT process_occurrence_post");
      await client.query("UPDATE recurring_transaction_occurrences SET status='failed',failure_reason=$2,updated_at=now() WHERE id=$1", [id,genericFailure]);
      void error;
      return "";
    }
  });
  if (!result && !automatic) throw new AutomationError(genericFailure);
  return result;
}
export async function skipOccurrence(id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  const changed = await database().query("UPDATE recurring_transaction_occurrences SET status='skipped',skipped_at=now(),updated_at=now() WHERE id=$1 AND status IN ('upcoming','due','pending_confirmation','failed') RETURNING id", [id]);
  if (!changed.rowCount) {
    const current = await database().query<{ status: string }>("SELECT status FROM recurring_transaction_occurrences WHERE id=$1",[id]);
    if (current.rows[0]?.status !== "skipped") throw new AutomationError("Jadwal ini tidak dapat dilewati.");
  }
}
export async function voidOccurrence(id: string): Promise<void> {
  await requireOwnerSession(); assertUuid(id);
  await inDatabaseTransaction(async (client) => {
    const found = await client.query<{ activity_id: string; status: string }>("SELECT activity_id,status FROM recurring_transaction_occurrences WHERE id=$1 FOR UPDATE", [id]);
    if (found.rows[0]?.status === "voided") return;
    if (!found.rows[0] || found.rows[0].status !== "posted") throw new AutomationError("Transaksi ini tidak aktif.");
    const rootId = found.rows[0].activity_id;
    const chain = await client.query<{ id: string; status: string }>(`WITH RECURSIVE chain AS (
      SELECT id,status,0 AS depth FROM financial_activities WHERE id=$1
      UNION ALL SELECT f.id,f.status,chain.depth+1 FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE chain.depth<30)
      SELECT id,status FROM chain ORDER BY depth DESC LIMIT 1`, [rootId]);
    if (chain.rows[0]?.status !== "posted") throw new AutomationError("Transaksi ini sudah dibatalkan.");
    const digest = createHash("sha256").update(`recurring-void:${id}:${chain.rows[0].id}`).digest("hex");
    const key = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
    await voidActivityInTransaction(client, chain.rows[0].id, key);
    await client.query("UPDATE recurring_transaction_occurrences SET status='voided',updated_at=now() WHERE id=$1", [id]);
  });
}

export type AutomationView = { rules: Row[]; occurrences: Row[]; ready: boolean };
export async function readAutomation(historyIds?: string[]): Promise<AutomationView> {
  await requireOwnerSession();
  const ready = (await database().query<{ ready: boolean }>("SELECT to_regclass('recurring_transaction_rules') IS NOT NULL AS ready")).rows[0].ready;
  if (!ready) return { rules: [], occurrences: [], ready: false };
  const occurrenceSelect = `SELECT o.*,r.title AS rule_title,COALESCE(s.currency_code,d.currency_code) AS currency_code,c.minor_unit_exponent AS exponent,
      CASE WHEN o.activity_id IS NOT NULL THEN
        (WITH RECURSIVE chain AS (SELECT id,status,0 AS depth FROM financial_activities WHERE id=o.activity_id
          UNION ALL SELECT f.id,f.status,chain.depth+1 FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE chain.depth<30)
          SELECT status FROM chain ORDER BY depth DESC LIMIT 1) ELSE NULL END AS latest_activity_status
      FROM recurring_transaction_occurrences o JOIN recurring_transaction_rules r ON r.id=o.rule_id
      LEFT JOIN assets s ON s.id=o.source_asset_id LEFT JOIN assets d ON d.id=o.destination_asset_id
      JOIN currencies c ON c.code=COALESCE(s.currency_code,d.currency_code)`;
  const [rules,current,history] = await Promise.all([
    database().query<Row>(`SELECT r.*,s.display_name AS source_name,d.display_name AS destination_name,
      COALESCE(s.currency_code,d.currency_code) AS currency_code,c.minor_unit_exponent AS exponent,
      COALESCE(json_agg(json_build_object('typeId',rc.type_id,'amountMinor',rc.amount_minor::text) ORDER BY rc.ordinal)
        FILTER (WHERE rc.type_id IS NOT NULL),'[]'::json) AS charges
      FROM recurring_transaction_rules r LEFT JOIN assets s ON s.id=r.source_asset_id LEFT JOIN assets d ON d.id=r.destination_asset_id
      JOIN currencies c ON c.code=COALESCE(s.currency_code,d.currency_code)
      LEFT JOIN recurring_rule_charges rc ON rc.rule_id=r.id GROUP BY r.id,s.display_name,d.display_name,s.currency_code,d.currency_code,c.minor_unit_exponent ORDER BY r.created_at DESC,r.id DESC`),
    database().query<Row>(`${occurrenceSelect} WHERE r.status='active' AND o.status IN ('upcoming','due','pending_confirmation','failed')
      ORDER BY CASE WHEN o.status IN ('due','pending_confirmation','failed') THEN 0 ELSE 1 END,
        CASE WHEN o.status='upcoming' THEN o.scheduled_at END ASC,o.scheduled_at DESC,
        CASE WHEN o.status='upcoming' THEN o.id END ASC,o.id DESC`),
    database().query<Row>(`${occurrenceSelect} WHERE o.status IN ('posted','skipped','voided','superseded') AND ($1::uuid[] IS NULL OR o.id=ANY($1::uuid[]))
      ORDER BY o.scheduled_at DESC,o.id DESC`,[historyIds??null]),
  ]);
  const reviews=await readAutomationReviewContexts("schedule",[...current.rows,...history.rows].map(row=>String(row.id)));
  return { rules: rules.rows.map((row) => ({...row,start_on:sqlDay(row.start_on),end_on:row.end_on ? sqlDay(row.end_on) : null,
    materialized_through:sqlDay(row.materialized_through)})),
    occurrences: [...current.rows,...history.rows].map((row) => ({...row,review:reviews[String(row.id)],scheduled_at:(row.scheduled_at as Date).toISOString(),
      local_date:sqlDay(row.local_date)})), ready: true };
}
