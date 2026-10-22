import "server-only";
import { requireOwnerSession } from "@/lib/auth/session";
import { inDatabaseTransaction } from "@/lib/db/pool";
import { financeSnapshot } from "@/lib/finance/summary";
import { periodChange } from "./domain";
import { monthKeys, previousPeriod, reportingPeriod, type PeriodInput } from "./periods";
import { readAggregates, readCharges, readInvestmentFlows } from "./queries";
import type { AnalyticsReport, DimensionRow, FinancialMeasures } from "./types";
import type { PoolClient } from "pg";

async function readCurrencies(client: PoolClient, currency: string | null) {
  return (await client.query<{ currency: string; exponent: number }>(`
    SELECT c.code AS currency,c.minor_unit_exponent AS exponent FROM currencies c
    WHERE ($1::text IS NULL AND (EXISTS(SELECT 1 FROM assets a WHERE a.currency_code=c.code)
      OR EXISTS(SELECT 1 FROM financial_activities f WHERE f.currency_code=c.code)
      OR EXISTS(SELECT 1 FROM investment_portfolios p WHERE p.currency_code=c.code)
      OR EXISTS(SELECT 1 FROM investment_opening_positions o WHERE o.currency_code=c.code)
      OR EXISTS(SELECT 1 FROM investment_transactions t WHERE t.currency_code=c.code))) OR c.code=$1
    ORDER BY c.code COLLATE "C"`, [currency])).rows;
}
/** Owner-only metadata for controls, using the same currency universe as reports. */
export async function analyticsCurrencyOptions() {
  await requireOwnerSession();
  return inDatabaseTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return readCurrencies(client, null);
  });
}

export type AnalyticsInput = { period?: PeriodInput; currency?: string; includeContext?: boolean };
export class AnalyticsInputError extends Error {}
export function validateAnalyticsInput(input: AnalyticsInput, now = new Date()) {
  if (!input || (input.currency !== undefined && (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)))
    || (input.includeContext !== undefined && typeof input.includeContext !== "boolean")) throw new AnalyticsInputError("Filter laporan tidak valid");
  try {
    const period = reportingPeriod(input.period, now);
    previousPeriod(input.period ?? { kind: "current_month" }, period, now);
    return period;
  }
  catch (error) { throw new AnalyticsInputError(error instanceof Error ? error.message : "Periode tidak valid"); }
}
function empty(currency: string, exponent: number): FinancialMeasures {
  return { currency, exponent, incomeMinor: "0", expensePrincipalMinor: "0", feesMinor: "0", taxesMinor: "0",
    otherChargesMinor: "0", transferFeesMinor: "0", chargesMinor: "0", spendingMinor: "0", netMinor: "0",
    transferPrincipalMinor: "0", activityCount: "0", incomeCount: "0", expenseCount: "0", transferCount: "0" };
}
function measures(row: FinancialMeasures): FinancialMeasures {
  const { currency, exponent, incomeMinor, expensePrincipalMinor, feesMinor, taxesMinor, otherChargesMinor,
    transferFeesMinor, chargesMinor, spendingMinor, netMinor, transferPrincipalMinor, activityCount, incomeCount, expenseCount, transferCount } = row;
  return { currency, exponent, incomeMinor, expensePrincipalMinor, feesMinor, taxesMinor, otherChargesMinor,
    transferFeesMinor, chargesMinor, spendingMinor, netMinor, transferPrincipalMinor, activityCount, incomeCount, expenseCount, transferCount };
}
function ranking(a: DimensionRow, b: DimensionRow) {
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
  const difference = BigInt(b.spendingMinor) - BigInt(a.spendingMinor);
  return difference !== 0n ? (difference > 0n ? 1 : -1) : a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
/** Authenticated, bounded, read-only. Never invokes Automation reconciliation or posting. */
export async function readAnalytics(input: AnalyticsInput = {}, now = new Date()): Promise<AnalyticsReport> {
  await requireOwnerSession();
  const period = validateAnalyticsInput(input, now), prior = previousPeriod(input.period ?? { kind: "current_month" }, period, now);
  return inDatabaseTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const currency = input.currency ?? null;
    if (currency && !(await client.query("SELECT 1 FROM currencies WHERE code=$1", [currency])).rowCount) throw new AnalyticsInputError("Mata uang tidak tersedia");
    const currencies = await readCurrencies(client, currency);
    const rows = await readAggregates(client, period, currency);
    const previous = await readAggregates(client, prior, currency, true);
    const dimension = (kind: typeof rows[number]["dimension"]): DimensionRow[] => rows.filter((row) => row.dimension === kind).map((row) => ({ ...measures(row), key: row.key, id: row.id, name: row.name, archived: row.archived }));
    const summary = currencies.map((c) => measures(rows.find((r) => r.dimension === "summary" && r.currency === c.currency) ?? empty(c.currency, c.exponent)));
    const monthly = currencies.flatMap((c) => monthKeys(period).map((key) => {
      const row = rows.find((r) => r.dimension === "month" && r.currency === c.currency && r.key === key);
      return { ...measures(row ?? empty(c.currency, c.exponent)), key, id: null, name: key, archived: false };
    }));
    const charges = await readCharges(client, period, currency);
    const investmentFlows = await readInvestmentFlows(client, period, currency);
    const snapshot = input.includeContext === false ? null : await financeSnapshot({ includeRecent: false }, client);
    return { version: "p6a.v1", generatedAt: now.toISOString(), period, summary,
      byCategory: dimension("category").sort(ranking), byAccount: dimension("account").sort(ranking),
      byOrigin: dimension("origin"), monthly, daily: dimension("day"), charges, investmentFlows,
      comparison: { period: prior, partialComparison: period.partial || prior.partial, method: "full_previous_period",
        currencies: summary.map((row) => {
          const before = previous.find((r) => r.currency === row.currency) ?? empty(row.currency, row.exponent);
          return { currency: row.currency, income: periodChange(row.incomeMinor, before.incomeMinor),
            spending: periodChange(row.spendingMinor, before.spendingMinor), net: periodChange(row.netMinor, before.netMinor) };
        }) },
      context: snapshot ? { scope: "current_snapshot_not_period_end", throughDay: snapshot.throughDay,
        planningReady: snapshot.planningReady, currencies: snapshot.currencies.filter((c) => !currency || c.currency === currency),
        investments: snapshot.investment.totals.filter((c) => !currency || c.currency === currency) } : null };
  });
}
