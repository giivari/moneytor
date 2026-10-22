import "server-only";
import { allocationDiscoveryFilter, readAllocationSummaries } from "./allocation-service";
import { readAutomationReviewContexts } from "./review-service";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { assertUuid } from "@/lib/domain/catalog";
import { assertStoredMinor, parseMinor } from "@/lib/domain/money";
import { postActivityInTransaction } from "@/lib/finance/service";
import { percentageOfIncome } from "./percentage";

export type IncomeEventRuleInput = {
  title: string; percentageBps: number; outputKind: "expense" | "transfer";
  destinationAssetId?: string; categoryId?: string; transferFeeMinor?: string;
  charges?: { typeId: string; amountMinor: string }[]; note?: string;
};
type Source = { id: string; kind: string; status: string; base_amount_minor: string; currency_code: string;
  destination_asset_id: string | null; occurred_at: Date };
type Candidate = { root_activity_id: string; rule_id: string; version_no: number; title: string;
  percentage_bps: number; output_kind: "expense" | "transfer"; destination_asset_id: string | null;
  category_id: string | null; transfer_fee_minor: string | null; charges: { typeId: string; amountMinor: string }[]; note: string | null };
type Instance = Candidate & { id: string; effective_activity_id: string; source_asset_id: string; source_currency: string;
  source_amount_minor: string; source_occurred_at: Date; proposed_amount_minor: string | null; status: string;
  result_activity_id: string | null };
export class IncomeEventError extends Error {}
const sourceOrderLock = "moneytor_income_event_order";
const postingFailure = "Tindakan belum dapat dicatat. Periksa aset, kategori, dan biaya, lalu coba lagi.";

function positive(value: unknown): string {
  if (typeof value !== "string") throw new IncomeEventError("Nominal harus diisi dalam unit terkecil.");
  const amount = assertStoredMinor(parseMinor(value));
  if (amount <= 0n) throw new IncomeEventError("Nominal harus lebih dari nol.");
  return amount.toString();
}
function normalize(raw: IncomeEventRuleInput): IncomeEventRuleInput {
  if (!raw || typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 120) throw new IncomeEventError("Nama aturan harus 1–120 karakter.");
  if (!Number.isInteger(raw.percentageBps) || raw.percentageBps < 1 || raw.percentageBps > 10000) throw new IncomeEventError("Persentase harus 1–10000 basis poin.");
  if (!["expense","transfer"].includes(raw.outputKind)) throw new IncomeEventError("Tindakan tidak valid.");
  const destinationAssetId = raw.destinationAssetId ? assertUuid(raw.destinationAssetId) : undefined;
  const categoryId = raw.categoryId ? assertUuid(raw.categoryId) : undefined;
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (note.length > 1000) throw new IncomeEventError("Catatan terlalu panjang.");
  if (!Array.isArray(raw.charges ?? []) || (raw.charges ?? []).length > 20) throw new IncomeEventError("Terlalu banyak biaya tambahan.");
  const charges = (raw.charges ?? []).map((charge) => ({ typeId: assertUuid(charge.typeId), amountMinor: positive(charge.amountMinor) }));
  if (raw.outputKind === "expense" && (destinationAssetId || raw.transferFeeMinor)) throw new IncomeEventError("Pengeluaran tidak memakai aset tujuan atau biaya transfer.");
  if (raw.outputKind === "transfer" && (!destinationAssetId || categoryId || charges.length)) throw new IncomeEventError("Transfer memerlukan aset tujuan tanpa kategori atau biaya tambahan.");
  return { title:raw.title.trim(), percentageBps:raw.percentageBps, outputKind:raw.outputKind,
    destinationAssetId, categoryId, transferFeeMinor:raw.outputKind === "transfer" && raw.transferFeeMinor && raw.transferFeeMinor !== "0" ? positive(raw.transferFeeMinor) : undefined,
    charges:raw.outputKind === "expense" ? charges : [], note };
}
async function validateTemplate(client: PoolClient, item: IncomeEventRuleInput) {
  if (item.destinationAssetId) {
    const asset = await client.query("SELECT id FROM assets WHERE id=$1 AND is_active FOR SHARE",[item.destinationAssetId]);
    if (!asset.rowCount) throw new IncomeEventError("Aset tujuan tidak aktif.");
  }
  if (item.categoryId) {
    const category = await client.query("SELECT id FROM transaction_categories WHERE id=$1 AND is_active AND applies_to='expense' FOR SHARE",[item.categoryId]);
    if (!category.rowCount) throw new IncomeEventError("Kategori pengeluaran tidak aktif.");
  }
  for (const charge of item.charges ?? []) {
    const type = await client.query("SELECT id FROM additional_charge_types WHERE id=$1 AND is_active FOR SHARE",[charge.typeId]);
    if (!type.rowCount) throw new IncomeEventError("Jenis biaya tidak aktif.");
  }
  if (item.transferFeeMinor) {
    const type = await client.query("SELECT id FROM additional_charge_types WHERE system_key='transfer_fee' AND is_active");
    if (!type.rowCount) throw new IncomeEventError("Biaya transfer tidak tersedia.");
  }
}
async function activePeriod(client: PoolClient, ruleId: string, version: number) {
  await client.query("INSERT INTO income_event_active_periods(id,rule_id,version_no,opened_at) VALUES($1,$2,$3,clock_timestamp())",[randomUUID(),ruleId,version]);
}
async function closePeriod(client: PoolClient, ruleId: string) {
  await client.query("UPDATE income_event_active_periods SET closed_at=clock_timestamp() WHERE rule_id=$1 AND closed_at IS NULL",[ruleId]);
}
export async function saveIncomeEventRule(raw: IncomeEventRuleInput, id?: string, requestKey: string = randomUUID()): Promise<string> {
  await requireOwnerSession();
  const item = normalize(raw), key = assertUuid(requestKey);
  const digest = createHash("sha256").update(JSON.stringify({id:id ?? null,item})).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[key]);
    const previous = await client.query<{request_hash:string;result_rule_id:string}>("SELECT request_hash,result_rule_id FROM income_event_rule_mutations WHERE idempotency_key=$1",[key]);
    if (previous.rows[0]) {
      if (previous.rows[0].request_hash !== digest) throw new IncomeEventError("Kunci permintaan dipakai untuk perubahan lain.");
      return previous.rows[0].result_rule_id;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[sourceOrderLock]);
    await validateTemplate(client,item);
    const ruleId = id ? assertUuid(id) : randomUUID();
    let version = 1, status = "active";
    if (id) {
      const old = await client.query<{version_no:number;status:string}>("SELECT version_no,status FROM income_event_rules WHERE id=$1 FOR UPDATE",[ruleId]);
      if (!old.rows[0]) throw new IncomeEventError("Aturan tidak ditemukan.");
      version = old.rows[0].version_no + 1; status = old.rows[0].status;
      if (status === "active") await closePeriod(client,ruleId);
      await client.query("UPDATE income_event_rules SET version_no=$2,updated_at=clock_timestamp() WHERE id=$1",[ruleId,version]);
    } else {
      await client.query("INSERT INTO income_event_rules(id) VALUES($1)",[ruleId]);
    }
    await client.query(`INSERT INTO income_event_rule_versions
      (rule_id,version_no,title,percentage_bps,output_kind,destination_asset_id,category_id,transfer_fee_minor,charges,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[ruleId,version,item.title,item.percentageBps,item.outputKind,
      item.destinationAssetId ?? null,item.categoryId ?? null,item.transferFeeMinor ?? null,JSON.stringify(item.charges ?? []),item.note || null]);
    if (status === "active") await activePeriod(client,ruleId,version);
    await client.query("INSERT INTO income_event_rule_mutations(idempotency_key,request_hash,result_rule_id) VALUES($1,$2,$3)",[key,digest,ruleId]);
    return ruleId;
  });
}
export async function setIncomeEventRuleStatus(id: string, status: "active" | "paused" | "archived") {
  await requireOwnerSession(); const ruleId = assertUuid(id);
  await inDatabaseTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[sourceOrderLock]);
    const found = await client.query<{status:string;version_no:number}>("SELECT status,version_no FROM income_event_rules WHERE id=$1 FOR UPDATE",[ruleId]);
    if (!found.rows[0]) throw new IncomeEventError("Aturan tidak ditemukan.");
    if (found.rows[0].status === status) return;
    if (found.rows[0].status === "active") await closePeriod(client,ruleId);
    if (status === "active") await activePeriod(client,ruleId,found.rows[0].version_no);
    await client.query("UPDATE income_event_rules SET status=$2,updated_at=clock_timestamp() WHERE id=$1",[ruleId,status]);
  });
}

/** Follow P3 replacement links to the current version of one logical Income. */
async function effectiveSource(client: PoolClient, rootId: string): Promise<Source> {
  const result = await client.query<Source>(`WITH RECURSIVE chain AS (
    SELECT id,kind,status,base_amount_minor,currency_code,destination_asset_id,occurred_at,0 AS depth
      FROM financial_activities WHERE id=$1
    UNION ALL
    SELECT f.id,f.kind,f.status,f.base_amount_minor,f.currency_code,f.destination_asset_id,f.occurred_at,chain.depth+1
      FROM financial_activities f JOIN chain ON f.replaces_activity_id=chain.id WHERE chain.depth<30)
    SELECT id,kind,status,base_amount_minor::text,currency_code,destination_asset_id,occurred_at
      FROM chain ORDER BY depth DESC LIMIT 1`,[rootId]);
  if (!result.rows[0]) throw new IncomeEventError("Pemasukan sumber tidak ditemukan.");
  return result.rows[0];
}
function proposed(source: Source, bps: number): {amount:string|null;reason:string|null} {
  try { return {amount:percentageOfIncome(source.base_amount_minor,bps),reason:null}; }
  catch { return {amount:null,reason:"Hasil persentase kurang dari satu unit terkecil."}; }
}
async function captureCandidate(client: PoolClient, candidate: Candidate) {
  const source = await effectiveSource(client,candidate.root_activity_id);
  const root = await client.query<{destination_asset_id:string;currency_code:string;base_amount_minor:string;occurred_at:Date}>(
    "SELECT destination_asset_id,currency_code,base_amount_minor::text,occurred_at FROM financial_activities WHERE id=$1",[candidate.root_activity_id]);
  const valid = source.status === "posted" && source.kind === "income" && !!source.destination_asset_id;
  const sameAsset = valid && candidate.output_kind === "transfer" && candidate.destination_asset_id === source.destination_asset_id;
  const calculation = valid && !sameAsset ? proposed(source,candidate.percentage_bps) :
    {amount:null,reason:sameAsset ? "Aset sumber dan tujuan transfer harus berbeda." : "Pemasukan sumber tidak lagi aktif."};
  await client.query(`INSERT INTO income_event_instances
    (id,rule_id,rule_version,root_activity_id,effective_activity_id,source_asset_id,source_currency,source_amount_minor,source_occurred_at,
     percentage_bps,proposed_amount_minor,output_kind,destination_asset_id,category_id,transfer_fee_minor,charges,note,status,failure_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT (rule_id,root_activity_id) DO NOTHING`,[randomUUID(),candidate.rule_id,candidate.version_no,candidate.root_activity_id,
    source.id,source.destination_asset_id ?? root.rows[0].destination_asset_id,
    source.kind === "income" ? source.currency_code : root.rows[0].currency_code,
    source.kind === "income" ? source.base_amount_minor : root.rows[0].base_amount_minor,source.kind === "income" ? source.occurred_at : root.rows[0].occurred_at,
    candidate.percentage_bps,calculation.amount,candidate.output_kind,candidate.destination_asset_id,candidate.category_id,
    candidate.transfer_fee_minor,JSON.stringify(candidate.charges),candidate.note,
    valid ? calculation.amount ? "awaiting_confirmation" : "failed" : "superseded",calculation.reason]);
}
async function refreshCandidate(client: PoolClient, item: Instance) {
  const source = await effectiveSource(client,item.root_activity_id);
  if (source.id === item.effective_activity_id && source.status === "posted") return;
  if (item.status === "posted" || item.status === "review_required") {
    await client.query("UPDATE income_event_instances SET status='review_required',updated_at=clock_timestamp() WHERE id=$1",[item.id]);
    return;
  }
  const valid = source.status === "posted" && source.kind === "income" && !!source.destination_asset_id;
  const sameAsset = valid && item.output_kind === "transfer" && item.destination_asset_id === source.destination_asset_id;
  const calculation = valid && !sameAsset ? proposed(source,item.percentage_bps) :
    {amount:null,reason:sameAsset ? "Aset sumber dan tujuan transfer harus berbeda." : "Pemasukan sumber dibatalkan atau diganti jenisnya."};
  if (source.id !== item.effective_activity_id || source.base_amount_minor !== item.source_amount_minor || calculation.amount !== item.proposed_amount_minor) {
    await client.query(`INSERT INTO income_event_instance_revisions
      (id,instance_id,previous_effective_activity_id,previous_source_amount_minor,previous_proposed_amount_minor)
      VALUES($1,$2,$3,$4,$5)`,[randomUUID(),item.id,item.effective_activity_id,item.source_amount_minor,item.proposed_amount_minor]);
  }
  await client.query(`UPDATE income_event_instances SET effective_activity_id=$2,source_asset_id=$3,source_currency=$4,
    source_amount_minor=$5,source_occurred_at=$6,proposed_amount_minor=$7,status=$8,failure_reason=$9,
    evaluated_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1`,[item.id,source.id,source.destination_asset_id ?? item.source_asset_id,
    valid ? source.currency_code : item.source_currency,
    valid ? source.base_amount_minor : item.source_amount_minor,valid ? source.occurred_at : item.source_occurred_at,calculation.amount,
    valid ? calculation.amount ? "awaiting_confirmation" : "failed" : "superseded",calculation.reason]);
}
export async function reconcileIncomeEvents(): Promise<{ready:boolean;created:number;refreshed:number}> {
  await requireOwnerSession();
  const ready = (await database().query<{ready:boolean}>("SELECT to_regclass('income_event_rules') IS NOT NULL AS ready")).rows[0].ready;
  if (!ready) return {ready:false,created:0,refreshed:0};
  const changed = await database().query<{id:string}>(`SELECT i.id FROM income_event_instances i
    JOIN financial_activities f ON f.id=i.effective_activity_id
    WHERE i.status IN ('awaiting_confirmation','failed','posted')
      AND (f.status='voided' OR EXISTS(SELECT 1 FROM financial_activities next WHERE next.replaces_activity_id=f.id))
    ORDER BY i.updated_at,i.id LIMIT 50`);
  for (const {id} of changed.rows) await inDatabaseTransaction(async (client) => {
    const row = await client.query<Instance>("SELECT * FROM income_event_instances WHERE id=$1 FOR UPDATE",[id]);
    if (row.rows[0]) await refreshCandidate(client,row.rows[0]);
  });
  const genericReady = (await database().query<{ready:boolean}>("SELECT to_regclass('automation_action_results') IS NOT NULL AS ready")).rows[0].ready;
  const filterClient = await database().connect();
  let allocationFilter: string;
  try { allocationFilter = await allocationDiscoveryFilter(filterClient); } finally { filterClient.release(); }
  const candidates = await database().query<Candidate>(`SELECT s.root_activity_id,p.rule_id,p.version_no,v.title,v.percentage_bps,v.output_kind,
      v.destination_asset_id,v.category_id,v.transfer_fee_minor,v.charges,v.note
    FROM income_automation_sources s
    JOIN income_event_active_periods p ON s.eligible_at>=p.opened_at AND (p.closed_at IS NULL OR s.eligible_at<p.closed_at)
    JOIN income_event_rule_versions v ON v.rule_id=p.rule_id AND v.version_no=p.version_no
    WHERE NOT EXISTS(SELECT 1 FROM income_event_instances i WHERE i.rule_id=p.rule_id AND i.root_activity_id=s.root_activity_id)
    ${genericReady ? "AND NOT EXISTS(SELECT 1 FROM automation_action_results a WHERE a.activity_id=s.root_activity_id AND a.origin='transaction_automation')" : ""}
    ${allocationFilter}
    ORDER BY s.eligible_at,s.root_activity_id,p.rule_id LIMIT 50`);
  for (const candidate of candidates.rows) await inDatabaseTransaction(async (client) => captureCandidate(client,candidate));
  return {ready:true,created:candidates.rows.length,refreshed:changed.rows.length};
}
export async function postIncomeEvent(id: string): Promise<string> {
  await requireOwnerSession(); const instanceId = assertUuid(id);
  try {
    return await inDatabaseTransaction(async (client) => {
      const row = await client.query<Instance>("SELECT * FROM income_event_instances WHERE id=$1 FOR UPDATE",[instanceId]);
      const item = row.rows[0];
      if (!item) throw new IncomeEventError("Kandidat tidak ditemukan.");
      if (item.result_activity_id) return item.result_activity_id;
      if (!["awaiting_confirmation","failed"].includes(item.status) || !item.proposed_amount_minor) throw new IncomeEventError("Kandidat ini tidak dapat dicatat.");
      const rule = await client.query<{status:string}>("SELECT status FROM income_event_rules WHERE id=$1 FOR SHARE",[item.rule_id]);
      if (rule.rows[0]?.status !== "active") throw new IncomeEventError("Aktifkan aturan sebelum mencatat kandidat.");
      const source = await effectiveSource(client,item.root_activity_id);
      await client.query("SELECT id FROM financial_activities WHERE id=$1 FOR SHARE",[source.id]);
      const latest = await effectiveSource(client,item.root_activity_id);
      if (latest.id !== item.effective_activity_id || latest.status !== "posted" || latest.kind !== "income" ||
          latest.base_amount_minor !== item.source_amount_minor || latest.destination_asset_id !== item.source_asset_id) {
        throw new IncomeEventError("Pemasukan sumber berubah. Periksa ulang kandidat.");
      }
      if (item.output_kind === "transfer" && item.destination_asset_id === item.source_asset_id) throw new IncomeEventError("Aset sumber dan tujuan harus berbeda.");
      const activityId = await postActivityInTransaction(client,{
        kind:item.output_kind,amountMinor:item.proposed_amount_minor,sourceAssetId:item.source_asset_id,
        destinationAssetId:item.output_kind === "transfer" ? item.destination_asset_id ?? undefined : undefined,
        categoryId:item.output_kind === "expense" ? item.category_id ?? undefined : undefined,
        charges:item.output_kind === "expense" ? item.charges : undefined,
        transferFeeMinor:item.output_kind === "transfer" ? item.transfer_fee_minor ?? undefined : undefined,
        occurredAt:new Date().toISOString(),note:item.note ?? undefined,
      },instanceId);
      await client.query("UPDATE income_event_instances SET status='posted',result_activity_id=$2,attempted_at=clock_timestamp(),failure_reason=NULL,updated_at=clock_timestamp() WHERE id=$1",[instanceId,activityId]);
      return activityId;
    });
  } catch (error) {
    if (!(error instanceof IncomeEventError)) {
      await database().query("UPDATE income_event_instances SET status='failed',failure_reason=$2,attempted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND status IN ('awaiting_confirmation','failed')",[instanceId,postingFailure]);
      throw new IncomeEventError(postingFailure);
    }
    throw error;
  }
}
export async function skipIncomeEvent(id: string) {
  await requireOwnerSession(); const instanceId = assertUuid(id);
  const changed = await database().query("UPDATE income_event_instances SET status='skipped',updated_at=clock_timestamp() WHERE id=$1 AND status IN ('awaiting_confirmation','failed') RETURNING id",[instanceId]);
  if (!changed.rowCount) {
    const row = await database().query<{status:string}>("SELECT status FROM income_event_instances WHERE id=$1",[instanceId]);
    if (row.rows[0]?.status !== "skipped") throw new IncomeEventError("Kandidat tidak dapat dilewati.");
  }
}
export type IncomeEventView = {ready:boolean;rules:Record<string,unknown>[];instances:Record<string,unknown>[]};
export async function readIncomeEvents(historyIds?: string[]): Promise<IncomeEventView> {
  await requireOwnerSession();
  const ready = (await database().query<{ready:boolean}>("SELECT to_regclass('income_event_rules') IS NOT NULL AS ready")).rows[0].ready;
  if (!ready) return {ready:false,rules:[],instances:[]};
  const [rules,instances] = await Promise.all([
    database().query(`SELECT r.id,r.status,r.created_at,r.version_no,v.title,v.percentage_bps,v.output_kind,v.destination_asset_id,
      v.category_id,v.transfer_fee_minor::text,v.charges,v.note,d.display_name AS destination_name
      FROM income_event_rules r JOIN income_event_rule_versions v ON v.rule_id=r.id AND v.version_no=r.version_no
      LEFT JOIN assets d ON d.id=v.destination_asset_id ORDER BY r.created_at DESC,r.id DESC`),
    database().query(`SELECT i.*,COALESCE(source.eligible_at,i.created_at) AS eligible_at,v.title AS rule_title,s.display_name AS source_name,d.display_name AS destination_name,
      c.minor_unit_exponent AS exponent,f.status AS effective_source_status,
      (SELECT latest.status FROM financial_activities latest WHERE latest.id=COALESCE(
        (WITH RECURSIVE chain AS (SELECT id,0 AS depth FROM financial_activities WHERE id=i.result_activity_id
          UNION ALL SELECT next.id,chain.depth+1 FROM financial_activities next JOIN chain ON next.replaces_activity_id=chain.id WHERE chain.depth<30)
         SELECT id FROM chain ORDER BY depth DESC LIMIT 1),i.result_activity_id)) AS latest_result_status
      FROM income_event_instances i
      LEFT JOIN income_automation_sources source ON source.root_activity_id=i.root_activity_id
      JOIN income_event_rule_versions v ON v.rule_id=i.rule_id AND v.version_no=i.rule_version
      JOIN assets s ON s.id=i.source_asset_id LEFT JOIN assets d ON d.id=i.destination_asset_id
      JOIN currencies c ON c.code=i.source_currency JOIN financial_activities f ON f.id=i.effective_activity_id
      WHERE ($1::uuid[] IS NULL OR i.status IN ('awaiting_confirmation','failed','review_required') OR i.id=ANY($1::uuid[]))
      ORDER BY COALESCE(source.eligible_at,i.created_at) DESC,i.id DESC`,[historyIds??null]),
  ]);
  const allocations = await readAllocationSummaries("income_event",instances.rows.map(row=>String(row.id)));
  const reviews = await readAutomationReviewContexts("income_event",instances.rows.map(row=>String(row.id)));
  return {ready:true,rules:rules.rows,instances:instances.rows.map((row) => ({...row, review:reviews[String(row.id)], allocation:allocations[String(row.id)],
    eligible_at:(row.eligible_at as Date).toISOString(),source_occurred_at:(row.source_occurred_at as Date).toISOString(),created_at:(row.created_at as Date).toISOString()}))};
}
