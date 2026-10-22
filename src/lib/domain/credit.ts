import type { FinanceAsset } from "@/lib/finance/types";

const CREDIT_TAG_RE = /^\[CREDIT(?::due=(\d{1,2}))?\]\s*/i;
const CREDIT_NAME_RE =
  /\b(spaylater|shopee\s*pay\s*later|gopay\s*later|pay\s*later|kredivo|akulaku|indodana|atome|home\s*credit|kartu\s+kredit|credit\s+card)\b/i;

export type CreditMeta = Readonly<{
  isCreditFlagged: boolean;
  dueDay: number | null;
  cleanNote: string;
}>;

export function parseCreditMeta(note?: string | null): CreditMeta {
  const raw = (note ?? "").trim();
  const match = raw.match(CREDIT_TAG_RE);
  if (!match) {
    return { isCreditFlagged: false, dueDay: null, cleanNote: raw };
  }
  const parsedDay = match[1] ? Number(match[1]) : null;
  const dueDay =
    parsedDay !== null && Number.isInteger(parsedDay) && parsedDay >= 1 && parsedDay <= 31
      ? parsedDay
      : null;
  return {
    isCreditFlagged: true,
    dueDay,
    cleanNote: raw.slice(match[0].length).trim(),
  };
}

export function encodeCreditNote(
  cleanNote: string,
  isCredit: boolean,
  dueDay?: number | null,
): string | undefined {
  const stripped = parseCreditMeta(cleanNote).cleanNote;
  if (!isCredit) {
    return stripped || undefined;
  }
  const validDay =
    dueDay && Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : null;
  const prefix = validDay ? `[CREDIT:due=${validDay}]` : "[CREDIT]";
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

export function creditBillMinor(balanceMinor: string): bigint {
  const balance = BigInt(balanceMinor);
  return balance < 0n ? -balance : 0n;
}

export function nextMonthlyDueDayIso(dueDay: number, monthOffset = 0): string {
  const safeDay = Math.min(31, Math.max(1, Math.trunc(dueDay || 25)));
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

  const extraOffset = monthOffset === 0 && currentDay > safeDay ? 1 : monthOffset;
  const totalMonths = (baseYear * 12 + (baseMonth - 1)) + extraOffset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonthIndex = totalMonths % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonthIndex + 1, 0)).getUTCDate();
  const clampedDay = Math.min(safeDay, daysInTargetMonth);

  return `${targetYear}-${String(targetMonthIndex + 1).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

export function splitInstallmentMinor(totalMinorStr: string, months: number): {
  firstMonthMinor: string;
  futureInstallmentsMinor: string[];
} {
  const count = Math.max(1, Math.trunc(months));
  const total = BigInt(totalMinorStr);
  if (count <= 1 || total <= 0n) {
    return { firstMonthMinor: total.toString(), futureInstallmentsMinor: [] };
  }
  const n = BigInt(count);
  const base = total / n;
  const remainder = total % n;
  const first = base + remainder;
  const future = Array.from({ length: count - 1 }, () => base.toString()).filter((v) => BigInt(v) > 0n);
  return {
    firstMonthMinor: first.toString(),
    futureInstallmentsMinor: future,
  };
}
