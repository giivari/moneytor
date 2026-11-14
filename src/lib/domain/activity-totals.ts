/**
 * Totals over ALL posted activities (not just the rows loaded in the list). Kept pure so the ledger rules stay out of components.
 * Definitions match the Buku Mutasi footer: income = income principal; out = expense principal + charges, plus the charges of
 * transfer/borrow/repay (their principal only moves money between accounts); fee = every charge.
 */
export type ActivityKindRow = Readonly<{ currency: string; exponent: number; kind: string; count: number; baseMinor: string; chargeMinor: string }>;
export type ActivityCurrencyTotals = Readonly<{ currency: string; exponent: number; inMinor: string; outMinor: string; feeMinor: string }>;
export type ActivityTotals = Readonly<{ total: number; counts: Readonly<Record<string, number>>; currencies: readonly ActivityCurrencyTotals[] }>;

const FLOW_KINDS = new Set(["transfer", "borrow", "repay"]);

export function summarizeActivityTotals(rows: readonly ActivityKindRow[]): ActivityTotals {
  const counts: Record<string, number> = {};
  const byCurrency = new Map<string, { exponent: number; inMinor: bigint; outMinor: bigint; feeMinor: bigint }>();
  let total = 0;
  for (const row of rows) {
    total += row.count;
    counts[row.kind] = (counts[row.kind] ?? 0) + row.count;
    const entry = byCurrency.get(row.currency) ?? { exponent: row.exponent, inMinor: 0n, outMinor: 0n, feeMinor: 0n };
    const base = BigInt(row.baseMinor);
    const charges = BigInt(row.chargeMinor);
    entry.feeMinor += charges;
    if (row.kind === "income") entry.inMinor += base;
    else if (row.kind === "expense") entry.outMinor += base + charges;
    else if (FLOW_KINDS.has(row.kind)) entry.outMinor += charges;
    byCurrency.set(row.currency, entry);
  }
  const currencies = [...byCurrency.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({
    currency, exponent: value.exponent, inMinor: value.inMinor.toString(), outMinor: value.outMinor.toString(), feeMinor: value.feeMinor.toString(),
  }));
  return { total, counts, currencies };
}
