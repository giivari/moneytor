import { formatMinor } from "../finance/format.ts";

export type CurrencyTotal = { currency: string; exponent: number; amountMinor: bigint };

/** Sums amounts per currency. Items mapped to null are skipped. IDR first, then by currency code. */
export function sumByCurrency<T>(
  items: readonly T[],
  pick: (item: T) => { currency: string; exponent: number; amountMinor: bigint } | null,
): CurrencyTotal[] {
  const totals = new Map<string, CurrencyTotal>();
  for (const item of items) {
    const value = pick(item);
    if (!value) continue;
    const entry = totals.get(value.currency) ?? { currency: value.currency, exponent: value.exponent, amountMinor: 0n };
    entry.amountMinor += value.amountMinor;
    totals.set(value.currency, entry);
  }
  return [...totals.values()].sort((a, b) =>
    a.currency === b.currency ? 0 : a.currency === "IDR" ? -1 : b.currency === "IDR" ? 1 : a.currency < b.currency ? -1 : 1);
}

/** Totals for several currencies in one cell, e.g. "Rp10.000.000 · USD 500,00". Never mixes amounts across currencies. */
export function formatCurrencyTotals(totals: readonly CurrencyTotal[], emptyCurrency = "IDR", emptyExponent = 0): string {
  if (!totals.length) return formatMinor(0n, emptyCurrency, emptyExponent);
  return totals.map((total) => formatMinor(total.amountMinor, total.currency, total.exponent)).join(" · ");
}

/** Label suffix naming the currency when exactly one is present, e.g. "(IDR)"; empty for mixed or no currencies. */
export function currencyLabelSuffix(totals: readonly CurrencyTotal[]): string {
  return totals.length === 1 ? ` (${totals[0].currency})` : "";
}
