import { assertStoredMinor, parseMinor } from "../domain/money.ts";
import { addDays, dateOnly, occursOn, scheduledAt, type Schedule } from "./schedule.ts";
import type { ActivityDraft, ActivityKind } from "../finance/types";

export class ComposableError extends Error {}
export type AssetReference = { strategy: "configured_asset"; assetId: string } | { strategy: "trigger_source_asset" | "trigger_destination_asset" };
export type AmountStrategy = { strategy: "fixed"; amountMinor: string; currency: string }
  | { strategy: "percentage_of_trigger"; percentageBps: number } | { strategy: "trigger_amount" } | { strategy: "confirm_at_runtime" };
export type TimeConfiguration = Omit<Schedule, "frequency"> & { frequency: Schedule["frequency"] | "once" };
export type Trigger = { namespace: "time"; schedule: TimeConfiguration }
  | { namespace: "transaction_posted"; activityKind?: ActivityKind };
export type ConditionField = "transaction_type" | "source_asset" | "destination_asset" | "transaction_category" | "base_amount" | "currency";
export type Operator = "equals" | "not_equals" | "greater_than" | "greater_or_equal" | "less_than" | "less_or_equal" | "between";
export type Condition = { field: ConditionField; operator: Operator; value: string; upperValue?: string; currency?: string };
export type FinancialAction = { kind: ActivityKind; source?: AssetReference; destination?: AssetReference; amount: AmountStrategy;
  categoryId?: string; charges: { typeId: string; amountMinor: string }[]; transferFeeMinor?: string; note?: string };
export type GeneralRuleInput = { title: string; automationCategoryId?: string; trigger: Trigger; conditionMode: "ALL" | "ANY";
  conditions: Condition[]; actions: FinancialAction[]; execution: "confirm_before_execute" | "automatic" };
export type TriggerContext = { identity: string; eligibleAt: string; namespace: Trigger["namespace"]; rootActivityId?: string;
  effectiveActivityId?: string; kind?: ActivityKind; status?: string; amountMinor?: string; currency?: string;
  sourceAssetId?: string; destinationAssetId?: string; categoryId?: string; occurredAt: string;
  origin: "manual" | "time_automation" | "transaction_automation"; producingRuleId?: string; producingInstanceId?: string };
const kinds: ActivityKind[] = ["income", "expense", "transfer"];
const referenceNames: AssetReference["strategy"][] = ["configured_asset", "trigger_source_asset", "trigger_destination_asset"];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new ComposableError("Referensi tidak valid.");
  return value;
}
export function positiveMinor(value: unknown): string {
  if (typeof value !== "string") throw new ComposableError("Nominal harus berupa unit terkecil.");
  const amount = assertStoredMinor(parseMinor(value));
  if (amount <= 0n) throw new ComposableError("Nominal harus lebih dari nol.");
  return amount.toString();
}
export function percentToBps(value: string): number {
  const text = value.trim().replace(",", ".");
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) throw new ComposableError("Persentase memakai maksimal dua angka desimal.");
  const [whole, fraction = ""] = text.split(".");
  const bps = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
  if (bps < 1 || bps > 10000) throw new ComposableError("Persentase harus 0,01–100%.");
  return bps;
}
export function bpsToPercent(bps: number): string {
  return `${Math.floor(bps / 100)}${bps % 100 ? `.${String(bps % 100).padStart(2, "0").replace(/0+$/, "")}` : ""}`;
}
export interface TriggerAdapter { label: string; hasAmount: boolean; getStableTriggerIdentity(context: TriggerContext): string }
export const triggerRegistry = {
  time: { label: "Waktu tertentu", hasAmount: false, getStableTriggerIdentity: (context: TriggerContext) => context.identity },
  transaction_posted: { label: "Transaksi terjadi", hasAmount: true, getStableTriggerIdentity: (context: TriggerContext) => validId(context.rootActivityId) },
} satisfies Record<Trigger["namespace"],TriggerAdapter>;
export interface ConditionAdapter { label: string; operators: Operator[]; read(context: TriggerContext): string | undefined }
export const conditionRegistry: Record<ConditionField, ConditionAdapter> = {
  transaction_type: { label: "Jenis transaksi", operators: ["equals", "not_equals"], read: (context) => context.kind },
  source_asset: { label: "Aset sumber", operators: ["equals", "not_equals"], read: (context) => context.sourceAssetId },
  destination_asset: { label: "Aset tujuan", operators: ["equals", "not_equals"], read: (context) => context.destinationAssetId },
  transaction_category: { label: "Kategori transaksi", operators: ["equals", "not_equals"], read: (context) => context.categoryId },
  currency: { label: "Mata uang", operators: ["equals", "not_equals"], read: (context) => context.currency },
  base_amount: { label: "Nominal pokok", operators: ["equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "between"], read: (context) => context.amountMinor },
};
export const actionRegistry = {
  income: { label: "Pemasukan", source: false, destination: true },
  expense: { label: "Pengeluaran", source: true, destination: false },
  transfer: { label: "Transfer", source: true, destination: true },
};
export const amountRegistry = {
  fixed: { label: "Nominal tetap", needsTriggerAmount: false },
  percentage_of_trigger: { label: "Persentase nominal pemicu", needsTriggerAmount: true },
  trigger_amount: { label: "Sama dengan nominal pemicu", needsTriggerAmount: true },
  confirm_at_runtime: { label: "Isi saat konfirmasi", needsTriggerAmount: false },
};
export function capabilities(rule: Pick<GeneralRuleInput, "trigger" | "conditions" | "conditionMode" | "actions">) {
  let possibleKinds = kinds;
  if (rule.trigger.namespace === "transaction_posted") {
    if (rule.trigger.activityKind) possibleKinds = [rule.trigger.activityKind];
    if (rule.conditionMode === "ALL") for (const item of rule.conditions) {
      if (item.field === "transaction_type" && item.operator === "equals") possibleKinds = possibleKinds.filter((kind) => kind === item.value);
    }
  }
  const references: AssetReference["strategy"][] = ["configured_asset"];
  if (rule.trigger.namespace === "transaction_posted" && possibleKinds.length) {
    if (possibleKinds.every((kind) => kind !== "income")) references.push("trigger_source_asset");
    if (possibleKinds.every((kind) => kind !== "expense")) references.push("trigger_destination_asset");
  }
  const amountStrategies = (Object.keys(amountRegistry) as AmountStrategy["strategy"][])
    .filter((strategy) => rule.trigger.namespace !== "time" || !amountRegistry[strategy].needsTriggerAmount);
  const action = rule.actions[0];
  const automatic = rule.trigger.namespace === "time" && action?.amount.strategy === "fixed" &&
    [action.source, action.destination].every((ref) => !ref || ref.strategy === "configured_asset");
  return { references, amountStrategies, executions: automatic ? ["confirm_before_execute", "automatic"] as const : ["confirm_before_execute"] as const,
    conditionFields: rule.trigger.namespace === "transaction_posted" ? Object.keys(conditionRegistry) as ConditionField[] : [] };
}
function normalizeReference(ref: AssetReference | undefined, allowed: AssetReference["strategy"][]): AssetReference {
  if (!ref || !referenceNames.includes(ref.strategy) || !allowed.includes(ref.strategy)) throw new ComposableError("Referensi aset tidak tersedia untuk pemicu ini.");
  return ref.strategy === "configured_asset" ? { strategy: ref.strategy, assetId: validId(ref.assetId) } : { strategy: ref.strategy };
}
export function normalizeGeneralRule(raw: GeneralRuleInput): GeneralRuleInput {
  if (!raw || typeof raw.title !== "string" || !raw.title.trim() || raw.title.trim().length > 120) throw new ComposableError("Nama otomatisasi harus 1–120 karakter.");
  if (!raw.trigger || !Object.hasOwn(triggerRegistry, raw.trigger.namespace)) throw new ComposableError("Pilih pemicu.");
  if (!["ALL", "ANY"].includes(raw.conditionMode) || !Array.isArray(raw.conditions) || raw.conditions.length > 20) throw new ComposableError("Grup kondisi tidak valid.");
  if (!Array.isArray(raw.actions) || raw.actions.length !== 1) throw new ComposableError("V1 memerlukan tepat satu tindakan.");
  if (!["confirm_before_execute", "automatic"].includes(raw.execution)) throw new ComposableError("Kebijakan eksekusi tidak valid.");
  let trigger: Trigger;
  if (raw.trigger.namespace === "time") {
    const schedule = raw.trigger.schedule;
    if (!schedule || !["once", "daily", "weekdays", "weekly", "monthly_day", "monthly_last_day"].includes(schedule.frequency)) throw new ComposableError("Jadwal tidak valid.");
    dateOnly(schedule.startOn); if (schedule.endOn) dateOnly(schedule.endOn);
    if (schedule.endOn && schedule.endOn < schedule.startOn) throw new ComposableError("Tanggal akhir mendahului tanggal mulai.");
    scheduledAt(schedule.startOn, schedule.localTime);
    if (schedule.frequency === "weekly" && (!Number.isInteger(schedule.weekday) || schedule.weekday! < 1 || schedule.weekday! > 7)) throw new ComposableError("Pilih hari mingguan.");
    if (schedule.frequency === "monthly_day" && (!Number.isInteger(schedule.monthDay) || schedule.monthDay! < 1 || schedule.monthDay! > 28)) throw new ComposableError("Tanggal bulanan harus 1–28.");
    trigger = { namespace: "time", schedule: { frequency: schedule.frequency, startOn: schedule.startOn, localTime: schedule.localTime,
      endOn: schedule.endOn || undefined, weekday: schedule.frequency === "weekly" ? schedule.weekday : undefined,
      monthDay: schedule.frequency === "monthly_day" ? schedule.monthDay : undefined } };
  } else {
    if (raw.trigger.activityKind && !kinds.includes(raw.trigger.activityKind)) throw new ComposableError("Jenis pemicu transaksi tidak valid.");
    trigger = { namespace: "transaction_posted", ...(raw.trigger.activityKind ? { activityKind: raw.trigger.activityKind } : {}) };
  }
  const conditions = raw.conditions.map((item): Condition => {
    if (!item || !Object.hasOwn(conditionRegistry, item.field) || !conditionRegistry[item.field].operators.includes(item.operator) || typeof item.value !== "string") throw new ComposableError("Kondisi tidak valid.");
    if (item.field === "base_amount") {
      const threshold=(raw:unknown)=>{if(typeof raw!=="string"||assertStoredMinor(parseMinor(raw))<0n)throw new ComposableError("Batas nominal harus nol atau lebih.");return raw;};
      const value = threshold(item.value), upperValue = item.operator === "between" ? threshold(item.upperValue) : undefined;
      if (upperValue && BigInt(upperValue) < BigInt(value)) throw new ComposableError("Batas nominal terbalik.");
      if (!item.currency || !/^[A-Z]{3}$/.test(item.currency)) throw new ComposableError("Pilih mata uang kondisi nominal.");
      return { field: item.field, operator: item.operator, value, upperValue, currency: item.currency };
    }
    if (["source_asset", "destination_asset", "transaction_category"].includes(item.field)) validId(item.value);
    if (item.field === "transaction_type" && !kinds.includes(item.value as ActivityKind)) throw new ComposableError("Jenis transaksi kondisi tidak valid.");
    if (item.field === "currency" && !/^[A-Z]{3}$/.test(item.value)) throw new ComposableError("Mata uang kondisi tidak valid.");
    return { field: item.field, operator: item.operator, value: item.value };
  });
  const meta = capabilities({ ...raw, trigger, conditions });
  if (conditions.some((item) => !meta.conditionFields.includes(item.field))) throw new ComposableError("Pemicu ini tidak menyediakan field kondisi transaksi.");
  const item = raw.actions[0];
  if (!item || !Object.hasOwn(actionRegistry, item.kind) || !item.amount || !meta.amountStrategies.includes(item.amount.strategy)) throw new ComposableError("Tindakan atau strategi nominal tidak cocok.");
  const requirements = actionRegistry[item.kind];
  if ((!requirements.source && item.source) || (!requirements.destination && item.destination)) throw new ComposableError("Tindakan memakai referensi aset yang tidak sesuai.");
  const source = requirements.source ? normalizeReference(item.source, meta.references) : undefined;
  const destination = requirements.destination ? normalizeReference(item.destination, meta.references) : undefined;
  if (source && destination && JSON.stringify(source) === JSON.stringify(destination)) throw new ComposableError("Aset sumber dan tujuan transfer harus berbeda.");
  let amount: AmountStrategy;
  if (item.amount.strategy === "fixed") {
    if (!/^[A-Z]{3}$/.test(item.amount.currency)) throw new ComposableError("Mata uang nominal tidak valid.");
    amount = { strategy: "fixed", amountMinor: positiveMinor(item.amount.amountMinor), currency: item.amount.currency };
  } else if (item.amount.strategy === "percentage_of_trigger") {
    const percentageBps = item.amount.percentageBps;
    if (!Number.isInteger(percentageBps) || percentageBps < 1 || percentageBps > 10000) throw new ComposableError("Persentase harus 0,01–100%.");
    amount = { strategy: item.amount.strategy, percentageBps };
  } else amount = { strategy: item.amount.strategy };
  if (!Array.isArray(item.charges) || item.charges.length > 20) throw new ComposableError("Biaya tambahan tidak valid.");
  if ((item.charges.length || item.transferFeeMinor) && item.amount.strategy !== "fixed" && ![source, destination].some((ref) => ref?.strategy === "configured_asset")) throw new ComposableError("Biaya memerlukan mata uang yang pasti dari nominal tetap atau aset terkonfigurasi.");
  if (item.kind !== "expense" && item.charges.length || item.kind !== "transfer" && item.transferFeeMinor || item.kind === "transfer" && item.categoryId) throw new ComposableError("Kategori atau biaya tidak sesuai dengan tindakan.");
  if (typeof item.note !== "undefined" && (typeof item.note !== "string" || item.note.length > 1000)) throw new ComposableError("Catatan terlalu panjang.");
  const action: FinancialAction = { kind: item.kind, source, destination, amount, categoryId: item.categoryId ? validId(item.categoryId) : undefined,
    charges: item.charges.map((charge) => ({ typeId: validId(charge.typeId), amountMinor: positiveMinor(charge.amountMinor) })),
    transferFeeMinor: item.transferFeeMinor ? positiveMinor(item.transferFeeMinor) : undefined, note: item.note?.trim() || undefined };
  const result: GeneralRuleInput = { title: raw.title.trim(), automationCategoryId: raw.automationCategoryId ? validId(raw.automationCategoryId) : undefined,
    trigger, conditionMode: raw.conditionMode, conditions, actions: [action], execution: raw.execution };
  if (!capabilities(result).executions.some((policy) => policy === raw.execution)) throw new ComposableError("Kombinasi ini wajib meminta konfirmasi.");
  return result;
}
export function evaluateConditions(rule: GeneralRuleInput, context: TriggerContext) {
  const results = rule.conditions.map((condition) => {
    const value = conditionRegistry[condition.field].read(context);
    let matched = false;
    if (value !== undefined && (condition.field !== "base_amount" || condition.currency === context.currency)) {
      const left = condition.field === "base_amount" ? BigInt(value) : value;
      const right = condition.field === "base_amount" ? BigInt(condition.value) : condition.value;
      switch (condition.operator) {
        case "equals": matched = left === right; break;
        case "not_equals": matched = left !== right; break;
        case "greater_than": matched = left > right; break;
        case "greater_or_equal": matched = left >= right; break;
        case "less_than": matched = left < right; break;
        case "less_or_equal": matched = left <= right; break;
        case "between": matched = left >= right && BigInt(value) <= BigInt(condition.upperValue!); break;
      }
    }
    return { ...condition, actual: value ?? null, matched };
  });
  const kindMatches = rule.trigger.namespace !== "transaction_posted" || !rule.trigger.activityKind || rule.trigger.activityKind === context.kind;
  const matched = kindMatches && (!results.length || (rule.conditionMode === "ALL" ? results.every((item) => item.matched) : results.some((item) => item.matched)));
  return { mode: rule.conditionMode, matched, results };
}
export function resolveAsset(ref: AssetReference | undefined, context: TriggerContext): string | undefined {
  if (!ref) return undefined;
  const id = ref.strategy === "configured_asset" ? ref.assetId : ref.strategy === "trigger_source_asset" ? context.sourceAssetId : context.destinationAssetId;
  if (!id) throw new ComposableError("Pemicu tidak menyediakan aset yang dirujuk.");
  return validId(id);
}
export interface AmountAdapter { resolve(amount: AmountStrategy, context: TriggerContext, runtime?: string): string | undefined }
export const amountAdapters: Record<AmountStrategy["strategy"],AmountAdapter> = {
  fixed: { resolve: (amount) => { if(amount.strategy!=="fixed")throw new ComposableError("Strategi nominal tidak cocok.");return positiveMinor(amount.amountMinor); } },
  confirm_at_runtime: { resolve: (_amount,_context,runtime) => runtime===undefined?undefined:positiveMinor(runtime) },
  trigger_amount: { resolve: (_amount,context) => positiveMinor(context.amountMinor) },
  percentage_of_trigger: { resolve: (amount,context) => {
    if(amount.strategy!=="percentage_of_trigger" || !Number.isInteger(amount.percentageBps) || amount.percentageBps<1 || amount.percentageBps>10000)throw new ComposableError("Persentase tidak valid.");
    return positiveMinor((BigInt(positiveMinor(context.amountMinor))*BigInt(amount.percentageBps)/10000n).toString());
  } },
};
export function calculateAmount(amount: AmountStrategy, context: TriggerContext, runtime?: string): string | undefined {
  return amountAdapters[amount.strategy].resolve(amount,context,runtime);
}
export function actionDraft(action: FinancialAction, context: TriggerContext, runtime?: string): ActivityDraft {
  const amountMinor = calculateAmount(action.amount, context, runtime);
  if (!amountMinor) throw new ComposableError("Isi nominal saat konfirmasi.");
  const sourceAssetId = resolveAsset(action.source, context), destinationAssetId = resolveAsset(action.destination, context);
  if (sourceAssetId && sourceAssetId === destinationAssetId) throw new ComposableError("Aset transfer harus berbeda.");
  return { kind: action.kind, amountMinor, sourceAssetId, destinationAssetId, categoryId: action.categoryId,
    charges: action.charges, transferFeeMinor: action.transferFeeMinor, note: action.note, occurredAt: context.occurredAt };
}
export function timeOccurrences(schedule: TimeConfiguration, from: string, through: string): string[] {
  const dates: string[] = [];
  for (let day = from; day <= through; day = addDays(day, 1)) {
    if (schedule.frequency === "once" ? day === schedule.startOn : occursOn({ ...schedule, frequency: schedule.frequency }, day)) dates.push(scheduledAt(day, schedule.localTime));
  }
  return dates;
}
