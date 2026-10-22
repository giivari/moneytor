import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import type { PlanKind, ObligationStatus, ReservePurpose } from "@/lib/domain/planning";

export class PlanningError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
export type PlanningLabel = { id: string; kind: PlanKind; displayName: string; isBuiltIn: boolean; isActive: boolean };
type Common = { id: string; labelId: string; labelName: string; title: string; currency: string; exponent: number;
  note: string | null; version: number; createdAt: string; updatedAt: string };
export type PlanningBudget = Common & { kind: "budget"; limitMinor: string; periodStart: string; periodEnd: string;
  categoryId: string | null; categoryName: string | null; spentMinor: string; isActive: boolean; archivedAt: string | null };
export type PlanningGoal = Common & { kind: "goal"; targetMinor: string; targetOn: string | null;
  progressMinor: string; isActive: boolean; archivedAt: string | null };
export type PlanningReserve = Common & { kind: "reserve"; amountMinor: string; purpose: ReservePurpose;
  sourceAssetId: string | null; sourceAssetName: string | null; goalId: string | null; goalName: string | null;
  obligationId: string | null; obligationName: string | null; isActive: boolean; releasedAt: string | null };
export type PlanningObligation = Common & { kind: "obligation"; amountMinor: string; dueOn: string;
  status: ObligationStatus; settledAt: string | null; cancelledAt: string | null;
  coveredMinor: string; uncoveredMinor: string };
export type PlanningItem = PlanningBudget | PlanningGoal | PlanningReserve | PlanningObligation;
export type PlanningData = { ready: boolean; budgets: PlanningBudget[]; goals: PlanningGoal[];
  reserves: PlanningReserve[]; obligations: PlanningObligation[]; labels: PlanningLabel[];
  currencies: { code: string; exponent: number }[]; categories: { id: string; name: string }[] };
export type PlanningAggregate = { currency: string; reservedMinor: string; dueMinor: string;
  coveredMinor: string; uncoveredMinor: string };

const kinds = new Set<PlanKind>(["budget", "goal", "reserve", "obligation"]);
const purposes = new Set<ReservePurpose>(["general", "emergency", "restricted", "goal", "obligation"]);
function value(body: Record<string, unknown>, key: string, max = 120) {
  const raw = body[key];
  if (typeof raw !== "string" || raw.length > max) throw new PlanningError("Data rencana tidak valid.");
  return raw;
}
function optional(body: Record<string, unknown>, key: string, max = 120) {
  const raw = body[key];
  return raw === null || raw === undefined || raw === "" ? null : value(body,key,max);
}
function title(body: Record<string, unknown>) {
  const name = value(body,"title").trim();
  if (!name) throw new PlanningError("Nama rencana harus diisi.");
  return name;
}
function uuid(raw: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) throw new PlanningError("Pilihan tidak valid.");
  return raw;
}
function amount(body: Record<string, unknown>, key: string) {
  try { const parsed = assertStoredMinor(parseMinor(value(body,key,25))); if (parsed > 0n) return parsed.toString(); }
  catch { /* convert parser errors into owner-facing validation */ }
  throw new PlanningError("Jumlah harus lebih besar dari nol.");
}
function day(body: Record<string, unknown>, key: string, required = true) {
  const raw = optional(body,key,10);
  if (!raw) { if (required) throw new PlanningError("Tanggal harus diisi."); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new PlanningError("Tanggal tidak valid.");
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== raw) throw new PlanningError("Tanggal tidak valid.");
  return raw;
}
function version(body: Record<string, unknown>) {
  const raw = body.version;
  if (!Number.isSafeInteger(raw) || (raw as number) < 1) throw new PlanningError("Versi rencana tidak valid.");
  return raw as number;
}
function kind(value: string): PlanKind {
  if (!kinds.has(value as PlanKind)) throw new PlanningError("Jenis rencana tidak valid.");
  return value as PlanKind;
}
function signature(action: string, body: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify([action, Object.keys(body).sort().map((key) => [key,body[key]])])).digest("hex");
}
async function currencyActive(client: PoolClient, code: string) {
  if (!/^[A-Z]{3}$/.test(code) || !(await client.query("SELECT 1 FROM currencies WHERE code=$1 AND is_active",[code])).rowCount) {
    throw new PlanningError("Mata uang tidak tersedia.");
  }
}
async function labelAvailable(client: PoolClient, id: string, planKind: PlanKind, currentId?: string) {
  const result = await client.query("SELECT 1 FROM planning_labels WHERE id=$1 AND kind=$2 AND (is_active OR id=$3)",
    [uuid(id),planKind,currentId ?? null]);
  if (!result.rowCount) throw new PlanningError("Jenis rencana tidak tersedia.");
}
async function locked(client: PoolClient, table: string, id: string, expected: number) {
  const result = await client.query<{ version: number; currency: string; labelId: string; status?: ObligationStatus; categoryId?: string | null }>(
    `SELECT version,currency_code AS currency,label_id AS "labelId",${table === "planning_obligations" ? "status" : "NULL::text AS status"},${table === "planning_budgets" ? "category_id AS \"categoryId\"" : "NULL::uuid AS \"categoryId\""} FROM ${table} WHERE id=$1 FOR UPDATE`, [uuid(id)]);
  const row = result.rows[0];
  if (!row) throw new PlanningError("Rencana tidak ditemukan.",404);
  if (row.version !== expected) throw new PlanningError("Rencana ini sudah berubah. Muat ulang lalu coba lagi.",409);
  return row;
}
async function commonDraft(client: PoolClient, body: Record<string, unknown>, planKind: PlanKind,
  existing?: { currency: string; labelId: string }) {
  const currency = value(body,"currency",3);
  if (existing && existing.currency !== currency) throw new PlanningError("Mata uang rencana tidak dapat diubah.");
  await currencyActive(client,currency);
  const labelId = uuid(value(body,"labelId",36));
  await labelAvailable(client,labelId,planKind,existing?.labelId);
  return { title: title(body), currency, labelId, note: optional(body,"note",500)?.trim() || null };
}
function tableFor(planKind: PlanKind) { return `planning_${planKind === "budget" ? "budgets" : planKind === "goal" ? "goals" : planKind === "reserve" ? "reserves" : "obligations"}`; }

async function savePlan(client: PoolClient, planKind: PlanKind, body: Record<string, unknown>) {
  const id = optional(body,"id",36);
  const existing = id ? await locked(client,tableFor(planKind),id,version(body)) : undefined;
  if (planKind === "obligation" && existing?.status !== undefined && existing.status !== "open") {
    throw new PlanningError("Buka kembali kewajiban sebelum mengubah nominal atau tanggalnya.");
  }
  const base = await commonDraft(client,body,planKind,existing);
  const planId = id ?? randomUUID();
  const parameters: unknown[] = [planId,base.labelId,base.title,base.currency,base.note];
  let columns: string[], extras: unknown[];
  if (planKind === "budget") {
    const start = day(body,"periodStart")!, end = day(body,"periodEnd")!;
    if (end <= start) throw new PlanningError("Akhir periode harus setelah awal periode.");
    const categoryId = optional(body,"categoryId",36);
    if (categoryId && !(await client.query("SELECT 1 FROM transaction_categories WHERE id=$1 AND applies_to='expense' AND (is_active OR id=$2)",
      [uuid(categoryId),existing?.categoryId ?? null])).rowCount) throw new PlanningError("Kategori pengeluaran tidak tersedia.");
    columns = ["limit_minor","period_start","period_end","category_id"];
    extras = [amount(body,"limitMinor"),start,end,categoryId];
  } else if (planKind === "goal") {
    columns = ["target_minor","target_on"]; extras = [amount(body,"targetMinor"),day(body,"targetOn",false)];
  } else if (planKind === "obligation") {
    columns = ["amount_minor","due_on"]; extras = [amount(body,"amountMinor"),day(body,"dueOn")];
  } else {
    const purpose = value(body,"purpose",20) as ReservePurpose;
    if (!purposes.has(purpose)) throw new PlanningError("Tujuan cadangan tidak valid.");
    const source = optional(body,"sourceAssetId",36), goal = optional(body,"goalId",36), obligation = optional(body,"obligationId",36);
    if ((purpose === "goal") !== !!goal || (purpose === "obligation") !== !!obligation || (goal && obligation)) {
      throw new PlanningError("Hubungan cadangan tidak sesuai tujuannya.");
    }
    if (source) {
      const asset = await client.query<{ currency: string; active: boolean; liquid: boolean; spendable: boolean }>(
        "SELECT currency_code AS currency,is_active AS active,normally_liquid AS liquid,normally_spendable AS spendable FROM assets WHERE id=$1 FOR SHARE",[uuid(source)]);
      if (!asset.rows[0] || asset.rows[0].currency !== base.currency || !asset.rows[0].active || !asset.rows[0].liquid || !asset.rows[0].spendable) {
        throw new PlanningError("Pilih aset aktif yang dapat digunakan dalam mata uang yang sama.");
      }
    }
    if (goal) {
      const linked = await client.query<{ currency: string; active: boolean }>("SELECT currency_code AS currency,is_active AS active FROM planning_goals WHERE id=$1 FOR SHARE",[uuid(goal)]);
      if (!linked.rows[0] || linked.rows[0].currency !== base.currency || !linked.rows[0].active) throw new PlanningError("Target aktif dalam mata uang yang sama diperlukan.");
    }
    if (obligation) {
      const linked = await client.query<{ currency: string; status: ObligationStatus }>("SELECT currency_code AS currency,status FROM planning_obligations WHERE id=$1 FOR SHARE",[uuid(obligation)]);
      if (!linked.rows[0] || linked.rows[0].currency !== base.currency || linked.rows[0].status !== "open") throw new PlanningError("Kewajiban terbuka dalam mata uang yang sama diperlukan.");
    }
    columns = ["amount_minor","purpose","source_asset_id","goal_id","obligation_id"];
    extras = [amount(body,"amountMinor"),purpose,source,goal,obligation];
  }
  const table = tableFor(planKind);
  if (id) {
    const fields = [...columns,"label_id","title","note"], values = [...extras,base.labelId,base.title,base.note];
    await client.query(`UPDATE ${table} SET ${fields.map((field,index) => `${field}=$${index+2}`).join(",")},version=version+1,updated_at=now() WHERE id=$1`,[id,...values]);
  } else {
    const fields = ["id","label_id","title","currency_code","note",...columns];
    await client.query(`INSERT INTO ${table}(${fields.join(",")}) VALUES (${fields.map((_,index) => `$${index+1}`).join(",")})`,[...parameters,...extras]);
  }
  return planId;
}

async function changePlan(client: PoolClient, action: string, body: Record<string, unknown>) {
  const planKind = kind(value(body,"kind",20));
  const id = uuid(value(body,"id",36));
  const row = await locked(client,tableFor(planKind),id,version(body));
  if (action === "archive" || action === "restore") {
    if (planKind === "obligation") throw new PlanningError("Kewajiban menggunakan status selesai atau batal.");
    const table = tableFor(planKind), column = planKind === "reserve" ? "released_at" : "archived_at";
    await client.query(`UPDATE ${table} SET is_active=$2,${column}=CASE WHEN $2 THEN ${column} ELSE now() END,version=version+1,updated_at=now() WHERE id=$1`,[id,action === "restore"]);
    return id;
  }
  if (planKind !== "obligation") throw new PlanningError("Status ini hanya untuk kewajiban.");
  if (action === "reopen" && row.status === "open") throw new PlanningError("Kewajiban sudah terbuka.");
  if ((action === "settle" || action === "cancel") && row.status !== "open") throw new PlanningError("Buka kembali kewajiban sebelum mengubah statusnya.");
  const status = action === "settle" ? "settled" : action === "cancel" ? "cancelled" : "open";
  await client.query(`UPDATE planning_obligations SET status=$2,
    settled_at=CASE WHEN $2='settled' THEN now() ELSE settled_at END,
    cancelled_at=CASE WHEN $2='cancelled' THEN now() ELSE cancelled_at END,
    version=version+1,updated_at=now() WHERE id=$1`,[id,status]);
  return id;
}
async function changeLabel(client: PoolClient, action: string, body: Record<string, unknown>) {
  const id = optional(body,"id",36);
  if (action === "label-save") {
    const planKind = kind(value(body,"kind",20));
    const name = value(body,"displayName").trim();
    if (!name) throw new PlanningError("Nama jenis harus diisi.");
    if (!id) {
      const newId = randomUUID();
      await client.query("INSERT INTO planning_labels(id,kind,display_name) VALUES($1,$2,$3)",[newId,planKind,name]);
      return newId;
    }
    const updated = await client.query("UPDATE planning_labels SET display_name=$2 WHERE id=$1 AND kind=$3 AND system_key IS NULL",[uuid(id),name,planKind]);
    if (!updated.rowCount) throw new PlanningError("Jenis bawaan tidak dapat diubah.");
    return id;
  }
  if (!id) throw new PlanningError("Jenis tidak valid.");
  const updated = await client.query("UPDATE planning_labels SET is_active=$2 WHERE id=$1 AND system_key IS NULL",[uuid(id),action === "label-restore"]);
  if (!updated.rowCount) throw new PlanningError("Jenis bawaan tidak dapat diubah.");
  return id;
}
const actions = new Set(["save-budget","save-goal","save-reserve","save-obligation","archive","restore","settle","cancel","reopen","label-save","label-archive","label-restore"]);
export async function mutatePlanning(action: string, body: Record<string, unknown>, idempotencyKey: string) {
  await requireOwnerSession();
  if (!actions.has(action)) throw new PlanningError("Aksi tidak tersedia.",404);
  const key = uuid(idempotencyKey), hash = signature(action,body);
  return inDatabaseTransaction(async (client) => {
    await client.query(`INSERT INTO planning_mutation_requests(idempotency_key,operation,request_hash) VALUES($1,$2,$3)
      ON CONFLICT (idempotency_key) DO NOTHING`,[key,action,hash]);
    const request = (await client.query<{ operation: string; request_hash: string; completed: boolean; result_id: string | null }>(
      "SELECT operation,request_hash,completed,result_id FROM planning_mutation_requests WHERE idempotency_key=$1 FOR UPDATE",[key])).rows[0];
    if (request.operation !== action || request.request_hash !== hash) throw new PlanningError("Kunci permintaan sudah digunakan untuk perubahan lain.",409);
    if (request.completed) return request.result_id;
    let result: string;
    if (action.startsWith("save-")) result = await savePlan(client,kind(action.slice(5)),body);
    else if (action.startsWith("label-")) result = await changeLabel(client,action,body);
    else result = await changePlan(client,action,body);
    await client.query("UPDATE planning_mutation_requests SET completed=true,result_id=$2 WHERE idempotency_key=$1",[key,result]);
    return result;
  });
}

export async function planningSchemaReady(client?: PoolClient) {
  const result = await (client ?? database()).query<{ ready: boolean }>(`SELECT to_regclass('planning_budgets') IS NOT NULL
    AND to_regclass('planning_goals') IS NOT NULL AND to_regclass('planning_reserves') IS NOT NULL
    AND to_regclass('planning_obligations') IS NOT NULL AS ready`);
  return result.rows[0].ready;
}
export async function readPlanningSummary(client: PoolClient, throughDay: string): Promise<Map<string, PlanningAggregate>> {
  const result = await client.query<PlanningAggregate>(`
    WITH reserved AS (
      SELECT currency_code,sum(amount_minor)::numeric AS amount FROM planning_reserves WHERE is_active GROUP BY currency_code
    ), linked AS (
      SELECT obligation_id,sum(amount_minor)::numeric AS amount FROM planning_reserves
      WHERE is_active AND obligation_id IS NOT NULL GROUP BY obligation_id
    ), due AS (
      SELECT o.currency_code,sum(o.amount_minor)::numeric AS total,
        sum(LEAST(o.amount_minor::numeric,COALESCE(linked.amount,0))) AS covered
      FROM planning_obligations o LEFT JOIN linked ON linked.obligation_id=o.id
      WHERE o.status='open' AND o.due_on <= $1::date GROUP BY o.currency_code
    )
    SELECT c.code AS currency,COALESCE(r.amount,0)::text AS "reservedMinor",
      COALESCE(d.total,0)::text AS "dueMinor",COALESCE(d.covered,0)::text AS "coveredMinor",
      (COALESCE(d.total,0)-COALESCE(d.covered,0))::text AS "uncoveredMinor"
    FROM currencies c LEFT JOIN reserved r ON r.currency_code=c.code LEFT JOIN due d ON d.currency_code=c.code
    WHERE r.currency_code IS NOT NULL OR d.currency_code IS NOT NULL`,[throughDay]);
  return new Map(result.rows.map((row) => [row.currency,row]));
}

export async function listPlanning(): Promise<PlanningData> {
  await requireOwnerSession();
  const empty: PlanningData = { ready: false,budgets: [],goals: [],reserves: [],obligations: [],labels: [],currencies: [],categories: [] };
  if (!await planningSchemaReady()) return empty;
  return inDatabaseTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const budgets = await client.query<PlanningBudget>(`SELECT b.id,'budget' AS kind,b.label_id AS "labelId",l.display_name AS "labelName",b.title,b.currency_code AS currency,
      c.minor_unit_exponent AS exponent,b.limit_minor::text AS "limitMinor",b.period_start::text AS "periodStart",b.period_end::text AS "periodEnd",
      b.category_id AS "categoryId",tc.display_name AS "categoryName",b.note,b.is_active AS "isActive",b.archived_at::text AS "archivedAt",
      b.version,b.created_at::text AS "createdAt",b.updated_at::text AS "updatedAt",
      COALESCE((SELECT sum((CASE WHEN a.kind='expense' THEN a.base_amount_minor ELSE 0 END)
        + COALESCE((SELECT sum(ac.amount_minor) FROM activity_charges ac WHERE ac.activity_id=a.id),0))
        FROM financial_activities a WHERE a.status='posted' AND a.currency_code=b.currency_code
          AND a.occurred_at >= (b.period_start::timestamp AT TIME ZONE 'Asia/Jakarta')
          AND a.occurred_at < (b.period_end::timestamp AT TIME ZONE 'Asia/Jakarta')
          AND ((a.kind='expense' AND (b.category_id IS NULL OR a.category_id=b.category_id))
            OR (b.category_id IS NULL AND a.kind='transfer'))),0)::text AS "spentMinor"
      FROM planning_budgets b JOIN planning_labels l ON l.id=b.label_id JOIN currencies c ON c.code=b.currency_code
      LEFT JOIN transaction_categories tc ON tc.id=b.category_id ORDER BY b.is_active DESC,b.created_at DESC,b.id DESC`);
    const goals = await client.query<PlanningGoal>(`SELECT g.id,'goal' AS kind,g.label_id AS "labelId",l.display_name AS "labelName",g.title,g.currency_code AS currency,
      c.minor_unit_exponent AS exponent,g.target_minor::text AS "targetMinor",g.target_on::text AS "targetOn",g.note,
      g.is_active AS "isActive",g.archived_at::text AS "archivedAt",g.version,g.created_at::text AS "createdAt",g.updated_at::text AS "updatedAt",
      COALESCE((SELECT sum(r.amount_minor) FROM planning_reserves r WHERE r.goal_id=g.id AND r.is_active),0)::text AS "progressMinor"
      FROM planning_goals g JOIN planning_labels l ON l.id=g.label_id JOIN currencies c ON c.code=g.currency_code
      ORDER BY g.is_active DESC,g.created_at DESC,g.id DESC`);
    const reserves = await client.query<PlanningReserve>(`SELECT r.id,'reserve' AS kind,r.label_id AS "labelId",l.display_name AS "labelName",r.title,r.currency_code AS currency,
      c.minor_unit_exponent AS exponent,r.amount_minor::text AS "amountMinor",r.purpose,r.source_asset_id AS "sourceAssetId",
      a.display_name AS "sourceAssetName",r.goal_id AS "goalId",g.title AS "goalName",r.obligation_id AS "obligationId",o.title AS "obligationName",
      r.note,r.is_active AS "isActive",r.released_at::text AS "releasedAt",r.version,r.created_at::text AS "createdAt",r.updated_at::text AS "updatedAt"
      FROM planning_reserves r JOIN planning_labels l ON l.id=r.label_id JOIN currencies c ON c.code=r.currency_code
      LEFT JOIN assets a ON a.id=r.source_asset_id LEFT JOIN planning_goals g ON g.id=r.goal_id
      LEFT JOIN planning_obligations o ON o.id=r.obligation_id ORDER BY r.is_active DESC,r.created_at DESC,r.id DESC`);
    const obligations = await client.query<PlanningObligation>(`SELECT o.id,'obligation' AS kind,o.label_id AS "labelId",l.display_name AS "labelName",o.title,o.currency_code AS currency,
      c.minor_unit_exponent AS exponent,o.amount_minor::text AS "amountMinor",o.due_on::text AS "dueOn",o.status,
      o.settled_at::text AS "settledAt",o.cancelled_at::text AS "cancelledAt",o.note,o.version,o.created_at::text AS "createdAt",o.updated_at::text AS "updatedAt",
      LEAST(o.amount_minor::numeric,COALESCE((SELECT sum(r.amount_minor) FROM planning_reserves r WHERE r.obligation_id=o.id AND r.is_active),0))::text AS "coveredMinor",
      GREATEST(o.amount_minor::numeric-COALESCE((SELECT sum(r.amount_minor) FROM planning_reserves r WHERE r.obligation_id=o.id AND r.is_active),0),0)::text AS "uncoveredMinor"
      FROM planning_obligations o JOIN planning_labels l ON l.id=o.label_id JOIN currencies c ON c.code=o.currency_code
      ORDER BY (o.status='open') DESC,o.due_on,o.id`);
    const labels = await client.query<PlanningLabel>(`SELECT id,kind,display_name AS "displayName",system_key IS NOT NULL AS "isBuiltIn",is_active AS "isActive"
      FROM planning_labels ORDER BY kind,is_active DESC,system_key NULLS LAST,display_name,id`);
    const currencies = await client.query<{ code: string; exponent: number }>("SELECT code,minor_unit_exponent AS exponent FROM currencies WHERE is_active ORDER BY code");
    const categories = await client.query<{ id: string; name: string }>("SELECT id,display_name AS name FROM transaction_categories WHERE applies_to='expense' AND is_active ORDER BY display_name");
    return { ready: true,budgets: budgets.rows,goals: goals.rows,reserves: reserves.rows,obligations: obligations.rows,
      labels: labels.rows,currencies: currencies.rows,categories: categories.rows };
  });
}
