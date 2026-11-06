import type { FinanceAsset } from "@/lib/finance/types";
import { computeCreditBills, isCreditAsset, isReceivableAsset } from "./credit.ts";

/** Per-currency balances behind the home summary, planning position and net worth. Pure: no database access. */
export type CurrencyBalances = {
  currency: string;
  exponent: number;
  /** Assets, receivables, overpaid credit accounts and investments at market value. */
  total: bigint;
  liquid: bigint;
  spendable: bigint;
  expense: bigint;
  /** Credit bills due within the planning horizon (current bill plus the next one when it falls inside). */
  creditDebt: bigint;
  /** Everything still owed on credit accounts, including installments due after the next bill. */
  liabilities: bigint;
  /** total - liabilities. */
  netWorth: bigint;
  unpricedCount: number;
};

export type InvestmentMarketTotal = Readonly<{ currency: string; exponent: number; marketMinor: string; unpricedCount: number }>;

export function emptyCurrencyBalances(currency: string, exponent: number): CurrencyBalances {
  return { currency, exponent, total: 0n, liquid: 0n, spendable: 0n, expense: 0n, creditDebt: 0n, liabilities: 0n, netWorth: 0n, unpricedCount: 0 };
}

/**
 * Aggregates asset balances and investment market values per currency. `throughDay` (YYYY-MM-DD) is the
 * planning horizon: a credit account's next bill counts when it is due on or before that day.
 */
export function summarizeBalances(
  assets: readonly FinanceAsset[],
  investmentTotals: readonly InvestmentMarketTotal[],
  throughDay: string,
  now: Date = new Date(),
): Map<string, CurrencyBalances> {
  const byCurrency = new Map<string, CurrencyBalances>();
  for (const asset of assets) {
    const entry = byCurrency.get(asset.currency) ?? emptyCurrencyBalances(asset.currency, asset.exponent);
    const balance = BigInt(asset.balanceMinor);
    if (isCreditAsset(asset)) {
      const bills = computeCreditBills(asset, now);
      // Archived accounts still owe (or hold) what their balance says, like archived assets still count.
      entry.liabilities += bills.totalUnpaidMinor;
      entry.total += bills.overpaidMinor;
      if (asset.isActive) {
        entry.creditDebt += bills.currentBillMinor;
        if (bills.nextDueIso <= throughDay) entry.creditDebt += bills.nextBillMinor;
      }
    } else {
      entry.total += balance;
      const isReceivable = isReceivableAsset(asset);
      if (asset.isActive && asset.normallyLiquid && !isReceivable) entry.liquid += balance;
      if (asset.isActive && asset.normallySpendable && !isReceivable) entry.spendable += balance;
    }
    byCurrency.set(asset.currency, entry);
  }
  for (const total of investmentTotals) {
    const entry = byCurrency.get(total.currency) ?? emptyCurrencyBalances(total.currency, total.exponent);
    entry.total += BigInt(total.marketMinor);
    entry.unpricedCount = total.unpricedCount;
    byCurrency.set(total.currency, entry);
  }
  for (const entry of byCurrency.values()) entry.netWorth = entry.total - entry.liabilities;
  return byCurrency;
}
