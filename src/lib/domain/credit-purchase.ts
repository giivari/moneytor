import type { CreditInstallment } from "@/lib/finance/types";
import {
  addCreditPeriods,
  creditPeriodOf,
  fitCreditNote,
  nextMonthlyDueDayIso,
  parseCreditMeta,
  releaseCreditCharge,
  scheduleCreditCharge,
  type CreditInstallmentTerms,
} from "./credit.ts";

/** One month of an installment purchase in the credit installment schedule. */
export type CreditInstallmentRow = CreditInstallment;

/** What the credit side of an account keeps besides its ledger balance. */
export type CreditAccountState = Readonly<{ note: string | null; installments: readonly CreditInstallmentRow[] }>;

export type InstallmentPlanAmounts = Readonly<{
  monthlyPrincipalMinor: string;
  monthlyInterestMinor: string;
  firstMonthTotalMinor: string;
}>;

/**
 * Amounts the transaction editor posts for an installment expense on a credit account: the whole principal
 * as the expense amount, the interest of every month as one "Bunga cicilan" charge, and the per-month terms
 * the server turns into installment rows. The ledger then carries the whole purchase.
 */
export function installmentPurchaseRequest(
  plan: InstallmentPlanAmounts,
  tenorMonths: number,
  interestChargeTypeId?: string,
): { amountMinor: string; charges: { typeId: string; amountMinor: string }[]; creditInstallments: { count: number; principalMinor: string; interestMinor: string } } {
  const count = BigInt(tenorMonths);
  const monthlyInterest = BigInt(plan.monthlyInterestMinor);
  const principal = BigInt(plan.firstMonthTotalMinor) - monthlyInterest + BigInt(plan.monthlyPrincipalMinor) * (count - 1n);
  const interest = monthlyInterest * count;
  if (interest > 0n && !interestChargeTypeId) throw new Error("Jenis biaya \"Bunga cicilan\" belum tersedia. Jalankan migrasi database terbaru.");
  return {
    amountMinor: principal.toString(),
    charges: interest > 0n ? [{ typeId: interestChargeTypeId!, amountMinor: interest.toString() }] : [],
    creditInstallments: { count: tenorMonths, principalMinor: plan.monthlyPrincipalMinor, interestMinor: plan.monthlyInterestMinor },
  };
}

/**
 * Installment rows of an expense whose whole amount (`impactMinor` = principal + every month's interest) is
 * in the ledger. Month 1 takes the principal remainder; month k is due k-1 months after `firstPeriod`.
 */
export function installmentRowsFor(activityId: string, impactMinor: bigint, terms: CreditInstallmentTerms, firstPeriod: string): CreditInstallmentRow[] {
  const count = terms.count;
  if (!Number.isInteger(count) || count < 2 || count > 360) throw new Error("Tenor cicilan tidak valid");
  const interest = terms.interestMinor > 0n ? terms.interestMinor : 0n;
  const base = terms.principalMinor > 0n ? terms.principalMinor : 0n;
  const firstPrincipal = impactMinor - interest * BigInt(count) - base * BigInt(count - 1);
  if (firstPrincipal < 0n) throw new Error("Rincian cicilan melebihi nilai transaksi");
  return Array.from({ length: count }, (_, index) => ({
    activityId, seq: index + 1, period: addCreditPeriods(firstPeriod, index),
    principalMinor: (index === 0 ? firstPrincipal : base).toString(), interestMinor: interest.toString(), status: "scheduled" as const,
  })).filter((row) => BigInt(row.principalMinor) + BigInt(row.interestMinor) > 0n);
}

/**
 * Credit state after a posted outflow with ledger impact `impactMinor` is scheduled into its due months.
 * An installment expense becomes installment rows; anything else (single payments deferred to the next
 * cycle, installment top-ups) keeps the note schedule.
 */
export function applyCreditPost(
  state: CreditAccountState,
  input: { activityId: string; impactMinor: bigint; cycle: "current" | "next"; kind: "expense" | "transfer"; installments?: CreditInstallmentTerms },
  now: Date = new Date(),
): CreditAccountState {
  if (input.impactMinor <= 0n) return state;
  const meta = parseCreditMeta(state.note, now);
  if (input.kind === "expense" && input.installments && input.installments.count > 1) {
    const first = addCreditPeriods(creditPeriodOf(nextMonthlyDueDayIso(meta.dueDay, 0, now)), input.cycle === "next" ? 1 : 0);
    return { ...state, installments: [...state.installments, ...installmentRowsFor(input.activityId, input.impactMinor, input.installments, first)] };
  }
  const scheduled = scheduleCreditCharge(meta, input.impactMinor, now, {
    activityId: input.activityId, cycle: input.cycle, kind: input.kind, installments: input.installments,
  });
  // fitCreditNote sheds detail (never amounts) to stay within the 1000-character note limit.
  return { ...state, note: fitCreditNote(meta.cleanNote, scheduled, now) ?? null };
}

/**
 * Credit state after an outflow is voided or replaced; null when nothing changes. Installment rows of the
 * activity are cancelled exactly (by the replacement when there is one); older outflows release the note.
 */
export function applyCreditVoid(
  state: CreditAccountState,
  input: { activityId: string; occurredAtIso: string; reversedImpactMinor: bigint; replacementActivityId?: string; replacementImpactMinor?: bigint },
  now: Date = new Date(),
): CreditAccountState | null {
  const owned = state.installments.some((row) => row.activityId === input.activityId && row.status === "scheduled");
  if (owned) {
    const cancelledBy = input.replacementActivityId ?? input.activityId;
    return { ...state, installments: state.installments.map((row) => row.activityId === input.activityId && row.status === "scheduled"
      ? { ...row, status: "cancelled" as const, cancelledByActivityId: cancelledBy } : row) };
  }
  const meta = parseCreditMeta(state.note, now);
  if (!meta.isCreditFlagged || meta.schedule.length === 0) return null;
  const released = releaseCreditCharge(meta, input, now);
  if (!released) return null;
  return { ...state, note: fitCreditNote(meta.cleanNote, released, now) ?? null };
}
