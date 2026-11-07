import { isCreditReminderNote } from "./credit.ts";
import { assertStoredMinor, parseMinor } from "./money.ts";

export type PlanKind = "budget" | "goal" | "reserve" | "obligation";
export type ReservePurpose = "general" | "emergency" | "restricted" | "goal" | "obligation";
export type ObligationStatus = "open" | "settled" | "cancelled";
export type ReserveAllocation = Readonly<{
  currency: string; amountMinor: string; isActive: boolean; goalId?: string | null; obligationId?: string | null;
}>;
export type ObligationCommitment = Readonly<{
  id: string; currency: string; amountMinor: string; dueOn: string; status: ObligationStatus;
  /** Reminders for credit bills are skipped: their amounts already sit in the credit bills (creditDebt). */
  note?: string | null;
}>;
export type PlanningAggregateMinor = Readonly<{
  reservedMinor: string | bigint; dueMinor: string | bigint; coveredMinor: string | bigint; uncoveredMinor: string | bigint;
}>;

function positive(raw: string) {
  const value = assertStoredMinor(parseMinor(raw));
  if (value <= 0n) throw new Error("Planning amount must be positive");
  return value;
}
export function planningTotals(baseMinor: string | bigint, reservedMinor: string | bigint,
  dueMinor: string | bigint, coveredMinor: string | bigint, uncoveredMinor: string | bigint) {
  const base = BigInt(baseMinor), reserved = BigInt(reservedMinor), due = BigInt(dueMinor);
  const covered = BigInt(coveredMinor), uncovered = BigInt(uncoveredMinor);
  if (reserved < 0n || due < 0n || covered < 0n || uncovered < 0n || covered + uncovered !== due) throw new Error("Invalid planning totals");
  return {
    reservedMinor: reserved.toString(), dueMinor: due.toString(), coveredMinor: covered.toString(),
    uncoveredMinor: uncovered.toString(), spendableMinor: (base - reserved).toString(),
    availableMinor: (base - reserved - uncovered).toString(),
  };
}

/**
 * The single definition of "dana siap pakai" (availableMinor). Credit bills due inside the horizon are
 * obligations nothing has reserved for, so they add to both the due and the uncovered totals. Beranda
 * (via financeSnapshot) and Rencana both end here.
 */
export function availableFunds(baseMinor: string | bigint, aggregate: PlanningAggregateMinor, creditDebtMinor: string | bigint = 0n) {
  const credit = BigInt(creditDebtMinor);
  if (credit < 0n) throw new Error("Invalid credit debt");
  return planningTotals(baseMinor, aggregate.reservedMinor,
    BigInt(aggregate.dueMinor) + credit, aggregate.coveredMinor, BigInt(aggregate.uncoveredMinor) + credit);
}

/** Explicit coverage is capped separately for each open, due obligation. */
export function planningPosition(baseMinor: string | bigint, currency: string, reserves: ReserveAllocation[],
  obligations: ObligationCommitment[], throughDay: string, creditDebtMinor: string | bigint = 0n) {
  let reserved = 0n, due = 0n, covered = 0n;
  const byObligation = new Map<string, bigint>();
  for (const reserve of reserves) {
    if (reserve.currency !== currency) throw new Error("Currency mismatch");
    const amount = positive(reserve.amountMinor);
    if (!reserve.isActive) continue;
    reserved += amount;
    if (reserve.obligationId) byObligation.set(reserve.obligationId, (byObligation.get(reserve.obligationId) ?? 0n) + amount);
  }
  for (const obligation of obligations) {
    if (obligation.currency !== currency) throw new Error("Currency mismatch");
    const amount = positive(obligation.amountMinor);
    if (obligation.status !== "open" || obligation.dueOn > throughDay || isCreditReminderNote(obligation.note)) continue;
    due += amount;
    const linked = byObligation.get(obligation.id) ?? 0n;
    covered += linked > amount ? amount : linked;
  }
  return availableFunds(baseMinor, { reservedMinor: reserved, dueMinor: due, coveredMinor: covered, uncoveredMinor: due - covered }, creditDebtMinor);
}

/** The "today" a financeSnapshot throughDay (today + 30 days) was derived from. */
export function planningToday(throughDay: string) {
  return horizonDay(throughDay, -30);
}

export function goalProgress(goalId: string, currency: string, reserves: ReserveAllocation[]) {
  return reserves.reduce((total, reserve) => {
    if (reserve.currency !== currency) throw new Error("Currency mismatch");
    return total + (reserve.isActive && reserve.goalId === goalId ? positive(reserve.amountMinor) : 0n);
  }, 0n).toString();
}

export function horizonDay(today: string, days: number) {
  if (!Number.isSafeInteger(days)) throw new Error("Invalid planning horizon");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error("Invalid planning day");
  const date = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== today) throw new Error("Invalid planning day");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
