import type { CreditInstallment, FinanceAsset } from "@/lib/finance/types";
import { computeCreditBills, creditPeriodOf, isCreditAsset, isReceivableAsset, type ComputedCreditBills } from "./credit.ts";

/** Kredit & Talangan page figures. Pure: no database access; amounts stay signed. */

export type CreditStatus = "tagihan" | "cicilan" | "lunas" | "lebih-bayar";
export type CreditFacility = { asset: FinanceAsset; bills: ComputedCreditBills; status: CreditStatus };

function statusOf(bills: ComputedCreditBills): CreditStatus {
  if (bills.overpaidMinor > 0n) return "lebih-bayar";
  if (bills.totalUnpaidMinor === 0n) return "lunas";
  if (bills.currentBillMinor > 0n || bills.nextBillMinor > 0n) return "tagihan";
  return "cicilan";
}

/** Credit accounts (asset_class liability), active first, then by name. */
export function creditFacilities(assets: readonly FinanceAsset[], now: Date = new Date()): CreditFacility[] {
  return assets.filter(isCreditAsset)
    .map((asset) => { const bills = computeCreditBills(asset, now); return { asset, bills, status: statusOf(bills) }; })
    .sort((a, b) => Number(b.asset.isActive) - Number(a.asset.isActive) || a.asset.displayName.localeCompare(b.asset.displayName, "id"));
}

export type InstallmentContract = {
  activityId: string; count: number; monthlyMinor: bigint; totalMinor: bigint;
  firstPeriod: string; lastPeriod: string;
  /** Rows billed on the current due date or later (by date only; payment status comes from the balance). */
  upcomingCount: number;
  rows: readonly CreditInstallment[];
};

/** Scheduled installment rows of one credit account grouped per purchase. Cancelled rows are history only. */
export function installmentContracts(asset: FinanceAsset, now: Date = new Date()): InstallmentContract[] {
  const currentPeriod = creditPeriodOf(computeCreditBills(asset, now).currentDueIso);
  const byActivity = new Map<string, CreditInstallment[]>();
  for (const row of asset.creditInstallments ?? []) {
    if (row.status !== "scheduled") continue;
    byActivity.set(row.activityId, [...(byActivity.get(row.activityId) ?? []), row]);
  }
  return [...byActivity.entries()].map(([activityId, list]) => {
    const rows = [...list].sort((a, b) => a.seq - b.seq);
    const amount = (row: CreditInstallment) => BigInt(row.principalMinor) + BigInt(row.interestMinor);
    return {
      activityId, count: rows.length, monthlyMinor: amount(rows[0]!), totalMinor: rows.reduce((sum, row) => sum + amount(row), 0n),
      firstPeriod: rows[0]!.period, lastPeriod: rows[rows.length - 1]!.period,
      upcomingCount: rows.filter((row) => row.period >= currentPeriod).length, rows,
    };
  }).sort((a, b) => a.firstPeriod.localeCompare(b.firstPeriod) || a.activityId.localeCompare(b.activityId));
}

/**
 * Per-currency totals. liabilitiesMinor and dueMinor use the same rules as summarizeBalances (liabilities and
 * creditDebt), so this page and Beranda never disagree. Limits are summed only for accounts that state one.
 */
export function creditTotals(assets: readonly FinanceAsset[], currency: string, throughDay: string, now: Date = new Date()) {
  let liabilitiesMinor = 0n, dueMinor = 0n, availableLimitMinor = 0n, limitKnownCount = 0, facilityCount = 0;
  for (const { asset, bills } of creditFacilities(assets, now)) {
    if (asset.currency !== currency) continue;
    facilityCount++;
    liabilitiesMinor += bills.totalUnpaidMinor;
    if (!asset.isActive) continue;
    dueMinor += bills.currentBillMinor;
    if (bills.nextDueIso <= throughDay) dueMinor += bills.nextBillMinor;
    if (bills.availableLimitMinor !== null) { availableLimitMinor += bills.availableLimitMinor; limitKnownCount++; }
  }
  return { liabilitiesMinor, dueMinor, availableLimitMinor, limitKnownCount, facilityCount };
}

export type ReceivableStatus = "terbuka" | "lunas";

/** Receivable accounts (asset_class receivable) in one currency: open balances first. */
export function receivableAccounts(assets: readonly FinanceAsset[], currency: string) {
  return assets.filter((asset) => asset.currency === currency && isReceivableAsset(asset))
    .map((asset) => ({ asset, status: (BigInt(asset.balanceMinor) === 0n ? "lunas" : "terbuka") as ReceivableStatus }))
    .sort((a, b) => Number(a.status === "lunas") - Number(b.status === "lunas") || a.asset.displayName.localeCompare(b.asset.displayName, "id"));
}
