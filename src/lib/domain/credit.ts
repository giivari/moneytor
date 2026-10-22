import type { FinanceAsset } from "@/lib/finance/types";

const CREDIT_TAG_RE = /^\[CREDIT(?::([^\]]*))?\]\s*/i;
const CREDIT_NAME_RE =
  /\b(spaylater|shopee\s*pay\s*later|gopay\s*later|pay\s*later|kredivo|akulaku|indodana|atome|home\s*credit|kartu\s+kredit|credit\s+card)\b/i;

export type CreditMeta = Readonly<{
  isCreditFlagged: boolean;
  dueDay: number;
  cutoffDay: number;
  limitMinor: bigint;
  carryCurrentMinor: bigint;
  carryNextMinor: bigint;
  deferredMinor: bigint;
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
      cleanNote: raw,
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

  return {
    isCreditFlagged: true,
    dueDay,
    cutoffDay,
    limitMinor: limitMinor > 0n ? limitMinor : 0n,
    carryCurrentMinor,
    carryNextMinor: carryNextMinor > 0n ? carryNextMinor : 0n,
    deferredMinor: deferredMinor > 0n ? deferredMinor : 0n,
    cleanNote: raw.slice(match[0].length).trim(),
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
  },
): string | undefined {
  const stripped = parseCreditMeta(cleanNote).cleanNote;
  if (!isCredit) {
    return stripped || undefined;
  }
  const due = clampDay(Number(options?.dueDay ?? 1), 1);
  const cutoff = clampDay(Number(options?.cutoffDay ?? 20), 20);
  const lim = options?.limitMinor && options.limitMinor > 0n ? options.limitMinor : 0n;
  const cur = options?.carryCurrentMinor ?? 0n;
  const next = options?.carryNextMinor && options.carryNextMinor > 0n ? options.carryNextMinor : 0n;
  const def = options?.deferredMinor && options.deferredMinor > 0n ? options.deferredMinor : 0n;

  const kv = [`due=${due}`, `cutoff=${cutoff}`];
  if (lim > 0n) kv.push(`limit=${lim.toString()}`);
  if (cur !== 0n) kv.push(`cur=${cur.toString()}`);
  if (next > 0n) kv.push(`next=${next.toString()}`);
  if (def > 0n) kv.push(`def=${def.toString()}`);

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
): ComputedCreditBills {
  const meta = parseCreditMeta(asset.note);
  const balance = parseBigIntSafe(asset.balanceMinor);
  const rawTotal = meta.carryCurrentMinor + meta.carryNextMinor - balance;
  const totalUnpaidMinor = rawTotal > 0n ? rawTotal : 0n;
  const scheduledNext = meta.carryNextMinor + meta.deferredMinor;

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

  const currentDueIso = nextMonthlyDueDayIso(meta.dueDay, 0);
  const nextDueIso = nextMonthlyDueDayIso(meta.dueDay, 1);

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

export function isAfterCutoffDay(occurredAtIso: string, cutoffDay: number): boolean {
  const d = occurredAtIso ? new Date(occurredAtIso) : new Date();
  if (Number.isNaN(d.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  return day > cutoffDay;
}

export function nextMonthlyDueDayIso(dueDay: number, monthOffset = 0): string {
  const safeDay = Math.min(31, Math.max(1, Math.trunc(dueDay || 1)));
  const now = new Date();
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
