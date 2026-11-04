import type { FinanceAsset } from "@/lib/finance/types";
import { stripAssetMetaTags } from "./asset-terms.ts";

const CREDIT_TAG_RE = /^\[CREDIT(?::([^\]]*))?\]\s*/i;
const CREDIT_NAME_RE =
  /(?:spaylater|shopee\s*pay\s*later|gopay\s*later|pay\s*later|paylater|\b(?:kredivo|akulaku|indodana|atome|home\s*credit|kartu\s+kredit|credit\s+card|fasilitas\s+kredit|pinjaman|cicilan|kta|kredit)\b)/i;

export type CreditMeta = Readonly<{
  isCreditFlagged: boolean;
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  carryCurrentMinor: bigint;
  carryNextMinor: bigint;
  deferredMinor: bigint;
  anchorDueIso: string | null;
  cleanNote: string;
}>;

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

export function parseCreditMeta(note?: string | null): CreditMeta {
  const raw = (note ?? "").trim();
  const match = raw.match(CREDIT_TAG_RE);
  if (!match) {
    return {
      isCreditFlagged: false,
      dueDay: 1,
      cutoffDay: 20,
      limitMinor: 0n,
      carryCurrentMinor: 0n,
      carryNextMinor: 0n,
      deferredMinor: 0n,
      anchorDueIso: null,
      cleanNote: stripAssetMetaTags(raw),
    };
  }

  const paramStr = match[1] ?? "";
  const params = new Map<string, string>();
  for (const part of paramStr.split(",")) {
    const [k, v] = part.split("=");
    if (k && v !== undefined) {
      params.set(k.trim().toLowerCase(), v.trim());
    }
  }

  const dueDay = clampDay(Number(params.get("due")), 1);
  const defaultCutoff = dueDay <= 10 ? 20 : Math.max(1, dueDay - 10);
  const cutoffDay = clampDay(Number(params.get("cutoff")), defaultCutoff);
  const limitMinor = parseBigIntSafe(params.get("limit"));
  const carryCurrentMinor = parseBigIntSafe(params.get("cur"));
  const carryNextMinor = parseBigIntSafe(params.get("next"));
  const deferredMinor = parseBigIntSafe(params.get("def"));
  const rawAnchor = params.get("anchor");
  const anchorDueIso = rawAnchor && /^\d{4}-\d{2}-\d{2}$/.test(rawAnchor) ? rawAnchor : null;

  return {
    isCreditFlagged: true,
    dueDay,
    cutoffDay,
    limitMinor: limitMinor > 0n ? limitMinor : 0n,
    carryCurrentMinor,
    carryNextMinor: carryNextMinor > 0n ? carryNextMinor : 0n,
    deferredMinor: deferredMinor > 0n ? deferredMinor : 0n,
    anchorDueIso,
    cleanNote: stripAssetMetaTags(raw.slice(match[0].length)),
  };
}

export function encodeCreditNote(
  cleanNote: string,
  isCredit: boolean,
  options?: {
    dueDay?: number | null;
    cutoffDay?: number | null;
    limitMinor?: bigint;
    carryCurrentMinor?: bigint;
    carryNextMinor?: bigint;
    deferredMinor?: bigint;
    anchorDueIso?: string | null;
  },
): string | undefined {
  const stripped = stripAssetMetaTags(cleanNote);
  if (!isCredit) {
    return stripped || undefined;
  }
  const due = clampDay(Number(options?.dueDay ?? 1), 1);
  const cutoff = clampDay(Number(options?.cutoffDay ?? 20), 20);
  const lim = options?.limitMinor && options.limitMinor > 0n ? options.limitMinor : 0n;
  const cur = options?.carryCurrentMinor ?? 0n;
  const next = options?.carryNextMinor && options.carryNextMinor > 0n ? options.carryNextMinor : 0n;
  const def = options?.deferredMinor && options.deferredMinor > 0n ? options.deferredMinor : 0n;
  const anchor =
    options?.anchorDueIso !== undefined
      ? options.anchorDueIso && /^\d{4}-\d{2}-\d{2}$/.test(options.anchorDueIso)
        ? options.anchorDueIso
        : null
      : nextMonthlyDueDayIso(due, 0);

  const kv = [`due=${due}`, `cutoff=${cutoff}`];
  if (lim > 0n) kv.push(`limit=${lim.toString()}`);
  if (cur !== 0n) kv.push(`cur=${cur.toString()}`);
  if (next > 0n) kv.push(`next=${next.toString()}`);
  if (def > 0n) kv.push(`def=${def.toString()}`);
  if (anchor) kv.push(`anchor=${anchor}`);

  const prefix = `[CREDIT:${kv.join(",")}]`;
  return stripped ? `${prefix} ${stripped}` : prefix;
}

export function isCreditAsset(
  asset: Pick<FinanceAsset, "displayName" | "providerName" | "assetTypeName" | "assetGroupName" | "note">,
): boolean {
  if (parseCreditMeta(asset.note).isCreditFlagged) return true;
  const combined = [
    asset.displayName,
    asset.providerName,
    asset.assetTypeName,
    asset.assetGroupName,
  ]
    .filter(Boolean)
    .join(" ");
  return CREDIT_NAME_RE.test(combined);
}

export function isReceivableAsset(
  asset: Pick<FinanceAsset, "displayName" | "note">,
): boolean {
  return /\b(piutang|talangan|reimburse|split\s*bill)\b/i.test(`${asset.displayName} ${asset.note ?? ""}`);
}

/**
 * Assets whose balance can back a planning reserve: active, liquid and spendable cash. Credit lines and
 * receivables are excluded even if their liquid/spendable flags were left on.
 */
export function isReserveSourceAsset(
  asset: Pick<
    FinanceAsset,
    "isActive" | "normallyLiquid" | "normallySpendable" | "displayName" | "providerName" | "assetTypeName" | "assetGroupName" | "note"
  >,
): boolean {
  return asset.isActive && asset.normallyLiquid && asset.normallySpendable && !isCreditAsset(asset) && !isReceivableAsset(asset);
}

export type ComputedCreditBills = Readonly<{
  currentBillMinor: bigint;
  nextBillMinor: bigint;
  totalUnpaidMinor: bigint;
  limitMinor: bigint;
  availableLimitMinor: bigint | null;
  currentDueIso: string;
  nextDueIso: string;
  dueDay: number;
  cutoffDay: number;
}>;

export function computeCreditBills(
  asset: Pick<FinanceAsset, "balanceMinor" | "note">,
  now: Date = new Date(),
): ComputedCreditBills {
  const meta = parseCreditMeta(asset.note);
  const balance = parseBigIntSafe(asset.balanceMinor);
  const rawTotal = meta.carryCurrentMinor + meta.carryNextMinor - balance;
  const totalUnpaidMinor = rawTotal > 0n ? rawTotal : 0n;

  const currentDueIso = nextMonthlyDueDayIso(meta.dueDay, 0, now);
  const nextDueIso = nextMonthlyDueDayIso(meta.dueDay, 1, now);

  const hasShifted = isCreditCycleShifted(meta, now);
  const scheduledNext = hasShifted ? 0n : meta.carryNextMinor + meta.deferredMinor;

  let currentBillMinor = 0n;
  let nextBillMinor = 0n;
  if (totalUnpaidMinor >= scheduledNext) {
    currentBillMinor = totalUnpaidMinor - scheduledNext;
    nextBillMinor = scheduledNext;
  } else {
    currentBillMinor = 0n;
    nextBillMinor = totalUnpaidMinor;
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
    totalUnpaidMinor,
    limitMinor: meta.limitMinor,
    availableLimitMinor,
    currentDueIso,
    nextDueIso,
    dueDay: meta.dueDay,
    cutoffDay: meta.cutoffDay,
  };
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

export type CreditNoteState = Readonly<{
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  carryCurrentMinor: bigint;
  carryNextMinor: bigint;
  deferredMinor: bigint;
  anchorDueIso: string | null;
}>;

function noteStateFrom(meta: CreditMeta): CreditNoteState {
  return {
    dueDay: meta.dueDay,
    cutoffDay: meta.cutoffDay,
    limitMinor: meta.limitMinor,
    carryCurrentMinor: meta.carryCurrentMinor,
    carryNextMinor: meta.carryNextMinor,
    deferredMinor: meta.deferredMinor,
    anchorDueIso: meta.anchorDueIso,
  };
}

function monthIndexOfIso(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  return year * 12 + (month - 1);
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

/**
 * True once the bill anchored at `anchorDueIso` is no longer the nearest upcoming bill.
 * From then on every scheduled "next cycle" amount (carryNext + deferred) belongs to the current bill.
 */
export function isCreditCycleShifted(
  meta: Pick<CreditMeta, "dueDay" | "anchorDueIso">,
  now: Date = new Date(),
): boolean {
  if (!meta.anchorDueIso) return false;
  const currentDueIso = nextMonthlyDueDayIso(meta.dueDay, 0, now);
  return monthIndexOfIso(currentDueIso) - monthIndexOfIso(meta.anchorDueIso) >= 1;
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

/**
 * Credit note state after a new outflow of `impactMinor` (already posted to the ledger) is assigned
 * to the next billing cycle. The result never reads the account balance, so it cannot be skewed by a
 * balance read before or after the posting.
 *
 * Invariant: the raw unpaid total grows by exactly `impactMinor` and the next bill grows by `impactMinor`.
 */
export function deferCreditCharge(meta: CreditMeta, impactMinor: bigint, now: Date = new Date()): CreditNoteState {
  const impact = impactMinor > 0n ? impactMinor : 0n;
  const currentDueIso = nextMonthlyDueDayIso(meta.dueDay, 0, now);
  const state = noteStateFrom(meta);
  if (isCreditCycleShifted(meta, now)) {
    // The old "next" bill has become the current bill. carryNext moves into carryCurrent; the old
    // deferred amount already lives in the ledger balance, so a fresh next-cycle bucket starts at impact.
    return {
      ...state,
      carryCurrentMinor: meta.carryCurrentMinor + meta.carryNextMinor,
      carryNextMinor: 0n,
      deferredMinor: impact,
      anchorDueIso: currentDueIso,
    };
  }
  return {
    ...state,
    deferredMinor: meta.deferredMinor + impact,
    anchorDueIso: meta.anchorDueIso ?? currentDueIso,
  };
}

/**
 * Credit note state after a credit outflow is voided or corrected, so the next-cycle bucket does not keep
 * an amount the ledger no longer carries. A reversed outflow counts as deferred when it occurred after the
 * closing cutoff of the anchored bill, the same rule the editor applies automatically. Returns null when
 * nothing has to change.
 */
export function releaseDeferredCreditCharge(
  meta: CreditMeta,
  input: { occurredAtIso: string; reversedImpactMinor: bigint; replacementImpactMinor?: bigint },
  now: Date = new Date(),
): CreditNoteState | null {
  if (!meta.isCreditFlagged || meta.deferredMinor <= 0n || !meta.anchorDueIso) return null;
  if (isCreditCycleShifted(meta, now)) return null;
  const occurredDate = jakartaDateIso(input.occurredAtIso);
  if (!occurredDate || occurredDate <= closingCutoffIsoForDue(meta.anchorDueIso, meta.cutoffDay)) return null;
  const reversed = input.reversedImpactMinor > 0n ? input.reversedImpactMinor : 0n;
  const released = reversed > meta.deferredMinor ? meta.deferredMinor : reversed;
  const replacement = input.replacementImpactMinor && input.replacementImpactMinor > 0n ? input.replacementImpactMinor : 0n;
  const deferredMinor = meta.deferredMinor - released + replacement;
  if (deferredMinor === meta.deferredMinor) return null;
  return { ...noteStateFrom(meta), deferredMinor };
}

/**
 * Credit note state that makes computeCreditBills report exactly the bills typed in the asset form,
 * given the account's current ledger balance.
 */
export function creditStateForDesiredBills(input: {
  balanceMinor: bigint;
  desiredCurrentMinor: bigint;
  desiredNextMinor: bigint;
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  now?: Date;
}): CreditNoteState {
  return {
    dueDay: input.dueDay,
    cutoffDay: input.cutoffDay,
    limitMinor: input.limitMinor,
    carryCurrentMinor: input.desiredCurrentMinor + input.balanceMinor,
    carryNextMinor: input.desiredNextMinor,
    deferredMinor: 0n,
    anchorDueIso: nextMonthlyDueDayIso(input.dueDay, 0, input.now ?? new Date()),
  };
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
