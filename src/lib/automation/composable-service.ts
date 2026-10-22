import "server-only";
import { allocationDiscoveryFilter, allocationResultOrigin, readAllocationSummaries } from "./allocation-service";
import type { AllocationSummary } from "./allocation-domain";
import { readAutomationReviewContexts } from "./review-service";
import type { ReviewContext } from "./review-domain";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { postActivityInTransaction } from "@/lib/finance/service";
import type { ActivityDraft } from "@/lib/finance/types";
import { addDays, jakartaToday } from "./schedule";
import { actionDraft, calculateAmount, ComposableError, evaluateConditions, normalizeGeneralRule, resolveAsset, timeOccurrences,
  triggerRegistry, validId, type AssetReference, type Condition, type FinancialAction, type GeneralRuleInput, type TriggerContext } from "./composable-domain";

const orderLock = "moneytor_general_automation_order";
const batchSize = 50;
export interface FinancialActionAdapter { execute(client: PoolClient, draft: ActivityDraft, identity: string): Promise<string> }
export const financialActionAdapters: Record<FinancialAction["kind"], FinancialActionAdapter> = Object.fromEntries(
  (["income", "expense", "transfer"] as const).map((kind) => [kind, { execute: (client: PoolClient, draft: ActivityDraft, identity: string) => {
    if (draft.kind !== kind) throw new ComposableError("Adapter tindakan tidak sesuai.");
    return postActivityInTransaction(client, draft, identity);
  } }])) as Record<FinancialAction["kind"], FinancialActionAdapter>;
type Status = "active" | "paused" | "archived";
type Instance = { id: string; rule_id: string; version_no: number; trigger_namespace: "time" | "transaction_posted";
  trigger_identity: string; eligible_at: Date; scheduled_at: Date | null; root_activity_id: string | null;
  effective_activity_id: string | null; trigger_snapshot: TriggerContext; condition_snapshot: ReturnType<typeof evaluateConditions>;
  action_snapshot: FinancialAction; calculated_amount_minor: string | null; resolved_source_asset_id: string | null;
  resolved_destination_asset_id: string | null; currency_code: string | null; status: string; failure_reason: string | null;
  confirmation_state: string; result_activity_id: string | null; attempts: number };
export type GeneralRuleView = { createdAt: string; id: string; status: Status; version: number; input: GeneralRuleInput; categoryName: string | null };
export type GeneralInstanceView = Omit<Instance, "eligible_at" | "scheduled_at"> & { eligible_at: string; scheduled_at: string | null;
  allocation?: AllocationSummary; review?: ReviewContext; title: string; exponent: number; source_exponent: number; latest_result_status: string | null; actionMeaning: string; categoryId: string | null };
export type GeneralView = { ready: boolean; rules: GeneralRuleView[]; instances: GeneralInstanceView[];
  categories: { id: string; name: string; status: "active" | "archived" }[] };

async function ordered(client: PoolClient) { await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [orderLock]); }
export async function generalAutomationReady() {
  return (await database().query<{ ready: boolean }>("SELECT to_regclass('automation_rules') IS NOT NULL AS ready")).rows[0].ready;
}
async function requireReady() { if (!await generalAutomationReady()) throw new ComposableError("Automation umum belum diaktifkan pada database ini."); }

async function validateReferences(client: PoolClient, rule: GeneralRuleInput) {
  if (rule.automationCategoryId && !(await client.query("SELECT id FROM automation_categories WHERE id=$1 AND status='active'", [rule.automationCategoryId])).rowCount) {
    // An archived organizational category already attached to the rule remains valid on edits.
    const existing = await client.query("SELECT id FROM automation_categories WHERE id=$1", [rule.automationCategoryId]);
    if (!existing.rowCount) throw new ComposableError("Kategori otomatisasi tidak ditemukan.");
  }
  const action = rule.actions[0];
  const references = [action.source, action.destination].filter((ref): ref is Extract<AssetReference, { strategy: "configured_asset" }> => ref?.strategy === "configured_asset");
  const assets = await client.query<{ id: string; currency_code: string }>("SELECT id,currency_code FROM assets WHERE id=ANY($1::uuid[]) AND is_active FOR SHARE", [references.map((ref) => ref.assetId)]);
  if (assets.rowCount !== references.length || new Set(assets.rows.map((row) => row.currency_code)).size > 1) throw new ComposableError("Pilih aset aktif dengan mata uang sama.");
  if (action.amount.strategy === "fixed" && assets.rows.some((asset) => asset.currency_code !== (action.amount as Extract<FinancialAction["amount"], { strategy: "fixed" }>).currency)) throw new ComposableError("Mata uang nominal tidak cocok dengan aset.");
  if (action.categoryId && !(await client.query("SELECT id FROM transaction_categories WHERE id=$1 AND applies_to=$2 AND is_active FOR SHARE", [action.categoryId, action.kind])).rowCount) throw new ComposableError("Kategori transaksi tidak sesuai atau tidak aktif.");
  for (const charge of action.charges) if (!(await client.query("SELECT id FROM additional_charge_types WHERE id=$1 AND is_active FOR SHARE", [charge.typeId])).rowCount) throw new ComposableError("Jenis biaya tidak aktif.");
  if (action.transferFeeMinor && !(await client.query("SELECT id FROM additional_charge_types WHERE system_key='transfer_fee' AND is_active")).rowCount) throw new ComposableError("Biaya transfer tidak tersedia.");
  for (const condition of rule.conditions) {
    if (condition.field === "source_asset" || condition.field === "destination_asset") {
      if (!(await client.query("SELECT id FROM assets WHERE id=$1", [condition.value])).rowCount) throw new ComposableError("Aset kondisi tidak ditemukan.");
    }
    if (condition.field === "transaction_category" && !(await client.query("SELECT id FROM transaction_categories WHERE id=$1", [condition.value])).rowCount) throw new ComposableError("Kategori kondisi tidak ditemukan.");
    const currency = condition.field === "currency" ? condition.value : condition.currency;
    if (currency && !(await client.query("SELECT code FROM currencies WHERE code=$1", [currency])).rowCount) throw new ComposableError("Mata uang kondisi tidak tersedia.");
  }
}
async function readVersion(client: PoolClient, id: string, version: number): Promise<GeneralRuleInput> {
  const row = (await client.query<{ title: string; trigger_namespace: GeneralRuleInput["trigger"]["namespace"]; trigger_config: GeneralRuleInput["trigger"];
    condition_mode: "ALL" | "ANY"; execution_policy: GeneralRuleInput["execution"]; category_id: string | null }>(
    `SELECT v.*,r.category_id FROM automation_rule_versions v JOIN automation_rules r ON r.id=v.rule_id WHERE v.rule_id=$1 AND v.version_no=$2`, [id, version])).rows[0];
  if (!row) throw new ComposableError("Versi aturan tidak ditemukan.");
  const conditions = (await client.query<{ field: Condition["field"]; operator: Condition["operator"]; activity_kind: string | null; asset_id: string | null;
    category_id: string | null; currency_code: string | null; amount_minor: string | null; upper_amount_minor: string | null }>(
    "SELECT * FROM automation_conditions WHERE rule_id=$1 AND version_no=$2 ORDER BY position", [id, version])).rows.map((item): Condition => ({
      field: item.field, operator: item.operator, value: item.activity_kind ?? item.asset_id ?? item.category_id ?? item.amount_minor ?? item.currency_code!,
      ...(item.upper_amount_minor ? { upperValue: item.upper_amount_minor } : {}), ...(item.field === "base_amount" ? { currency: item.currency_code! } : {}) }));
  const rows = await client.query<{ action_kind: FinancialAction["kind"]; source_strategy: AssetReference["strategy"] | null; source_asset_id: string | null;
    destination_strategy: AssetReference["strategy"] | null; destination_asset_id: string | null; amount_strategy: FinancialAction["amount"]["strategy"];
    amount_minor: string | null; currency_code: string | null; percentage_bps: number | null; category_id: string | null; transfer_fee_minor: string | null; note: string | null }>(
    "SELECT * FROM automation_actions WHERE rule_id=$1 AND version_no=$2 ORDER BY position", [id, version]);
  if (rows.rowCount !== 1) throw new ComposableError("V1 memerlukan tepat satu tindakan.");
  const action = rows.rows[0];
  const reference = (strategy: AssetReference["strategy"] | null, assetId: string | null): AssetReference | undefined => !strategy ? undefined : strategy === "configured_asset" ? { strategy, assetId: assetId! } : { strategy };
  const charges = (await client.query<{ type_id: string; amount_minor: string }>("SELECT type_id,amount_minor FROM automation_action_charges WHERE rule_id=$1 AND version_no=$2 ORDER BY position", [id, version])).rows.map((charge) => ({ typeId: charge.type_id, amountMinor: charge.amount_minor }));
  const amount: FinancialAction["amount"] = action.amount_strategy === "fixed" ? { strategy: "fixed", amountMinor: action.amount_minor!, currency: action.currency_code! }
    : action.amount_strategy === "percentage_of_trigger" ? { strategy: action.amount_strategy, percentageBps: action.percentage_bps! } : { strategy: action.amount_strategy };
  return { title: row.title, automationCategoryId: row.category_id ?? undefined, trigger: { ...row.trigger_config, namespace: row.trigger_namespace } as GeneralRuleInput["trigger"],
    conditionMode: row.condition_mode, execution: row.execution_policy, conditions,
    actions: [{ kind: action.action_kind, source: reference(action.source_strategy, action.source_asset_id), destination: reference(action.destination_strategy, action.destination_asset_id),
      amount, categoryId: action.category_id ?? undefined, charges, transferFeeMinor: action.transfer_fee_minor ?? undefined, note: action.note ?? undefined }] };
}
export async function saveGeneralRule(raw: GeneralRuleInput, id?: string, requestKey: string = randomUUID()) {
  await requireOwnerSession(); await requireReady();
  const input = normalizeGeneralRule(raw), key = validId(requestKey), ruleId = id ? validId(id) : randomUUID();
  const digest = createHash("sha256").update(JSON.stringify({ id: id ?? null, input })).digest("hex");
  return inDatabaseTransaction(async (client) => {
    await ordered(client);
    const previous = (await client.query<{ request_hash: string; rule_id: string }>("SELECT * FROM automation_rule_mutations WHERE idempotency_key=$1", [key])).rows[0];
    if (previous) { if (previous.request_hash !== digest) throw new ComposableError("Kunci permintaan telah dipakai untuk perubahan lain."); return previous.rule_id; }
    await validateReferences(client, input);
    let version = 1, status: Status = "active";
    if (id) {
      const old = (await client.query<{ active_version: number; status: Status; category_id: string | null }>("SELECT * FROM automation_rules WHERE id=$1 FOR UPDATE", [ruleId])).rows[0];
      if (!old) throw new ComposableError("Aturan tidak ditemukan.");
      version = old.active_version + 1; status = old.status;
      await client.query("UPDATE automation_active_periods SET closed_at=clock_timestamp() WHERE rule_id=$1 AND closed_at IS NULL", [ruleId]);
      await client.query(`UPDATE automation_instances SET status='superseded',failure_reason='Konfigurasi jadwal diperbarui.',updated_at=clock_timestamp()
        WHERE rule_id=$1 AND trigger_namespace='time' AND scheduled_at>=clock_timestamp() AND status IN ('upcoming','awaiting_confirmation','failed')`, [ruleId]);
      await client.query("UPDATE automation_rules SET active_version=$2,category_id=$3,materialized_through=NULL,updated_at=clock_timestamp() WHERE id=$1", [ruleId, version, input.automationCategoryId ?? null]);
    } else await client.query("INSERT INTO automation_rules(id,category_id) VALUES($1,$2)", [ruleId, input.automationCategoryId ?? null]);
    await client.query(`INSERT INTO automation_rule_versions(rule_id,version_no,title,trigger_namespace,trigger_config,condition_mode,execution_policy)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [ruleId, version, input.title, input.trigger.namespace, JSON.stringify(input.trigger), input.conditionMode, input.execution]);
    for (const [position, item] of input.conditions.entries()) await client.query(`INSERT INTO automation_conditions
      (rule_id,version_no,position,field,operator,activity_kind,asset_id,category_id,currency_code,amount_minor,upper_amount_minor)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [ruleId, version, position, item.field, item.operator,
      item.field === "transaction_type" ? item.value : null, ["source_asset", "destination_asset"].includes(item.field) ? item.value : null,
      item.field === "transaction_category" ? item.value : null, item.field === "currency" ? item.value : item.currency ?? null,
      item.field === "base_amount" ? item.value : null, item.upperValue ?? null]);
    const action = input.actions[0];
    await client.query(`INSERT INTO automation_actions(rule_id,version_no,position,action_kind,source_strategy,source_asset_id,destination_strategy,destination_asset_id,
      amount_strategy,amount_minor,currency_code,percentage_bps,category_id,transfer_fee_minor,note) VALUES($1,$2,0,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [ruleId, version, action.kind, action.source?.strategy ?? null, action.source?.strategy === "configured_asset" ? action.source.assetId : null,
        action.destination?.strategy ?? null, action.destination?.strategy === "configured_asset" ? action.destination.assetId : null, action.amount.strategy,
        action.amount.strategy === "fixed" ? action.amount.amountMinor : null, action.amount.strategy === "fixed" ? action.amount.currency : null,
        action.amount.strategy === "percentage_of_trigger" ? action.amount.percentageBps : null, action.categoryId ?? null, action.transferFeeMinor ?? null, action.note ?? null]);
    for (const [position, charge] of action.charges.entries()) await client.query(`INSERT INTO automation_action_charges(rule_id,version_no,action_position,position,type_id,amount_minor) VALUES($1,$2,0,$3,$4,$5)`, [ruleId, version, position, charge.typeId, charge.amountMinor]);
    if (status === "active") await client.query("INSERT INTO automation_active_periods(id,rule_id,version_no,opened_at) VALUES($1,$2,$3,clock_timestamp())", [randomUUID(), ruleId, version]);
    await client.query("INSERT INTO automation_rule_mutations(idempotency_key,request_hash,rule_id) VALUES($1,$2,$3)", [key, digest, ruleId]);
    return ruleId;
  });
}
export async function setGeneralRuleStatus(id: string, status: Status) {
  await requireOwnerSession(); validId(id);
  if (!["active", "paused", "archived"].includes(status)) throw new ComposableError("Status tidak valid.");
  await inDatabaseTransaction(async (client) => {
    await ordered(client);
    const row = (await client.query<{ status: Status; active_version: number }>("SELECT * FROM automation_rules WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row) throw new ComposableError("Aturan tidak ditemukan.");
    if (row.status === status) return;
    await client.query("UPDATE automation_active_periods SET closed_at=clock_timestamp() WHERE rule_id=$1 AND closed_at IS NULL", [id]);
    if (status === "active") {
      await client.query("INSERT INTO automation_active_periods(id,rule_id,version_no,opened_at) VALUES($1,$2,$3,clock_timestamp())", [randomUUID(), id, row.active_version]);
      await client.query(`UPDATE automation_instances SET status='skipped',confirmation_state='skipped',failure_reason='Jadwal berlalu saat aturan tidak aktif.',updated_at=clock_timestamp()
        WHERE rule_id=$1 AND trigger_namespace='time' AND scheduled_at<clock_timestamp() AND status IN ('upcoming','awaiting_confirmation','failed')`, [id]);
    }
    await client.query("UPDATE automation_rules SET status=$2,materialized_through=CASE WHEN $2='active' THEN $3::date ELSE materialized_through END,updated_at=clock_timestamp() WHERE id=$1", [id, status, addDays(jakartaToday(), -1)]);
  });
}
export async function saveAutomationCategory(name: string, id?: string): Promise<string> {
  await requireOwnerSession(); await requireReady();
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new ComposableError("Nama kategori harus 1–80 karakter.");
  if (id) {
    if (!(await database().query("UPDATE automation_categories SET name=$2 WHERE id=$1 RETURNING id", [validId(id), name.trim()])).rowCount) throw new ComposableError("Kategori tidak ditemukan.");
    return id;
  }
  const newId = randomUUID();
  return (await database().query<{ id: string }>(`INSERT INTO automation_categories(id,name) VALUES($1,$2)
    ON CONFLICT (lower(btrim(name))) DO UPDATE SET name=automation_categories.name RETURNING id`, [newId, name.trim()])).rows[0].id;
}
export async function setAutomationCategoryStatus(id: string, status: "active" | "archived") {
  await requireOwnerSession(); validId(id);
  if (!["active", "archived"].includes(status)) throw new ComposableError("Status kategori tidak valid.");
  if (!(await database().query("UPDATE automation_categories SET status=$2 WHERE id=$1 RETURNING id", [id, status])).rowCount) throw new ComposableError("Kategori tidak ditemukan.");
}

async function sourceContext(client: PoolClient, rootId: string, eligibleAt: Date, lock = false): Promise<TriggerContext> {
  const source = (await client.query<{ id: string; kind: TriggerContext["kind"]; status: string; base_amount_minor: string; currency_code: string;
    source_asset_id: string | null; destination_asset_id: string | null; category_id: string | null; occurred_at: Date }>(`WITH RECURSIVE chain AS (
      SELECT f.*,0 AS depth FROM financial_activities f WHERE id=$1
      UNION ALL SELECT next.*,chain.depth+1 FROM financial_activities next JOIN chain ON next.replaces_activity_id=chain.id)
      SELECT * FROM chain ORDER BY depth DESC LIMIT 1`, [rootId])).rows[0];
  if (!source) throw new ComposableError("Transaksi sumber tidak ditemukan.");
  if (lock) {
    await client.query("SELECT id FROM financial_activities WHERE id=$1 FOR SHARE", [source.id]);
    return sourceContext(client, rootId, eligibleAt);
  }
  const general = (await client.query<{ origin: TriggerContext["origin"]; instance_id: string; rule_id: string }>(`SELECT a.origin,a.instance_id,i.rule_id FROM automation_action_results a JOIN automation_instances i ON i.id=a.instance_id WHERE a.activity_id=$1`, [rootId])).rows[0];
  const legacyEvent = (await client.query<{ id: string; rule_id: string }>("SELECT id,rule_id FROM income_event_instances WHERE result_activity_id=$1", [rootId])).rows[0];
  const legacyTime = (await client.query<{ id: string; rule_id: string }>(`SELECT o.id,o.rule_id FROM recurring_transaction_occurrences o
    LEFT JOIN finance_operations operation ON operation.idempotency_key=o.id WHERE o.activity_id=$1 OR operation.result_activity_id=$1`, [rootId])).rows[0];
  const adjustment = await allocationResultOrigin(client,rootId);
  return { identity: rootId, namespace: "transaction_posted", eligibleAt: eligibleAt.toISOString(), rootActivityId: rootId, effectiveActivityId: source.id,
    kind: source.kind, status: source.status, amountMinor: source.base_amount_minor, currency: source.currency_code,
    sourceAssetId: source.source_asset_id ?? undefined, destinationAssetId: source.destination_asset_id ?? undefined, categoryId: source.category_id ?? undefined,
    occurredAt: source.occurred_at.toISOString(), origin: adjustment ? "transaction_automation" : general?.origin ?? (legacyEvent ? "transaction_automation" : legacyTime ? "time_automation" : "manual"),
    producingInstanceId: adjustment?.instance_id ?? general?.instance_id ?? legacyEvent?.id ?? legacyTime?.id, producingRuleId: adjustment?.rule_id ?? general?.rule_id ?? legacyEvent?.rule_id ?? legacyTime?.rule_id };
}
async function evaluated(client: PoolClient, rule: GeneralRuleInput, context: TriggerContext) {
  const conditions = evaluateConditions(rule, context), action = rule.actions[0];
  let amount: string | undefined, source: string | undefined, destination: string | undefined, currency: string | undefined, failure: string | null = null;
  let status = context.namespace === "time" && new Date(context.eligibleAt).getTime() > Date.now() ? "upcoming" : "awaiting_confirmation";
  if (context.namespace === "transaction_posted" && (context.status !== "posted" || context.origin === "transaction_automation")) status = "superseded";
  else if (!conditions.matched) status = "not_matched";
  if (!["superseded", "not_matched"].includes(status)) try {
    amount = calculateAmount(action.amount, context);
    source = resolveAsset(action.source, context); destination = resolveAsset(action.destination, context);
    if (source && source === destination) throw new ComposableError("Aset sumber dan tujuan transfer harus berbeda.");
    const ids = [source, destination].filter(Boolean);
    const assets = (await client.query<{ id: string; currency_code: string }>("SELECT id,currency_code FROM assets WHERE id=ANY($1::uuid[]) AND is_active FOR SHARE", [ids])).rows;
    if (assets.length !== ids.length || new Set(assets.map((asset) => asset.currency_code)).size !== 1) throw new ComposableError("Aset harus aktif dan memakai mata uang sama.");
    currency = assets[0].currency_code;
    const amountCurrency = action.amount.strategy === "fixed" ? action.amount.currency : action.amount.strategy === "confirm_at_runtime" ? currency : context.currency;
    if (amountCurrency !== currency) throw new ComposableError("Mata uang nominal berbeda dari aset tindakan.");
  } catch (cause) { status = "failed"; failure = cause instanceof Error ? cause.message : "Konfigurasi tindakan perlu diperiksa."; }
  return { conditions, action, amount: amount ?? null, source: source ?? null, destination: destination ?? null, currency: currency ?? null, status, failure };
}
async function capture(client: PoolClient, id: string, version: number, rule: GeneralRuleInput, context: TriggerContext) {
  const value = await evaluated(client, rule, context);
  const identity = triggerRegistry[context.namespace].getStableTriggerIdentity(context);
  const row = await client.query(`INSERT INTO automation_instances(id,rule_id,version_no,trigger_namespace,trigger_identity,eligible_at,scheduled_at,
    root_activity_id,effective_activity_id,trigger_snapshot,condition_snapshot,action_snapshot,calculated_amount_minor,resolved_source_asset_id,
    resolved_destination_asset_id,currency_code,status,confirmation_state,failure_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    ON CONFLICT(rule_id,trigger_namespace,trigger_identity) DO NOTHING RETURNING id`,
    [randomUUID(), id, version, context.namespace, identity, context.eligibleAt, context.namespace === "time" ? context.eligibleAt : null,
      context.rootActivityId ?? null, context.effectiveActivityId ?? null, JSON.stringify(context), JSON.stringify(value.conditions), JSON.stringify(value.action),
      value.amount, value.source, value.destination, value.currency, value.status, rule.execution === "automatic" ? "not_required" : "pending", value.failure]);
  return row.rowCount ?? 0;
}
async function refreshInstance(client: PoolClient, item: Instance, context: TriggerContext) {
  if (item.result_activity_id) {
    await client.query("UPDATE automation_instances SET status='review_required',failure_reason='Transaksi pemicu berubah; tinjau hasil di Transactions.',updated_at=clock_timestamp() WHERE id=$1", [item.id]);
    return;
  }
  if (item.status === "skipped") return;
  const rule = await readVersion(client, item.rule_id, item.version_no);
  const value = await evaluated(client, rule, context);
  await client.query("INSERT INTO automation_instance_revisions(id,instance_id,previous_snapshot) VALUES($1,$2,$3)", [randomUUID(), item.id, JSON.stringify({ trigger: item.trigger_snapshot, conditions: item.condition_snapshot, action: item.action_snapshot, amount: item.calculated_amount_minor, status: item.status })]);
  await client.query(`UPDATE automation_instances SET effective_activity_id=$2,trigger_snapshot=$3,condition_snapshot=$4,action_snapshot=$5,
    calculated_amount_minor=$6,resolved_source_asset_id=$7,resolved_destination_asset_id=$8,currency_code=$9,status=$10,failure_reason=$11,updated_at=clock_timestamp() WHERE id=$1`,
    [item.id, context.effectiveActivityId ?? null, JSON.stringify(context), JSON.stringify(value.conditions), JSON.stringify(value.action), value.amount, value.source, value.destination, value.currency, value.status, value.failure]);
}
export interface SourceDiscoveryAdapter { discover(client: PoolClient): Promise<number> }
async function discoverTransactions(client: PoolClient) {
  let created = 0;
  const allocationFilter = await allocationDiscoveryFilter(client);
  const sources = (await client.query<{ root_activity_id: string; eligible_at: Date; rule_id: string; version_no: number }>(`SELECT s.*,p.rule_id,p.version_no
    FROM automation_source_receipts s JOIN automation_active_periods p ON s.eligible_at>=p.opened_at AND (p.closed_at IS NULL OR s.eligible_at<p.closed_at)
    JOIN automation_rule_versions v ON v.rule_id=p.rule_id AND v.version_no=p.version_no AND v.trigger_namespace='transaction_posted'
    WHERE NOT EXISTS(SELECT 1 FROM automation_instances i WHERE i.rule_id=p.rule_id AND i.trigger_namespace='transaction_posted' AND i.trigger_identity=s.root_activity_id::text)
    AND NOT EXISTS(SELECT 1 FROM automation_action_results a WHERE a.activity_id=s.root_activity_id AND a.origin='transaction_automation')
    AND NOT EXISTS(SELECT 1 FROM income_event_instances e WHERE e.result_activity_id=s.root_activity_id)
    ${allocationFilter}
    ORDER BY s.eligible_at,s.root_activity_id,p.rule_id LIMIT $1`, [batchSize])).rows;
  for (const source of sources) created += await capture(client, source.rule_id, source.version_no, await readVersion(client, source.rule_id, source.version_no), await sourceContext(client, source.root_activity_id, source.eligible_at, true));
  return created;
}
async function discoverTime(client: PoolClient) {
  let created = 0;
  const today = jakartaToday(), horizon = addDays(today, 30);
  const timeRules = (await client.query<{ id: string; active_version: number; materialized_through: string | null }>(`SELECT r.id,r.active_version,r.materialized_through::text FROM automation_rules r JOIN automation_rule_versions v
    ON v.rule_id=r.id AND v.version_no=r.active_version WHERE r.status='active' AND v.trigger_namespace='time'
      AND (v.trigger_config->'schedule'->>'startOn')::date<=$1::date
      AND (r.materialized_through IS NULL OR r.materialized_through<LEAST($1::date,
        CASE WHEN v.trigger_config->'schedule'->>'frequency'='once' THEN (v.trigger_config->'schedule'->>'startOn')::date
          ELSE COALESCE((v.trigger_config->'schedule'->>'endOn')::date,$1::date) END))
    ORDER BY r.materialized_through NULLS FIRST,r.updated_at,r.id LIMIT 50 FOR UPDATE OF r`, [horizon])).rows;
  for (const row of timeRules) {
    const rule = await readVersion(client, row.id, row.active_version);
    if (rule.trigger.namespace !== "time") continue;
    const schedule = rule.trigger.schedule;
    let from = row.materialized_through ? addDays(row.materialized_through, 1) : schedule.startOn;
    if (from < schedule.startOn) from = schedule.startOn;
    if (row.active_version > 1 && from < today) from = today;
    const through = [addDays(from, 30), horizon, schedule.frequency === "once" ? schedule.startOn : schedule.endOn ?? horizon].sort()[0];
    if (from <= through) {
      for (const at of timeOccurrences(schedule, from, through)) {
        const old = (await client.query<Instance>("SELECT * FROM automation_instances WHERE rule_id=$1 AND trigger_namespace='time' AND trigger_identity=$2", [row.id, at])).rows[0];
        if (old?.status === "superseded" && !old.result_activity_id && new Date(at).getTime() > Date.now()) {
          await client.query("INSERT INTO automation_instance_revisions(id,instance_id,previous_snapshot) VALUES($1,$2,$3)", [randomUUID(), old.id, JSON.stringify({ trigger: old.trigger_snapshot, action: old.action_snapshot, version: old.version_no })]);
          const context: TriggerContext = { namespace: "time", identity: at, eligibleAt: at, occurredAt: at, origin: "time_automation" };
          const value = await evaluated(client, rule, context);
          await client.query(`UPDATE automation_instances SET version_no=$2,trigger_snapshot=$3,condition_snapshot=$4,action_snapshot=$5,calculated_amount_minor=$6,
            resolved_source_asset_id=$7,resolved_destination_asset_id=$8,currency_code=$9,status=$10,confirmation_state=$11,failure_reason=$12 WHERE id=$1`,
            [old.id, row.active_version, JSON.stringify(context), JSON.stringify(value.conditions), JSON.stringify(value.action), value.amount, value.source, value.destination,
              value.currency, value.status, rule.execution === "automatic" ? "not_required" : "pending", value.failure]);
        } else created += await capture(client, row.id, row.active_version, rule, { namespace: "time", identity: at, eligibleAt: at, occurredAt: at, origin: "time_automation" });
      }
      await client.query("UPDATE automation_rules SET materialized_through=$2,updated_at=clock_timestamp() WHERE id=$1", [row.id, through]);
    }
  }
  return created;
}
export const sourceDiscoveryAdapters: Record<TriggerContext["namespace"], SourceDiscoveryAdapter> = {
  transaction_posted: { discover: discoverTransactions }, time: { discover: discoverTime },
};
export async function reconcileGeneralAutomation() {
  await requireOwnerSession();
  if (!await generalAutomationReady()) return { ready: false, created: 0, refreshed: 0, posted: 0 };
  const result = await inDatabaseTransaction(async (client) => {
    await ordered(client);
    let created = 0;
    const changed = (await client.query<Instance>(`SELECT i.* FROM automation_instances i JOIN financial_activities f ON f.id=i.effective_activity_id
      WHERE i.status NOT IN ('skipped','review_required') AND (f.status IS DISTINCT FROM i.trigger_snapshot->>'status'
        OR EXISTS(SELECT 1 FROM financial_activities next WHERE next.replaces_activity_id=f.id)) ORDER BY i.updated_at,i.id LIMIT $1 FOR UPDATE OF i`, [batchSize])).rows;
    for (const item of changed) await refreshInstance(client, item, await sourceContext(client, item.root_activity_id!, item.eligible_at, true));
    for (const adapter of Object.values(sourceDiscoveryAdapters)) created += await adapter.discover(client);
    await client.query("UPDATE automation_instances SET status='awaiting_confirmation' WHERE status='upcoming' AND scheduled_at<=clock_timestamp()");
    const automatic = (await client.query<{ id: string }>(`SELECT i.id FROM automation_instances i JOIN automation_rules r ON r.id=i.rule_id
      WHERE i.trigger_namespace='time' AND i.status IN ('awaiting_confirmation','failed') AND i.confirmation_state='not_required' AND r.status='active'
      ORDER BY i.scheduled_at,i.id LIMIT 10`)).rows;
    return { ready: true, created, refreshed: changed.length, automatic };
  });
  let posted = 0;
  for (const row of result.automatic) try { await confirmGeneralInstance(row.id, undefined, true); posted++; } catch { /* failure is retained for owner retry */ }
  return { ready: result.ready, created: result.created, refreshed: result.refreshed, posted };
}
export async function confirmGeneralInstance(id: string, runtimeAmount?: string, automatic = false): Promise<string> {
  await requireOwnerSession(); validId(id);
  try {
    const result = await inDatabaseTransaction(async (client) => {
      await ordered(client);
      const item = (await client.query<Instance>("SELECT * FROM automation_instances WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!item) throw new ComposableError("Aktivitas otomatisasi tidak ditemukan.");
      if (item.result_activity_id) return { id: item.result_activity_id };
      if (!["awaiting_confirmation", "failed"].includes(item.status)) throw new ComposableError("Aktivitas ini tidak dapat dijalankan.");
      const ruleRow = (await client.query<{ status: Status }>("SELECT status FROM automation_rules WHERE id=$1 FOR SHARE", [item.rule_id])).rows[0];
      if (ruleRow.status !== "active") throw new ComposableError("Aktifkan aturan sebelum menjalankan tindakan.");
      const rule = await readVersion(client, item.rule_id, item.version_no);
      normalizeGeneralRule(rule);
      if (automatic && (rule.trigger.namespace !== "time" || rule.execution !== "automatic")) throw new ComposableError("Eksekusi otomatis tidak diizinkan.");
      let context = item.trigger_snapshot;
      if (item.root_activity_id) {
        context = await sourceContext(client, item.root_activity_id, item.eligible_at, true);
        if (context.effectiveActivityId !== item.effective_activity_id || context.status !== item.trigger_snapshot.status) {
          await refreshInstance(client, item, context); return { changed: true };
        }
      }
      const value = await evaluated(client, rule, context);
      if (!value.conditions.matched || ["superseded", "failed", "not_matched", "upcoming"].includes(value.status)) throw new ComposableError(value.failure ?? "Pemicu tidak lagi memenuhi aturan.");
      const draft = actionDraft(rule.actions[0], { ...context, occurredAt: item.trigger_namespace === "time" ? context.occurredAt : new Date().toISOString() }, runtimeAmount);
      const activityId = await financialActionAdapters[draft.kind].execute(client, draft, item.id);
      await client.query(`INSERT INTO automation_action_results(id,instance_id,action_position,activity_id,origin,causal_root_activity_id) VALUES($1,$2,0,$3,$4,$5)`,
        [randomUUID(), id, activityId, item.trigger_namespace === "time" ? "time_automation" : "transaction_automation", item.root_activity_id]);
      await client.query(`UPDATE automation_instances SET status='posted',confirmation_state=$2,result_activity_id=$3,calculated_amount_minor=$4,
        attempts=attempts+1,attempted_at=clock_timestamp(),failure_reason=NULL,updated_at=clock_timestamp() WHERE id=$1`,
        [id, automatic ? "not_required" : "confirmed", activityId, draft.amountMinor]);
      return { id: activityId };
    });
    if (result.changed) throw new ComposableError("Transaksi pemicu berubah. Tinjau nominal dan kondisi terbaru sebelum mengonfirmasi kembali.");
    return result.id!;
  } catch (cause) {
    if (!(cause instanceof ComposableError)) {
      await database().query(`UPDATE automation_instances SET status='failed',attempts=attempts+1,attempted_at=clock_timestamp(),failure_reason=$2,updated_at=clock_timestamp()
        WHERE id=$1 AND status IN ('awaiting_confirmation','failed')`, [id, "Tindakan belum dapat dicatat. Periksa aset, kategori, dan biaya sebelum mencoba lagi."]);
      throw new ComposableError("Tindakan belum dapat dicatat. Periksa aset, kategori, dan biaya sebelum mencoba lagi.");
    }
    throw cause;
  }
}
export async function skipGeneralInstance(id: string) {
  await requireOwnerSession(); validId(id);
  await inDatabaseTransaction(async (client) => {
    await ordered(client);
    const item = (await client.query<Instance>("SELECT * FROM automation_instances WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (item?.status === "skipped") return;
    if (!item || !["upcoming", "awaiting_confirmation", "failed"].includes(item.status)) throw new ComposableError("Aktivitas ini tidak dapat dilewati.");
    await client.query("UPDATE automation_instances SET status='skipped',confirmation_state='skipped',updated_at=clock_timestamp() WHERE id=$1", [id]);
  });
}
export async function readGeneralAutomation(historyIds?: string[]): Promise<GeneralView> {
  await requireOwnerSession();
  if (!await generalAutomationReady()) return { ready: false, rules: [], instances: [], categories: [] };
  return inDatabaseTransaction(async (client) => {
    const categories = (await client.query<GeneralView["categories"][number]>("SELECT id,name,status FROM automation_categories ORDER BY name,id")).rows;
    const rows = (await client.query<{ id: string; created_at: Date; active_version: number; status: Status; category_name: string | null }>("SELECT r.*,c.name AS category_name FROM automation_rules r LEFT JOIN automation_categories c ON c.id=r.category_id ORDER BY r.created_at DESC,r.id DESC")).rows;
    const rules: GeneralRuleView[] = [];
    for (const row of rows) rules.push({ createdAt: row.created_at.toISOString(), id: row.id, status: row.status, version: row.active_version, input: await readVersion(client, row.id, row.active_version), categoryName: row.category_name });
    const instances = (await client.query<Instance & { title: string; exponent: number; source_exponent: number; category_id: string | null; destination_name: string | null; latest_result_status: string | null }>(`SELECT i.*,v.title,r.category_id,c.minor_unit_exponent AS exponent,sc.minor_unit_exponent AS source_exponent,d.display_name AS destination_name,
      (WITH RECURSIVE chain AS (SELECT id,status,0 AS depth FROM financial_activities WHERE id=i.result_activity_id
        UNION ALL SELECT next.id,next.status,chain.depth+1 FROM financial_activities next JOIN chain ON next.replaces_activity_id=chain.id)
        SELECT status FROM chain ORDER BY depth DESC LIMIT 1) AS latest_result_status
      FROM automation_instances i JOIN automation_rule_versions v ON v.rule_id=i.rule_id AND v.version_no=i.version_no
      JOIN automation_rules r ON r.id=i.rule_id LEFT JOIN currencies c ON c.code=COALESCE(i.currency_code,i.trigger_snapshot->>'currency') LEFT JOIN assets d ON d.id=i.resolved_destination_asset_id
      LEFT JOIN currencies sc ON sc.code=i.trigger_snapshot->>'currency'
      WHERE i.status<>'not_matched' AND ($1::uuid[] IS NULL OR i.status IN ('upcoming','awaiting_confirmation','failed','review_required') OR i.id=ANY($1::uuid[]))
      ORDER BY CASE WHEN i.status IN ('awaiting_confirmation','failed','review_required') THEN 0 WHEN i.status='upcoming' THEN 1 ELSE 2 END,
        CASE WHEN i.status='upcoming' THEN i.eligible_at END ASC,i.eligible_at DESC,
        CASE WHEN i.status='upcoming' THEN i.id END ASC,i.id DESC`,[historyIds??null])).rows;
    const allocations = await readAllocationSummaries("general",instances.map(item=>item.id),client);
    const reviews = await readAutomationReviewContexts("general",instances.map(item=>item.id),client);
    return { ready: true, categories, rules, instances: instances.map((item) => ({ ...item, review: reviews[item.id], allocation: allocations[item.id], eligible_at: item.eligible_at.toISOString(), scheduled_at: item.scheduled_at?.toISOString() ?? null,
      exponent: item.exponent ?? 0, source_exponent:item.source_exponent??0, categoryId: item.category_id,
      actionMeaning: item.action_snapshot.kind === "transfer" ? `Transfer ke ${item.destination_name ?? "aset tujuan"}` : item.action_snapshot.kind === "income" ? "Pemasukan" : "Pengeluaran" })) };
  });
}
