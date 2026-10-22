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
export function financialAmounts(kind: "income" | "expense" | "transfer", principal: string, charges: string) {
  const base = parseMinor(principal), costs = parseMinor(charges);
  if (base < 0n || costs < 0n) throw Error("Jumlah laporan tidak valid");
  const income = kind === "income" ? base : 0n;
  const expense = kind === "expense" ? base : 0n;
  return { incomeMinor: income.toString(), expensePrincipalMinor: expense.toString(),
    spendingMinor: (expense + costs).toString(), netMinor: (income - expense - costs).toString(),
    transferPrincipalMinor: (kind === "transfer" ? base : 0n).toString() };
}
/** Basis points of percent change; exact integer arithmetic, truncated toward zero. */
export function periodChange(current: string, previous: string) {
  const value = parseMinor(current), baseline = parseMinor(previous), difference = value - baseline;
  return { differenceMinor: difference.toString(), percentageChangeBps: baseline > 0n && value >= 0n
    ? (difference * 10000n / baseline).toString() : null };
}
