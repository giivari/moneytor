import type { FinanceAsset } from "@/lib/finance/types";
import type { InvestmentMarketTotal } from "./net-worth.ts";
import { computeCreditBills, isCreditAsset, isReceivableAsset } from "./credit.ts";

/** Beranda KPI figures. Pure: no database access. Amounts stay signed; nothing is clamped. */

export type NetWorthComponents = {
  /** Active, liquid asset accounts (may be negative when overdrawn). */
  cashMinor: bigint;
  /** Non-liquid or archived asset accounts. */
  otherAssetsMinor: bigint;
  receivablesMinor: bigint;
  /** Credit accounts paid beyond everything owed hold the owner's money. */
  overpaidCreditMinor: bigint;
  investmentsMinor: bigint;
  liabilitiesMinor: bigint;
  /** Same figure as summarizeBalances().netWorth for this currency. */
  netWorthMinor: bigint;
};

export function netWorthComponents(
  assets: readonly FinanceAsset[],
  investmentTotals: readonly InvestmentMarketTotal[],
  currency: string,
  now: Date = new Date(),
): NetWorthComponents {
  const parts = { cashMinor: 0n, otherAssetsMinor: 0n, receivablesMinor: 0n, overpaidCreditMinor: 0n, investmentsMinor: 0n, liabilitiesMinor: 0n };
  for (const asset of assets) {
    if (asset.currency !== currency) continue;
    const balance = BigInt(asset.balanceMinor);
    if (isCreditAsset(asset)) {
      const bills = computeCreditBills(asset, now);
      parts.liabilitiesMinor += bills.totalUnpaidMinor;
      parts.overpaidCreditMinor += bills.overpaidMinor;
    } else if (isReceivableAsset(asset)) parts.receivablesMinor += balance;
    else if (asset.isActive && asset.normallyLiquid) parts.cashMinor += balance;
    else parts.otherAssetsMinor += balance;
  }
  for (const total of investmentTotals) if (total.currency === currency) parts.investmentsMinor += BigInt(total.marketMinor);
  const owned = parts.cashMinor + parts.otherAssetsMinor + parts.receivablesMinor + parts.overpaidCreditMinor + parts.investmentsMinor;
  return { ...parts, netWorthMinor: owned - parts.liabilitiesMinor };
}

export type CreditBillDue = { assetId: string; name: string; dueIso: string; amountMinor: bigint };

/**
 * Bills of active credit accounts due on or before `throughDay`, earliest first. `nearest` sums every
 * account due on the earliest day, so the Beranda KPI and the due list read the same rows.
 */
export function creditBillsDue(
  assets: readonly FinanceAsset[],
  currency: string,
  throughDay: string,
  now: Date = new Date(),
): { items: CreditBillDue[]; nearest: { dueIso: string; amountMinor: bigint; names: string[] } | null } {
  const items: CreditBillDue[] = [];
  for (const asset of assets) {
    if (asset.currency !== currency || !asset.isActive || !isCreditAsset(asset)) continue;
    const bills = computeCreditBills(asset, now);
    if (bills.currentBillMinor > 0n && bills.currentDueIso <= throughDay)
      items.push({ assetId: asset.id, name: asset.displayName, dueIso: bills.currentDueIso, amountMinor: bills.currentBillMinor });
    if (bills.nextBillMinor > 0n && bills.nextDueIso <= throughDay)
      items.push({ assetId: asset.id, name: asset.displayName, dueIso: bills.nextDueIso, amountMinor: bills.nextBillMinor });
  }
  items.sort((a, b) => a.dueIso.localeCompare(b.dueIso) || a.name.localeCompare(b.name, "id"));
  const first = items[0];
  if (!first) return { items, nearest: null };
  const sameDay = items.filter((item) => item.dueIso === first.dueIso);
  return { items, nearest: { dueIso: first.dueIso, amountMinor: sameDay.reduce((sum, item) => sum + item.amountMinor, 0n), names: sameDay.map((item) => item.name) } };
}

export function receivablesSummary(assets: readonly FinanceAsset[], currency: string): { totalMinor: bigint; openCount: number } {
  let totalMinor = 0n, openCount = 0;
  for (const asset of assets) {
    if (asset.currency !== currency || !isReceivableAsset(asset)) continue;
    const balance = BigInt(asset.balanceMinor);
    totalMinor += balance;
    if (balance !== 0n) openCount++;
  }
  return { totalMinor, openCount };
}
