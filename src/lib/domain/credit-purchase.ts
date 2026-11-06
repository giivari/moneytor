import {
  fitCreditNote,
  parseCreditMeta,
  releaseCreditCharge,
  scheduleCreditCharge,
  type CreditInstallmentTerms,
} from "./credit.ts";

/** One month of an installment purchase in the credit installment schedule. */
export type CreditInstallmentRow = Readonly<{
  activityId: string;
  seq: number;
  /** Due month, YYYY-MM. */
  period: string;
  principalMinor: bigint;
  interestMinor: bigint;
  status: "scheduled" | "cancelled";
}>;

/** What the credit side of an account keeps besides its ledger balance. */
export type CreditAccountState = Readonly<{ note: string | null; installments: readonly CreditInstallmentRow[] }>;

export type InstallmentPlanAmounts = Readonly<{
  monthlyPrincipalMinor: string;
  monthlyInterestMinor: string;
  firstMonthTotalMinor: string;
}>;

/**
 * Amounts the transaction editor posts for an installment expense on a credit account: the draft amount,
 * extra charges, and the installment terms the server schedules.
 */
export function installmentPurchaseRequest(
  plan: InstallmentPlanAmounts,
  tenorMonths: number,
): { amountMinor: string; charges: { typeId: string; amountMinor: string }[]; creditInstallments: { count: number; principalMinor: string; interestMinor: string } } {
  return {
    amountMinor: plan.firstMonthTotalMinor,
    charges: [],
    creditInstallments: { count: tenorMonths, principalMinor: plan.monthlyPrincipalMinor, interestMinor: plan.monthlyInterestMinor },
  };
}

/** Credit state after a posted outflow with ledger impact `impactMinor` is scheduled into its due months. */
export function applyCreditPost(
  state: CreditAccountState,
  input: { activityId: string; impactMinor: bigint; cycle: "current" | "next"; kind: "expense" | "transfer"; installments?: CreditInstallmentTerms },
  now: Date = new Date(),
): CreditAccountState {
  if (input.impactMinor <= 0n) return state;
  const meta = parseCreditMeta(state.note, now);
  const scheduled = scheduleCreditCharge(meta, input.impactMinor, now, {
    activityId: input.activityId, cycle: input.cycle, kind: input.kind, installments: input.installments,
  });
  // fitCreditNote sheds detail (never amounts) to stay within the 1000-character note limit.
  return { ...state, note: fitCreditNote(meta.cleanNote, scheduled, now) ?? null };
}

/** Credit state after an outflow is voided or replaced; null when nothing changes. */
export function applyCreditVoid(
  state: CreditAccountState,
  input: { activityId: string; occurredAtIso: string; reversedImpactMinor: bigint; replacementActivityId?: string; replacementImpactMinor?: bigint },
  now: Date = new Date(),
): CreditAccountState | null {
  const meta = parseCreditMeta(state.note, now);
  if (!meta.isCreditFlagged || meta.schedule.length === 0) return null;
  const released = releaseCreditCharge(meta, input, now);
  if (!released) return null;
  return { ...state, note: fitCreditNote(meta.cleanNote, released, now) ?? null };
}
