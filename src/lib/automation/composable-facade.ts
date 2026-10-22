import type { AllocationSummary } from "./allocation-domain";
import type { ReviewContext } from "./review-domain";
import type { AutomationView } from "./service";
import type { IncomeEventView } from "./income-events";
import { capabilities, ComposableError, normalizeGeneralRule, type GeneralRuleInput, type Trigger, type FinancialAction, type AssetReference } from "./composable-domain.ts";
import type { RuleInput } from "./service";
import type { IncomeEventRuleInput } from "./income-events";
import type { GeneralView } from "./composable-service";

export type Storage = "schedule" | "income_event" | "general";
export type WorkspaceRule = { createdAt: string; key: string; id: string; storage: Storage; title: string; status: string; triggerSource: "time" | "transaction_posted";
  categoryId: string | null; categoryName: string | null; context: string; input?: GeneralRuleInput };
export type WorkspaceInstance = { allocation?: AllocationSummary; review?: ReviewContext; key: string; id: string; storage: Storage; title: string; status: string; latestResultStatus: string | null;
  triggerSource: "time" | "transaction_posted"; categoryId: string | null; at: string; amount: string | null; currency: string; exponent: number;
  context: string; sourceAmount?: string; sourceCurrency?:string;sourceExponent?:number; sourceKind?: string; sourceAt?: string; percentageBps?: number; needsAmount: boolean; canPost: boolean; canSkip: boolean;
  resultId: string | null; rootId: string | null; failure: string | null; actionMeaning: string };
const labels: Record<string, string> = { income: "Pemasukan", expense: "Pengeluaran", transfer: "Transfer", daily: "Setiap hari", weekdays: "Senin–Jumat",
  weekly: "Mingguan", monthly_day: "Bulanan", monthly_last_day: "Akhir bulan", once: "Sekali" };
const text = (row: Record<string, unknown>, key: string) => row[key] == null ? "" : String(row[key]);
const ruleCreatedAt = (row: Record<string, unknown>) => row.created_at instanceof Date ? row.created_at.toISOString() : text(row, "created_at");
function scheduleInput(row: Record<string, unknown>): GeneralRuleInput {
  return { title: text(row,"title"), trigger: { namespace:"time", schedule: { frequency: text(row,"frequency") as RuleInput["frequency"],
    startOn:text(row,"start_on").slice(0,10),endOn:text(row,"end_on").slice(0,10)||undefined,localTime:text(row,"local_time").slice(0,5),
    weekday:row.weekday ? Number(row.weekday):undefined,monthDay:row.month_day ? Number(row.month_day):undefined } },
    conditionMode:"ALL",conditions:[],execution:row.execution_mode==="auto_post"?"automatic":"confirm_before_execute",
    actions:[{kind:text(row,"kind") as FinancialAction["kind"],source:row.source_asset_id ? {strategy:"configured_asset",assetId:text(row,"source_asset_id")}:undefined,
      destination:row.destination_asset_id ? {strategy:"configured_asset",assetId:text(row,"destination_asset_id")}:undefined,
      amount:row.amount_mode==="fixed"?{strategy:"fixed",amountMinor:text(row,"amount_minor"),currency:text(row,"currency_code")}:{strategy:"confirm_at_runtime"},
      categoryId:text(row,"category_id")||undefined,charges:(row.charges??[]) as FinancialAction["charges"],transferFeeMinor:text(row,"transfer_fee_minor")||undefined,note:text(row,"note")||undefined}] };
}
function incomeInput(row: Record<string, unknown>): GeneralRuleInput {
  return {title:text(row,"title"),trigger:{namespace:"transaction_posted",activityKind:"income"},conditions:[],conditionMode:"ALL",execution:"confirm_before_execute",
    actions:[{kind:text(row,"output_kind") as "expense"|"transfer",source:{strategy:"trigger_destination_asset"},
      destination:row.destination_asset_id ? {strategy:"configured_asset",assetId:text(row,"destination_asset_id")}:undefined,
      amount:{strategy:"percentage_of_trigger",percentageBps:Number(row.percentage_bps)},categoryId:text(row,"category_id")||undefined,
      charges:(row.charges??[]) as FinancialAction["charges"],transferFeeMinor:text(row,"transfer_fee_minor")||undefined,note:text(row,"note")||undefined}]};
}
/** Compatibility metadata also bounds safe round-trips to authoritative legacy commands. */
export function builderCapabilities(rule: GeneralRuleInput, storage: Storage = "general") {
  const base=capabilities(rule);
  const sourceReferences:AssetReference["strategy"][]=storage==="income_event"?["trigger_destination_asset"]:base.references;
  return {...base,conditionFields:storage==="general"?base.conditionFields:[],
    triggers:(storage==="general"?["time","transaction_posted"]:storage==="schedule"?["time"]:["transaction_posted"]) as Trigger["namespace"][],
    actionKinds:(storage==="income_event"?["expense","transfer"]:["income","expense","transfer"]) as FinancialAction["kind"][],
    amountStrategies:storage==="income_event"?["percentage_of_trigger"] as const:base.amountStrategies,
    sourceReferences,destinationReferences:storage==="income_event"?["configured_asset"] as AssetReference["strategy"][]:base.references,
    timeFrequencies:storage==="schedule"?["daily","weekdays","weekly","monthly_day","monthly_last_day"] as const:["once","daily","weekdays","weekly","monthly_day","monthly_last_day"] as const};
}
export function legacyRulePayload(storage: Exclude<Storage,"general">, raw: GeneralRuleInput): RuleInput|IncomeEventRuleInput {
  if(raw.conditions.length || raw.automationCategoryId)throw new ComposableError("Aturan lama belum memakai kondisi atau kategori Automation umum.");
  const action=raw.actions[0];
  // Legacy fee templates retain their original semantics; their authoritative service validates them.
  const input=normalizeGeneralRule({...raw,actions:[{...action,charges:[],transferFeeMinor:undefined}]});
  if(storage==="schedule"){
    if(input.trigger.namespace!=="time"||input.trigger.schedule.frequency==="once"||!["fixed","confirm_at_runtime"].includes(action.amount.strategy)
      ||[action.source,action.destination].some((ref)=>ref&&ref.strategy!=="configured_asset"))throw new ComposableError("Konfigurasi tidak dapat disimpan sebagai jadwal lama.");
    return {...input.trigger.schedule,frequency:input.trigger.schedule.frequency,title:input.title,kind:action.kind,
      amountMode:action.amount.strategy==="fixed"?"fixed":"confirm_amount",amountMinor:action.amount.strategy==="fixed"?action.amount.amountMinor:undefined,
      executionMode:input.execution==="automatic"?"auto_post":"confirm_before_post",
      sourceAssetId:action.source?.strategy==="configured_asset"?action.source.assetId:undefined,destinationAssetId:action.destination?.strategy==="configured_asset"?action.destination.assetId:undefined,
      categoryId:action.categoryId,charges:action.charges,transferFeeMinor:action.transferFeeMinor,note:action.note};
  }
  if(input.trigger.namespace!=="transaction_posted"||input.trigger.activityKind!=="income"||action.kind==="income"||action.amount.strategy!=="percentage_of_trigger"
    ||action.source?.strategy!=="trigger_destination_asset"||(action.destination&&action.destination.strategy!=="configured_asset"))throw new ComposableError("Konfigurasi tidak dapat disimpan sebagai aturan pemasukan lama.");
  return {title:input.title,percentageBps:action.amount.percentageBps,outputKind:action.kind,
    destinationAssetId:action.destination?.strategy==="configured_asset"?action.destination.assetId:undefined,categoryId:action.categoryId,
    charges:action.charges,transferFeeMinor:action.transferFeeMinor,note:action.note};
}
export function unifyAutomation(schedules: AutomationView, income: IncomeEventView, general: GeneralView) {
  const rules: WorkspaceRule[] = [
    ...schedules.rules.map((row): WorkspaceRule => ({ key: `schedule:${row.id}`, id: text(row, "id"), storage: "schedule", createdAt: ruleCreatedAt(row), title: text(row, "title"), status: text(row, "status"),
      triggerSource: "time", categoryId: null, categoryName: null, input:scheduleInput(row), context: `${labels[text(row, "frequency")]} · ${text(row, "local_time").slice(0, 5)} WIB · ${labels[text(row, "kind")]} · ${text(row, "source_name") || text(row, "destination_name")}` })),
    ...income.rules.map((row): WorkspaceRule => ({ key: `income_event:${row.id}`, id: text(row, "id"), storage: "income_event", createdAt: ruleCreatedAt(row), title: text(row, "title"), status: text(row, "status"),
      triggerSource: "transaction_posted", categoryId: null, categoryName: null, input:incomeInput(row), context: `Transaksi pemasukan · ${Number(row.percentage_bps) / 100}% · ${labels[text(row, "output_kind")]}` })),
    ...general.rules.map((row): WorkspaceRule => ({ key: `general:${row.id}`, id: row.id, storage: "general", createdAt: row.createdAt, title: row.input.title, status: row.status,
      triggerSource: row.input.trigger.namespace, categoryId: row.input.automationCategoryId ?? null, categoryName: row.categoryName, input: row.input,
      context: `${row.input.trigger.namespace === "time" ? labels[row.input.trigger.schedule.frequency] : "Transaksi terjadi"} → ${labels[row.input.actions[0].kind]} · ${row.input.execution === "automatic" ? "Otomatis" : "Minta konfirmasi"}` })),
  ];
  const instances: WorkspaceInstance[] = [
    ...schedules.occurrences.map((row): WorkspaceInstance => {
      const status = text(row, "status");
      return { review:row.review as ReviewContext | undefined,key: `schedule:${row.id}`, id: text(row, "id"), storage: "schedule", title: text(row, "rule_title"), status,
        latestResultStatus: text(row, "latest_activity_status") || null, triggerSource: "time", categoryId: null, at: text(row, "scheduled_at"),
        amount: text(row, "amount_minor") || null, currency: text(row, "currency_code"), exponent: Number(row.exponent), context: labels[text(row, "kind")],
        needsAmount: row.amount_mode === "confirm_amount" && !row.amount_minor, canPost: ["due", "pending_confirmation", "failed"].includes(status),
        canSkip: ["upcoming", "due", "pending_confirmation", "failed"].includes(status), resultId: text(row, "activity_id") || null,
        rootId: null, failure: text(row, "failure_reason") || null, actionMeaning: labels[text(row, "kind")] };
    }),
    ...income.instances.map((row): WorkspaceInstance => ({ review:row.review as ReviewContext | undefined,allocation:row.allocation as AllocationSummary | undefined, key: `income_event:${row.id}`, id: text(row, "id"), storage: "income_event", title: text(row, "rule_title"),
      status: text(row, "status"), latestResultStatus: text(row, "latest_result_status") || null, triggerSource: "transaction_posted", categoryId: null,
      at: text(row,"eligible_at") || text(row,"source_occurred_at"), amount: text(row, "proposed_amount_minor") || null, currency: text(row, "source_currency"), exponent: Number(row.exponent),
      context: text(row, "source_name"), sourceAmount: text(row, "source_amount_minor"),sourceCurrency:text(row,"source_currency"),sourceExponent:Number(row.exponent), sourceKind: "income", sourceAt: text(row, "source_occurred_at"), percentageBps: Number(row.percentage_bps),
      needsAmount: false, canPost: ["awaiting_confirmation", "failed"].includes(text(row, "status")) && !!row.proposed_amount_minor,
      canSkip: ["awaiting_confirmation", "failed"].includes(text(row, "status")), resultId: text(row, "result_activity_id") || null,
      rootId: text(row, "root_activity_id"), failure: text(row, "failure_reason") || null, actionMeaning: row.output_kind === "transfer" ? `Transfer ke ${text(row, "destination_name")}` : "Pengeluaran" })),
    ...general.instances.map((row): WorkspaceInstance => ({ review:row.review,allocation:row.allocation, key: `general:${row.id}`, id: row.id, storage: "general", title: row.title, status: row.status,
      latestResultStatus: row.latest_result_status, triggerSource: row.trigger_namespace, categoryId: row.categoryId, at: row.eligible_at,
      amount: row.calculated_amount_minor, currency: row.currency_code ?? row.trigger_snapshot.currency ?? "IDR", exponent: row.exponent,
      context: row.trigger_namespace === "time" ? "Waktu tertentu" : `Transaksi ${labels[row.trigger_snapshot.kind ?? ""] ?? ""}`,
      sourceAmount: row.trigger_snapshot.amountMinor,sourceCurrency:row.trigger_snapshot.currency,sourceExponent:row.source_exponent, sourceKind: row.trigger_snapshot.kind, sourceAt: row.trigger_snapshot.occurredAt,
      percentageBps: row.action_snapshot.amount.strategy === "percentage_of_trigger" ? row.action_snapshot.amount.percentageBps : undefined,
      needsAmount: row.action_snapshot.amount.strategy === "confirm_at_runtime", canPost: ["awaiting_confirmation", "failed"].includes(row.status),
      canSkip: ["upcoming", "awaiting_confirmation", "failed"].includes(row.status), resultId: row.result_activity_id, rootId: row.root_activity_id,
      failure: row.failure_reason, actionMeaning: row.actionMeaning })),
  ];
  return { rules, instances };
}
/** Commands retain each authoritative legacy storage; IDs are never copied into generic tables. */
export function instanceCommand(storage: Storage, command: "post" | "skip" | "void") {
  return storage === "schedule" ? command : storage === "income_event" ? `event-${command}` : `general-${command}`;
}
export function lifecycleCommand(storage: Storage, command: "pause" | "resume" | "archive" | "restore") {
  return storage === "schedule" ? command : storage === "income_event" ? `event-${command}` : `general-${command}`;
}
