import { parseMinor } from "../domain/money.ts";
export type ChargeBucket = "fee" | "tax" | "other";
export const FEE_SYSTEM_KEYS = ["admin_fee", "service_fee", "transfer_fee"];
export const TAX_SYSTEM_KEYS = ["tax"];
/** Catalog identity, never editable display names, determines reporting classification. */
export function chargeBucket(systemKey: string | null): ChargeBucket {
  if (TAX_SYSTEM_KEYS.includes(systemKey ?? "")) return "tax";
  if (FEE_SYSTEM_KEYS.includes(systemKey ?? "")) return "fee";
  return "other";
}
export type AnalyticsKind = "income" | "expense" | "transfer" | "borrow" | "repay" | "refund" | "adjustment";
export function financialAmounts(kind: AnalyticsKind, principal: string, charges: string, adjustment: "in" | "out" = "in") {
  const base = parseMinor(principal), costs = parseMinor(charges);
  if (base < 0n || costs < 0n) throw Error("Jumlah laporan tidak valid");
  const income = kind === "income" ? base : 0n;
  // A refund lowers spending: it is a negative expense principal, never income.
  const expense = kind === "expense" ? base : kind === "refund" ? -base : 0n;
  const pick = (cond: boolean, value: bigint) => (cond ? value : 0n).toString();
  return { incomeMinor: income.toString(), expensePrincipalMinor: expense.toString(),
    spendingMinor: (expense + costs).toString(), netMinor: (income - expense - costs).toString(),
    transferPrincipalMinor: pick(kind === "transfer", base),
    adjustmentInMinor: pick(kind === "adjustment" && adjustment === "in", base),
    adjustmentOutMinor: pick(kind === "adjustment" && adjustment === "out", base),
    debtBorrowedMinor: pick(kind === "borrow", base), debtRepaidMinor: pick(kind === "repay", base) };
}
/** Basis points of percent change; exact integer arithmetic, truncated toward zero. */
export function periodChange(current: string, previous: string) {
  const value = parseMinor(current), baseline = parseMinor(previous), difference = value - baseline;
  return { differenceMinor: difference.toString(), percentageChangeBps: baseline > 0n && value >= 0n
    ? (difference * 10000n / baseline).toString() : null };
}
