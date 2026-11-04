import { formatMinor } from "./format";

export type CurrencyTotal = { currency: string; exponent: number; amountMinor: bigint };

/** Sums integer minor units per currency without mixing currencies; order follows first appearance. */
export function sumByCurrency<T extends { currency: string; exponent: number }>(rows: T[], value: (row: T) => bigint): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const row of rows) {
    const current = totals.get(row.currency) ?? { currency: row.currency, exponent: row.exponent, amountMinor: 0n };
    current.amountMinor += value(row);
    totals.set(row.currency, current);
  }
  return [...totals.values()];
}

/** Formats per-currency totals for a status bar; an empty set shows a zero in the fallback currency. */
export function formatCurrencyTotals(totals: CurrencyTotal[], sign = "", fallback = { currency: "IDR", exponent: 0 }): string {
  if (!totals.length) return `${sign}${formatMinor("0", fallback.currency, fallback.exponent)}`;
  return totals.map((item) => `${sign}${formatMinor(item.amountMinor.toString(), item.currency, item.exponent)}`).join(" · ");
}
