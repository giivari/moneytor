import type { FinanceAsset } from "@/lib/finance/types";
import { stripAssetMetaTags } from "./asset-terms.ts";

const CREDIT_TAG_RE = /^\[CREDIT(?::([^\]]*))?\]\s*/i;

/**
 * One amount of a credit account that is billed in a specific due month (`period`, YYYY-MM).
 *
 * - `offLedger: false`: part of the ledger balance that belongs to a later bill (a purchase after the
 *   cutoff, or the principal of installments 2..N of a top-up).
 * - `offLedger: true`: owed but not in the ledger yet (interest of later installments, or installments
 *   2..N of an installment purchase whose first installment is the only posted part).
 *
 * `ref` is the first 8 hex digits of the activity that created the amount, or null for amounts typed in
 * the asset form or converted from older notes. Amounts whose period has arrived are simply part of the
 * current bill, so rollover needs no rewrite.
 */
export type ScheduledCharge = Readonly<{ period: string; amountMinor: bigint; ref: string | null; offLedger: boolean }>;

export type CreditMeta = Readonly<{
  isCreditFlagged: boolean;
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  /** Unpaid amount not explained by the ledger balance (opening debt typed in the asset form). */
  carryCurrentMinor: bigint;
  schedule: readonly ScheduledCharge[];
  cleanNote: string;
}>;

export type CreditNoteState = Readonly<{
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  carryCurrentMinor: bigint;
  schedule: readonly ScheduledCharge[];
}>;

/** Prefix of planning reminders whose amounts are already inside a credit account's bills. */
export const CREDIT_REMINDER_NOTE_PREFIX = "Pengingat tagihan kredit:";

function clampDay(n: number, fallback: number): number {
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : fallback;
}

function parseBigIntSafe(raw?: string | null): bigint {
  if (!raw) return 0n;
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

function parseBase36(raw: string): bigint {
  return [...raw].reduce((acc, digit) => acc * 36n + BigInt(parseInt(digit, 36)), 0n);
}

// ---- periods (due months) ----------------------------------------------------------------------

function periodIndex(period: string): number {
  const [year, month] = period.split("-").map(Number);
  return year * 12 + (month - 1);
}
function periodFromIndex(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}
/** Due month (YYYY-MM) of a due date or any ISO date. */
export function creditPeriodOf(iso: string): string {
  return iso.slice(0, 7);
}
export function addCreditPeriods(period: string, months: number): string {
  return periodFromIndex(periodIndex(period) + months);
}
function dueIsoInPeriod(index: number, dueDay: number): string {
  const year = Math.floor(index / 12);
  const monthIndex = index % 12;
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(dueDay, days)).padStart(2, "0")}`;
}

/** Due month whose statement an outflow on `occurredAtIso` lands in under the automatic cutoff rule. */
export function autoCreditPeriodFor(occurredAtIso: string, dueDay: number, cutoffDay: number): string | null {
  const date = jakartaDateIso(occurredAtIso);
  if (!date) return null;
  const base = periodIndex(date);
  for (let offset = -1; offset <= 3; offset++) {
    const dueIso = dueIsoInPeriod(base + offset, dueDay);
    if (date <= closingCutoffIsoForDue(dueIso, cutoffDay) && date <= dueIso) return periodFromIndex(base + offset);
  }
  return periodFromIndex(base + 1);
}

// ---- tag encoding ------------------------------------------------------------------------------

const TOKEN_RE = /^(?:([0-9a-f]{8})@)?(\d{4})(\d{2})~([0-9a-z]+)(?:\*(\d{1,2}))?(\+)?$/;

/** Owner of amounts converted from the older single-bucket deferral; only these use the cutoff-date fallback. */
export const LEGACY_DEFERRED_REF = "00000000";

/** Short, stable reference of an activity id used inside the credit tag. */
export function creditActivityRef(activityId: string): string {
  return activityId.replace(/-/g, "").slice(0, 8).toLowerCase();
}

function parseSchedule(raw: string | undefined): ScheduledCharge[] {
  if (!raw) return [];
  const schedule: ScheduledCharge[] = [];
  for (const token of raw.split(".")) {
    const match = token.match(TOKEN_RE);
    if (!match) continue;
    const amountMinor = parseBase36(match[4]);
    const month = Number(match[3]);
    if (amountMinor <= 0n || month < 1 || month > 12) continue;
    const count = match[5] ? Math.min(36, Math.max(1, Number(match[5]))) : 1;
    const start = `${match[2]}-${match[3]}`;
    for (let k = 0; k < count; k++) {
      schedule.push({ period: addCreditPeriods(start, k), amountMinor, ref: match[1] ?? null, offLedger: Boolean(match[6]) });
    }
  }
  return schedule;
}

/** Run-length encodes consecutive months that share owner, kind and amount ("ref@202612~255s*11+"). */
function encodeSchedule(schedule: readonly ScheduledCharge[]): string {
  const sorted = [...schedule].filter((entry) => entry.amountMinor > 0n).sort((a, b) =>
    (a.ref ?? "").localeCompare(b.ref ?? "") || Number(a.offLedger) - Number(b.offLedger) || a.period.localeCompare(b.period));
  const tokens: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    const first = sorted[index];
    let count = 1;
    while (index + count < sorted.length && count < 36) {
      const candidate = sorted[index + count];
      if (candidate.ref !== first.ref || candidate.offLedger !== first.offLedger || candidate.amountMinor !== first.amountMinor
        || candidate.period !== addCreditPeriods(first.period, count)) break;
      count++;
    }
    tokens.push(`${first.ref ? `${first.ref}@` : ""}${first.period.replace("-", "")}~${first.amountMinor.toString(36)}${count > 1 ? `*${count}` : ""}${first.offLedger ? "+" : ""}`);
    index += count;
  }
  return tokens.join(".");
}

const DEFAULT_META = {
  dueDay: 1,
  cutoffDay: 20,
  limitMinor: 0n,
  carryCurrentMinor: 0n,
  schedule: [] as ScheduledCharge[],
};

/**
 * Reads the [CREDIT:...] tag. Notes written before monthly schedules (`next=`, `def=`, `dl=`, `anchor=`)
 * are converted: those amounts belong to the bill after the anchored one. A note without an anchor (the
 * oldest format) is read as "next bill as of `now`", as it always behaved.
 */
export function parseCreditMeta(note?: string | null, now: Date = new Date()): CreditMeta {
  const raw = (note ?? "").trim();
  const match = raw.match(CREDIT_TAG_RE);
  if (!match) {
    return { isCreditFlagged: false, ...DEFAULT_META, cleanNote: stripAssetMetaTags(raw) };
  }

  const params = new Map<string, string>();
  for (const part of (match[1] ?? "").split(",")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) params.set(k.trim().toLowerCase(), v.trim());
  }

  const dueDay = clampDay(Number(params.get("due")), 1);
  const defaultCutoff = dueDay <= 10 ? 20 : Math.max(1, dueDay - 10);
  const cutoffDay = clampDay(Number(params.get("cutoff")), defaultCutoff);
  const limitMinor = parseBigIntSafe(params.get("limit"));
  let carryCurrentMinor = parseBigIntSafe(params.get("cur"));
  const schedule = parseSchedule(params.get("sch"));

  // Legacy single-bucket fields.
  const legacyNext = parseBigIntSafe(params.get("next"));
  const legacyDeferred = parseBigIntSafe(params.get("def"));
  if (legacyNext > 0n || legacyDeferred > 0n) {
    const rawAnchor = params.get("anchor");
    const anchor = rawAnchor && /^\d{4}-\d{2}-\d{2}$/.test(rawAnchor) ? rawAnchor : nextMonthlyDueDayIso(dueDay, 0, now);
    const period = addCreditPeriods(creditPeriodOf(anchor), 1);
    if (legacyNext > 0n) {
      // `next` was owed on top of the balance; folding it into carryCurrent keeps the total unchanged.
      carryCurrentMinor += legacyNext;
      schedule.push({ period, amountMinor: legacyNext, ref: null, offLedger: false });
    }
    if (legacyDeferred > 0n) {
      let known = 0n;
      for (const token of (params.get("dl") ?? "").split(".")) {
        const entry = token.match(/^([0-9a-f]{8})~([0-9a-z]+)$/);
        if (!entry) continue;
        const part = parseBase36(entry[2]);
        if (part <= 0n || known + part > legacyDeferred) continue;
        known += part;
        schedule.push({ period, amountMinor: part, ref: entry[1], offLedger: false });
      }
      if (legacyDeferred > known) schedule.push({ period, amountMinor: legacyDeferred - known, ref: LEGACY_DEFERRED_REF, offLedger: false });
    }
  }

  return {
    isCreditFlagged: true,
    dueDay,
    cutoffDay,
    limitMinor: limitMinor > 0n ? limitMinor : 0n,
    carryCurrentMinor,
    schedule,
    cleanNote: stripAssetMetaTags(raw.slice(match[0].length)),
  };
}

export function encodeCreditNote(
  cleanNote: string,
  isCredit: boolean,
  options?: Partial<CreditNoteState>,
): string | undefined {
  const stripped = stripAssetMetaTags(cleanNote);
  if (!isCredit) {
    return stripped || undefined;
  }
  const due = clampDay(Number(options?.dueDay ?? 1), 1);
  const cutoff = clampDay(Number(options?.cutoffDay ?? 20), 20);
  const lim = options?.limitMinor && options.limitMinor > 0n ? options.limitMinor : 0n;
  const cur = options?.carryCurrentMinor ?? 0n;
  const sch = encodeSchedule(options?.schedule ?? []);

  const kv = [`due=${due}`, `cutoff=${cutoff}`];
  if (lim > 0n) kv.push(`limit=${lim.toString()}`);
  if (cur !== 0n) kv.push(`cur=${cur.toString()}`);
  if (sch) kv.push(`sch=${sch}`);

  const prefix = `[CREDIT:${kv.join(",")}]`;
  return stripped ? `${prefix} ${stripped}` : prefix;
}

function stateOf(meta: CreditMeta): CreditNoteState {
  return {
    dueDay: meta.dueDay,
    cutoffDay: meta.cutoffDay,
    limitMinor: meta.limitMinor,
    carryCurrentMinor: meta.carryCurrentMinor,
    schedule: meta.schedule,
  };
}

/**
 * Folds amounts whose due month has arrived into the plain balance: ledger parts need nothing, off-ledger
 * parts move into carryCurrent. Bills are unchanged. Owned amounts are kept unless `includeOwned`, so a
 * later void can still remove them exactly.
 */
export function compactCreditState(state: CreditNoteState, now: Date = new Date(), includeOwned = false): CreditNoteState {
  const current = creditPeriodOf(nextMonthlyDueDayIso(state.dueDay, 0, now));
  let carry = state.carryCurrentMinor;
  const schedule: ScheduledCharge[] = [];
  for (const entry of state.schedule) {
    if (entry.period <= current && (includeOwned || entry.ref === null)) {
      if (entry.offLedger) carry += entry.amountMinor;
      continue;
    }
    schedule.push(entry);
  }
  return { ...state, carryCurrentMinor: carry, schedule };
}

/** Encodes the note within `maxLength`, shedding detail in steps that never change the bills. */
export function fitCreditNote(cleanNote: string, state: CreditNoteState, now: Date = new Date(), maxLength = 1000): string | undefined {
  let candidate = compactCreditState(state, now);
  let note = encodeCreditNote(cleanNote, true, candidate);
  if (!note || note.length <= maxLength) return note;
  candidate = compactCreditState(candidate, now, true);
  note = encodeCreditNote(cleanNote, true, candidate);
  if (!note || note.length <= maxLength) return note;
  // Last resort: forget owners and merge per month. Void/replace then use the cutoff-date rule.
  const merged = new Map<string, ScheduledCharge>();
  for (const entry of candidate.schedule) {
    const key = `${entry.period}|${entry.offLedger}`;
    const prior = merged.get(key);
    merged.set(key, { period: entry.period, offLedger: entry.offLedger, ref: null, amountMinor: (prior?.amountMinor ?? 0n) + entry.amountMinor });
  }
  note = encodeCreditNote(cleanNote, true, { ...candidate, schedule: [...merged.values()] });
  if (note && note.length > maxLength) throw new Error("Catatan akun kredit terlalu panjang untuk menyimpan jadwal tagihan");
  return note;
}

/** Credit lines and loans: classified by the stored asset class only, never by the account name. */
export function isCreditAsset(asset: Pick<FinanceAsset, "assetClass">): boolean {
  return asset.assetClass === "liability";
}

/** Money owed to the owner (loans given, bills paid on someone's behalf): by the stored asset class only. */
export function isReceivableAsset(asset: Pick<FinanceAsset, "assetClass">): boolean {
  return asset.assetClass === "receivable";
}

/**
 * Assets whose balance can back a planning reserve: active, liquid and spendable cash. Credit lines and
 * receivables are excluded even if their liquid/spendable flags were left on.
 */
export function isReserveSourceAsset(
  asset: Pick<FinanceAsset, "isActive" | "normallyLiquid" | "normallySpendable" | "assetClass">,
): boolean {
  return asset.isActive && asset.normallyLiquid && asset.normallySpendable && !isCreditAsset(asset) && !isReceivableAsset(asset);
}

export type ComputedCreditBills = Readonly<{
  /** Due on currentDueIso, including unpaid amounts of earlier months. */
  currentBillMinor: bigint;
  /** Due on nextDueIso only. */
  nextBillMinor: bigint;
  /** Scheduled for due months after nextDueIso (installments 3..N). */
  laterBillMinor: bigint;
  /** Everything still owed, including later installments. */
  totalUnpaidMinor: bigint;
  /** Paid beyond everything owed; the account then holds the owner's money. */
  overpaidMinor: bigint;
  limitMinor: bigint;
  availableLimitMinor: bigint | null;
  currentDueIso: string;
  nextDueIso: string;
  dueDay: number;
  cutoffDay: number;
}>;

export function computeCreditBills(
  asset: Pick<FinanceAsset, "balanceMinor" | "note"> & Partial<Pick<FinanceAsset, "creditInstallments">>,
  now: Date = new Date(),
): ComputedCreditBills {
  const parsed = parseCreditMeta(asset.note, now);
  // Installment rows are already in the ledger balance; they only say in which due month each part is billed.
  const rows: ScheduledCharge[] = (asset.creditInstallments ?? []).filter((row) => row.status === "scheduled").map((row) => ({
    period: row.period, amountMinor: parseBigIntSafe(row.principalMinor) + parseBigIntSafe(row.interestMinor), ref: null, offLedger: false,
  }));
  const meta = rows.length ? { ...parsed, schedule: [...parsed.schedule, ...rows] } : parsed;
  const balance = parseBigIntSafe(asset.balanceMinor);
  const currentDueIso = nextMonthlyDueDayIso(meta.dueDay, 0, now);
  const nextDueIso = nextMonthlyDueDayIso(meta.dueDay, 1, now);
  const nextPeriod = creditPeriodOf(nextDueIso);

  let offLedger = 0n;
  let scheduledNext = 0n;
  let scheduledLater = 0n;
  for (const entry of meta.schedule) {
    if (entry.offLedger) offLedger += entry.amountMinor;
    if (entry.period === nextPeriod) scheduledNext += entry.amountMinor;
    else if (entry.period > nextPeriod) scheduledLater += entry.amountMinor;
  }

  const rawTotal = meta.carryCurrentMinor + offLedger - balance;
  const totalUnpaidMinor = rawTotal > 0n ? rawTotal : 0n;
  const overpaidMinor = rawTotal < 0n ? -rawTotal : 0n;

  let currentBillMinor: bigint;
  let nextBillMinor: bigint;
  let laterBillMinor: bigint;
  if (totalUnpaidMinor >= scheduledNext + scheduledLater) {
    currentBillMinor = totalUnpaidMinor - scheduledNext - scheduledLater;
    nextBillMinor = scheduledNext;
    laterBillMinor = scheduledLater;
  } else {
    // Paid ahead: earlier bills are settled first, so what is left belongs to the latest months.
    currentBillMinor = 0n;
    laterBillMinor = totalUnpaidMinor < scheduledLater ? totalUnpaidMinor : scheduledLater;
    nextBillMinor = totalUnpaidMinor - laterBillMinor;
  }

  const availableLimitMinor =
    meta.limitMinor > 0n
      ? meta.limitMinor > totalUnpaidMinor
        ? meta.limitMinor - totalUnpaidMinor
        : 0n
      : null;

  return {
    currentBillMinor,
    nextBillMinor,
    laterBillMinor,
    totalUnpaidMinor,
    overpaidMinor,
    limitMinor: meta.limitMinor,
    availableLimitMinor,
    currentDueIso,
    nextDueIso,
    dueDay: meta.dueDay,
    cutoffDay: meta.cutoffDay,
  };
}

/** Settlement state of a credit account shown next to its bills. */
export type CreditAccountStatus = "belum-lunas" | "lunas" | "lebih-bayar";
export const CREDIT_STATUS_LABEL: Readonly<Record<CreditAccountStatus, string>> = {
  "belum-lunas": "Belum lunas",
  lunas: "Lunas",
  "lebih-bayar": "Lebih bayar",
};
export function creditAccountStatus(bills: Pick<ComputedCreditBills, "totalUnpaidMinor" | "overpaidMinor">): CreditAccountStatus {
  if (bills.totalUnpaidMinor > 0n) return "belum-lunas";
  return bills.overpaidMinor > 0n ? "lebih-bayar" : "lunas";
}

export type CreditInstallmentTerms = Readonly<{ count: number; principalMinor: bigint; interestMinor: bigint }>;

/**
 * Credit note state after a posted outflow (ledger impact `impactMinor`) is scheduled.
 *
 * - Single payment, current cycle: nothing to schedule.
 * - Single payment, next cycle: the whole impact is due next month.
 * - Installment top-up (transfer, full principal posted): installment 1 = impact minus future principal;
 *   each later month carries its principal (ledger) and its interest (off-ledger).
 * - Installment purchase (expense, only installment 1 posted): each later month carries principal +
 *   interest off-ledger.
 *
 * Installment 1 is due this cycle, or next cycle when `cycle` is "next"; installment k follows k-1 months later.
 * The result never reads the balance, so a stale balance cannot skew it.
 */
export function scheduleCreditCharge(
  meta: CreditMeta,
  impactMinor: bigint,
  now: Date,
  input: { activityId?: string; cycle: "current" | "next"; kind: "expense" | "transfer"; installments?: CreditInstallmentTerms },
): CreditNoteState {
  const impact = impactMinor > 0n ? impactMinor : 0n;
  const state = stateOf(meta);
  if (impact === 0n) return state;
  const ref = input.activityId ? creditActivityRef(input.activityId) : null;
  const first = addCreditPeriods(creditPeriodOf(nextMonthlyDueDayIso(meta.dueDay, 0, now)), input.cycle === "next" ? 1 : 0);
  const count = input.installments && Number.isInteger(input.installments.count) ? Math.min(36, Math.max(1, input.installments.count)) : 1;
  const added: ScheduledCharge[] = [];
  const add = (period: string, amountMinor: bigint, offLedger: boolean) => {
    if (amountMinor > 0n) added.push({ period, amountMinor, ref, offLedger });
  };

  if (count <= 1 || !input.installments) {
    if (input.cycle === "next") add(first, impact, false);
  } else {
    const principal = input.installments.principalMinor > 0n ? input.installments.principalMinor : 0n;
    const interest = input.installments.interestMinor > 0n ? input.installments.interestMinor : 0n;
    if (input.kind === "transfer") {
      const futurePrincipal = principal * BigInt(count - 1);
      if (futurePrincipal > impact) throw new Error("Pokok cicilan mendatang melebihi nilai transaksi");
      if (input.cycle === "next") add(first, impact - futurePrincipal, false);
      for (let k = 1; k < count; k++) {
        add(addCreditPeriods(first, k), principal, false);
        add(addCreditPeriods(first, k), interest, true);
      }
    } else {
      if (input.cycle === "next") add(first, impact, false);
      for (let k = 1; k < count; k++) add(addCreditPeriods(first, k), principal + interest, true);
    }
  }
  return { ...state, schedule: [...state.schedule, ...added] };
}

/**
 * Credit note state after a credit outflow is voided or corrected, so the schedule never keeps amounts the
 * ledger no longer carries. Amounts owned by the activity are removed exactly, whatever cycle was chosen
 * (automatic or manual). A correction keeps the schedule shape: a fully scheduled outflow moves the
 * difference into its first month; a partly current one keeps the scheduled months and changes the current
 * part. Amounts converted from older notes fall back to the cutoff-date rule. Returns null when
 * nothing changes.
 */
export function releaseCreditCharge(
  meta: CreditMeta,
  input: {
    activityId?: string;
    occurredAtIso: string;
    reversedImpactMinor: bigint;
    replacementActivityId?: string;
    replacementImpactMinor?: bigint;
  },
  now: Date = new Date(),
): CreditNoteState | null {
  if (!meta.isCreditFlagged || meta.schedule.length === 0) return null;
  const reversed = input.reversedImpactMinor > 0n ? input.reversedImpactMinor : 0n;
  const replacement = input.replacementImpactMinor && input.replacementImpactMinor > 0n ? input.replacementImpactMinor : 0n;
  const state = stateOf(meta);
  const ref = input.activityId ? creditActivityRef(input.activityId) : null;
  const owned = ref ? meta.schedule.filter((entry) => entry.ref === ref) : [];

  if (owned.length) {
    const others = meta.schedule.filter((entry) => entry.ref !== ref);
    if (replacement === 0n) return { ...state, schedule: others };
    const nextRef = input.replacementActivityId ? creditActivityRef(input.replacementActivityId) : null;
    const ledger = owned.filter((entry) => !entry.offLedger).sort((a, b) => a.period.localeCompare(b.period))
      .map((entry) => ({ ...entry, ref: nextRef }));
    const offLedger = owned.filter((entry) => entry.offLedger).map((entry) => ({ ...entry, ref: nextRef }));
    const ledgerSum = ledger.reduce((sum, entry) => sum + entry.amountMinor, 0n);
    if (ledger.length && ledgerSum >= reversed) {
      // Fully scheduled: the difference lands in (or is taken from) the earliest months first.
      let delta = replacement - reversed;
      for (let i = 0; i < ledger.length && delta !== 0n; i++) {
        const amount = ledger[i].amountMinor + delta;
        ledger[i] = { ...ledger[i], amountMinor: amount > 0n ? amount : 0n };
        delta = amount < 0n ? amount : 0n;
      }
    } else if (replacement < ledgerSum) {
      // Partly current: shrink the latest months first so the replacement still covers them.
      let excess = ledgerSum - replacement;
      for (let i = ledger.length - 1; i >= 0 && excess > 0n; i--) {
        const cut = ledger[i].amountMinor < excess ? ledger[i].amountMinor : excess;
        ledger[i] = { ...ledger[i], amountMinor: ledger[i].amountMinor - cut };
        excess -= cut;
      }
    }
    return { ...state, schedule: [...others, ...ledger.filter((entry) => entry.amountMinor > 0n), ...offLedger] };
  }

  // Older notes: deferred amounts converted without an owner. The outflow belonged to the month the
  // automatic cutoff rule gives its date. Amounts typed in the asset form are never touched.
  const currentPeriod = creditPeriodOf(nextMonthlyDueDayIso(meta.dueDay, 0, now));
  const period = autoCreditPeriodFor(input.occurredAtIso, meta.dueDay, meta.cutoffDay);
  if (!period || period <= currentPeriod) return null;
  let toRelease = reversed;
  const schedule = meta.schedule.map((entry) => {
    if (toRelease === 0n || entry.ref !== LEGACY_DEFERRED_REF || entry.offLedger || entry.period !== period) return entry;
    const cut = entry.amountMinor < toRelease ? entry.amountMinor : toRelease;
    toRelease -= cut;
    return { ...entry, amountMinor: entry.amountMinor - cut };
  });
  const released = reversed - toRelease;
  if (released === 0n) return null;
  const restored = replacement > 0n ? [{ period, amountMinor: replacement, ref: LEGACY_DEFERRED_REF, offLedger: false }] : [];
  return { ...state, schedule: [...schedule.filter((entry) => entry.amountMinor > 0n), ...restored] };
}

/**
 * Credit note state that makes computeCreditBills report exactly the current and next bills typed in the
 * asset form, given the ledger balance. Months after the next one (later installments) are kept.
 */
export function creditStateForDesiredBills(input: {
  balanceMinor: bigint;
  desiredCurrentMinor: bigint;
  desiredNextMinor: bigint;
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  now?: Date;
  existing?: CreditMeta;
}): CreditNoteState {
  const nextPeriod = creditPeriodOf(nextMonthlyDueDayIso(input.dueDay, 1, input.now ?? new Date()));
  const kept = (input.existing?.schedule ?? []).filter((entry) => entry.period > nextPeriod);
  const keptLedger = kept.reduce((sum, entry) => sum + (entry.offLedger ? 0n : entry.amountMinor), 0n);
  const schedule: ScheduledCharge[] = [
    ...(input.desiredNextMinor > 0n ? [{ period: nextPeriod, amountMinor: input.desiredNextMinor, ref: null, offLedger: false }] : []),
    ...kept,
  ];
  return {
    dueDay: input.dueDay,
    cutoffDay: input.cutoffDay,
    limitMinor: input.limitMinor,
    carryCurrentMinor: input.desiredCurrentMinor + input.desiredNextMinor + keptLedger + input.balanceMinor,
    schedule,
  };
}

/** True when a planning obligation is a reminder for an amount already inside a credit account's bills. */
export function isCreditReminderNote(note?: string | null): boolean {
  return (note ?? "").startsWith(CREDIT_REMINDER_NOTE_PREFIX);
}

export function creditBillMinor(balanceMinor: string, note?: string | null): bigint {
  return computeCreditBills({ balanceMinor, note: note ?? null }).totalUnpaidMinor;
}

export function closingCutoffIsoForDue(dueIso: string, cutoffDay: number): string {
  const safeCutoff = clampDay(cutoffDay, 20);
  const [yearStr, monthStr, dayStr] = dueIso.split("-");
  const dueYear = Number(yearStr);
  const dueMonth = Number(monthStr);
  const dueDay = Number(dayStr);

  let targetYear = dueYear;
  let targetMonth = dueMonth;
  if (safeCutoff >= dueDay) {
    targetMonth = dueMonth - 1;
    if (targetMonth < 1) {
      targetMonth = 12;
      targetYear -= 1;
    }
  }

  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  const clampedDay = Math.min(safeCutoff, daysInTargetMonth);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

export function isAfterCutoffDay(occurredAtIso: string, cutoffDay: number, dueDay?: number, now: Date = new Date()): boolean {
  const d = occurredAtIso ? new Date(occurredAtIso) : new Date();
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");

  if (dueDay !== undefined) {
    const year = parts.find((p) => p.type === "year")?.value ?? "1970";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const dayStr = parts.find((p) => p.type === "day")?.value ?? "01";
    const occurredDateIso = `${year}-${month}-${dayStr}`;
    const currentDueIso = nextMonthlyDueDayIso(dueDay, 0, now);
    const closingCutoffIso = closingCutoffIsoForDue(currentDueIso, cutoffDay);
    return occurredDateIso > closingCutoffIso;
  }

  return day > cutoffDay;
}

export function nextMonthlyDueDayIso(dueDay: number, monthOffset = 0, now: Date = new Date()): string {
  const safeDay = Math.min(31, Math.max(1, Math.trunc(dueDay || 1)));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const baseYear = Number(parts.find((p) => p.type === "year")!.value);
  const baseMonth = Number(parts.find((p) => p.type === "month")!.value);
  const currentDay = Number(parts.find((p) => p.type === "day")!.value);

  const cycleShift = currentDay > safeDay ? 1 : 0;
  const totalMonths = baseYear * 12 + (baseMonth - 1) + cycleShift + monthOffset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(safeDay, daysInTargetMonth);

  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/** Calendar date (YYYY-MM-DD) of an instant in Asia/Jakarta, or null for an invalid instant. */
export function jakartaDateIso(instant: string | Date): string | null {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Amount by which a posted expense/transfer reduces the balance of its source account. */
export function creditSourceImpactMinor(draft: {
  kind: "income" | "expense" | "transfer";
  amountMinor: string;
  transferFeeMinor?: string;
  charges?: readonly { amountMinor: string }[];
}): bigint {
  if (draft.kind === "income") return 0n;
  const base = parseBigIntSafe(draft.amountMinor);
  if (draft.kind === "transfer") return base + parseBigIntSafe(draft.transferFeeMinor);
  return base + (draft.charges ?? []).reduce((sum, charge) => sum + parseBigIntSafe(charge.amountMinor), 0n);
}

export function formatShortDueIso(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00+07:00`).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Jakarta",
    });
  } catch {
    return iso;
  }
}

/**
 * Installment top-up from a credit line (transfer with tenor > 1): the destination receives the full
 * principal today, the nearest bill carries installment 1 (its principal share + interest), and the
 * principal of installments 2..N waits in the next-cycle bucket. Returns that future principal.
 */
export function installmentFuturePrincipalMinor(
  principalMinor: bigint,
  plan: Pick<ReturnType<typeof calculateCreditInstallmentPlan>, "firstMonthTotalMinor" | "monthlyInterestMinor">,
): bigint {
  const firstMonthPrincipal = parseBigIntSafe(plan.firstMonthTotalMinor) - parseBigIntSafe(plan.monthlyInterestMinor);
  const future = principalMinor - firstMonthPrincipal;
  return future > 0n ? future : 0n;
}

export function calculateCreditInstallmentPlan(params: {
  principalMinorStr: string;
  tenorMonths: number;
  interestMode: "percent" | "flat_minor";
  interestRatePercent: number;
  interestFlatMinorStr: string;
}): {
  monthlyPrincipalMinor: string;
  monthlyInterestMinor: string;
  firstMonthTotalMinor: string;
  subsequentMonthTotalMinor: string;
  futureInstallmentsMinor: string[];
  grandTotalMinor: string;
} {
  const count = Math.max(1, Math.trunc(params.tenorMonths));
  const principal = parseBigIntSafe(params.principalMinorStr);
  if (principal <= 0n) {
    return {
      monthlyPrincipalMinor: "0",
      monthlyInterestMinor: "0",
      firstMonthTotalMinor: "0",
      subsequentMonthTotalMinor: "0",
      futureInstallmentsMinor: [],
      grandTotalMinor: "0",
    };
  }

  let monthlyInterest = 0n;
  if (params.interestMode === "percent") {
    const rate = Number.isFinite(params.interestRatePercent) && params.interestRatePercent > 0
      ? params.interestRatePercent
      : 0;
    const bps = BigInt(Math.round(rate * 100));
    monthlyInterest = (principal * bps + 5000n) / 10000n;
  } else {
    monthlyInterest = parseBigIntSafe(params.interestFlatMinorStr);
    if (monthlyInterest < 0n) monthlyInterest = 0n;
  }

  const n = BigInt(count);
  const basePrincipal = principal / n;
  const remainderPrincipal = principal % n;

  const firstMonthTotal = basePrincipal + remainderPrincipal + monthlyInterest;
  const subsequentMonthTotal = basePrincipal + monthlyInterest;
  const futureInstallmentsMinor =
    count > 1
      ? Array.from({ length: count - 1 }, () => subsequentMonthTotal.toString())
      : [];
  const grandTotal = firstMonthTotal + subsequentMonthTotal * BigInt(count - 1);

  return {
    monthlyPrincipalMinor: basePrincipal.toString(),
    monthlyInterestMinor: monthlyInterest.toString(),
    firstMonthTotalMinor: firstMonthTotal.toString(),
    subsequentMonthTotalMinor: subsequentMonthTotal.toString(),
    futureInstallmentsMinor,
    grandTotalMinor: grandTotal.toString(),
  };
}
