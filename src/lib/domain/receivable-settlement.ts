export type SettlementMode = "partial" | "close_with_adjustment";
export type SettlementOutcome = "exact" | "overpaid" | "partial" | "closed_short";

export type ReceivableSettlementPlan = Readonly<{
  /** Transfer receivable -> destination account. */
  transferMinor: bigint;
  /** Rounding difference: income into the destination (overpaid) or expense out of the receivable (closed short). */
  adjustment: Readonly<{ kind: "income" | "expense"; amountMinor: bigint }> | null;
  outcome: SettlementOutcome;
  /** Receivable balance after the plan is posted. Never clamped: it is exact. */
  remainingAfterMinor: bigint;
}>;

export const SETTLEMENT_MODES: readonly SettlementMode[] = ["partial", "close_with_adjustment"];

/**
 * Plans how a (possibly rounded) payment settles a receivable balance.
 * - exact: transfer `received`.
 * - overpaid: transfer `remaining` (balance -> 0) + income of the surplus on the destination.
 * - short + partial: transfer `received`, the rest stays on the receivable.
 * - short + close_with_adjustment: transfer `received` + expense of the shortfall on the receivable (balance -> 0).
 */
export function planReceivableSettlement(input: { remainingMinor: bigint; receivedMinor: bigint; mode: SettlementMode }): ReceivableSettlementPlan {
  const { remainingMinor, receivedMinor, mode } = input;
  if (!SETTLEMENT_MODES.includes(mode)) throw new Error("Mode pelunasan tidak dikenal.");
  if (remainingMinor <= 0n) throw new Error("Piutang ini tidak memiliki sisa saldo untuk dilunasi.");
  if (receivedMinor <= 0n) throw new Error("Nominal diterima harus lebih dari nol.");
  if (receivedMinor === remainingMinor) return { transferMinor: receivedMinor, adjustment: null, outcome: "exact", remainingAfterMinor: 0n };
  if (receivedMinor > remainingMinor) {
    return { transferMinor: remainingMinor, adjustment: { kind: "income", amountMinor: receivedMinor - remainingMinor }, outcome: "overpaid", remainingAfterMinor: 0n };
  }
  const shortfall = remainingMinor - receivedMinor;
  if (mode === "partial") return { transferMinor: receivedMinor, adjustment: null, outcome: "partial", remainingAfterMinor: shortfall };
  return { transferMinor: receivedMinor, adjustment: { kind: "expense", amountMinor: shortfall }, outcome: "closed_short", remainingAfterMinor: 0n };
}
