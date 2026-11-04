export type SplitBillPlan = Readonly<{
  /** Expense recorded as the owner's own spending (may be 0 when the whole bill is fronted). */
  personalMinor: bigint;
  /** Transfer into the receivable account: money a friend still owes. */
  reimbursedMinor: bigint;
  /** Total that leaves the paying account: personal share + charges + fronted share. */
  sourceOutflowMinor: bigint;
}>;

/**
 * Splits a paid bill into the owner's expense and the portion fronted for someone else.
 * Charges are attached to the personal expense, so they require a personal share.
 */
export function planSplitBill(input: { totalMinor: bigint; reimbursedMinor: bigint; chargesMinor?: bigint }): SplitBillPlan {
  const charges = input.chargesMinor ?? 0n;
  if (input.reimbursedMinor <= 0n || input.reimbursedMinor > input.totalMinor) {
    throw new Error("Nominal talangan harus di antara 1 dan total nominal pembayaran.");
  }
  if (charges < 0n) throw new Error("Biaya tambahan tidak boleh negatif.");
  const personalMinor = input.totalMinor - input.reimbursedMinor;
  if (personalMinor === 0n && charges > 0n) {
    throw new Error("Biaya tambahan memerlukan porsi pribadi. Masukkan biaya ke nominal talangan atau kurangi talangan.");
  }
  return { personalMinor, reimbursedMinor: input.reimbursedMinor, sourceOutflowMinor: personalMinor + charges + input.reimbursedMinor };
}
