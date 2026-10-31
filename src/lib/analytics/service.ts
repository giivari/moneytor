import "server-only";
import { requireOwnerSession } from "@/lib/auth/session";
import { inDatabaseTransaction } from "@/lib/db/pool";
import { computeCreditBills, isCreditAsset } from "@/lib/domain/credit";
import { financeSnapshot } from "@/lib/finance/summary";
import { periodChange } from "./domain";
import { monthKeys, previousPeriod, reportingPeriod, type AnalyticsGranularity, type PeriodInput } from "./periods";
import { readAggregates, readCharges, readExpenseItems, readInvestmentFlows, readObligationsForAnalytics } from "./queries";
import type { AnalyticsCreditAndBills, AnalyticsReport, DimensionRow, FinancialMeasures } from "./types";
import type { PoolClient } from "pg";

const BILL_CATEGORY_RE =
  /\b(tagihan|listrik|pln|air|pdam|internet|wifi|pulsa|paket\s*data|utilitas|utilities|bills?|langganan|subscription|cicilan|kredit|pay\s*later|spaylater|sewa|kontrakan|kos|kost|asuransi|bpjs|ipl|pajak)\b/i;

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

export type AnalyticsInput = { period?: PeriodInput; currency?: string; includeContext?: boolean; granularity?: AnalyticsGranularity };
export class AnalyticsInputError extends Error {}
export function validateAnalyticsInput(input: AnalyticsInput, now = new Date()) {
  if (!input || (input.currency !== undefined && (typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency)))
    || (input.includeContext !== undefined && typeof input.includeContext !== "boolean")
    || (input.granularity !== undefined && !["auto", "day", "week", "month", "year"].includes(input.granularity))) {
    throw new AnalyticsInputError("Filter laporan tidak valid");
  }
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
function incomeRanking(a: DimensionRow, b: DimensionRow) {
  if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
  const difference = BigInt(b.incomeMinor) - BigInt(a.incomeMinor);
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
    const dimension = (kind: typeof rows[number]["dimension"]): DimensionRow[] =>
      rows
        .filter((row) => row.dimension === kind)
        .map((row) => ({
          ...measures(row),
          key: row.key,
          id: row.id,
          name: row.name,
          archived: row.archived,
          ...(kind === "account"
            ? {
                transferInMinor: row.transferInMinor ?? "0",
                transferInCount: row.transferInCount ?? "0",
              }
            : {}),
        }));
    const summary = currencies.map((c) => measures(rows.find((r) => r.dimension === "summary" && r.currency === c.currency) ?? empty(c.currency, c.exponent)));
    const monthly = currencies.flatMap((c) => monthKeys(period).map((key) => {
      const row = rows.find((r) => r.dimension === "month" && r.currency === c.currency && r.key === key);
      return { ...measures(row ?? empty(c.currency, c.exponent)), key, id: null, name: key, archived: false };
    }));
    const charges = await readCharges(client, period, currency);
    const investmentFlows = await readInvestmentFlows(client, period, currency);
    const rawExpenseItems = input.includeContext === false ? [] : await readExpenseItems(client, period, currency);
    const snapshot = input.includeContext === false ? null : await financeSnapshot({ includeRecent: false }, client);
    const obligationsRows =
      snapshot?.planningReady ? await readObligationsForAnalytics(client, period, currency) : [];

    const byCategory = dimension("category").sort(ranking);
    const byAccount = dimension("account").sort((a, b) => {
      const base = ranking(a, b);
      if (BigInt(a.spendingMinor) !== 0n || BigInt(b.spendingMinor) !== 0n) return base;
      const flowA = BigInt(a.incomeMinor) + BigInt(a.transferInMinor ?? "0") + BigInt(a.transferPrincipalMinor);
      const flowB = BigInt(b.incomeMinor) + BigInt(b.transferInMinor ?? "0") + BigInt(b.transferPrincipalMinor);
      if (flowA !== flowB) return flowB > flowA ? 1 : -1;
      return base;
    });
    const byOrigin = dimension("origin");

    const creditAssets = snapshot ? snapshot.assets.filter((asset) => isCreditAsset(asset)) : [];
    const creditAssetIds = new Set(creditAssets.map((asset) => asset.id));
    const expenseItems = rawExpenseItems.map((item) => ({
      ...item,
      isCreditSource: creditAssetIds.has(item.sourceAssetId),
    }));

    const creditAndBills: AnalyticsCreditAndBills[] = snapshot
      ? currencies.map((c) => {
          const sumRow = summary.find((s) => s.currency === c.currency) ?? empty(c.currency, c.exponent);
          const acctMap = new Map(
            byAccount.filter((r) => r.currency === c.currency && r.id).map((r) => [r.id!, r]),
          );
          const facilities = creditAssets
            .filter((asset) => asset.currency === c.currency)
            .map((asset) => {
              const bills = computeCreditBills(asset);
              const acct = acctMap.get(asset.id);
              return {
                id: asset.id,
                name: asset.displayName,
                providerName: asset.providerName ?? null,
                isActive: asset.isActive,
                currentBillMinor: bills.currentBillMinor.toString(),
                currentDueIso: bills.currentDueIso,
                nextBillMinor: bills.nextBillMinor.toString(),
                nextDueIso: bills.nextDueIso,
                totalUnpaidMinor: bills.totalUnpaidMinor.toString(),
                limitMinor: bills.limitMinor.toString(),
                availableLimitMinor: bills.availableLimitMinor !== null ? bills.availableLimitMinor.toString() : null,
                dueDay: bills.dueDay,
                cutoffDay: bills.cutoffDay,
                periodSpendingMinor: acct?.spendingMinor ?? "0",
                periodExpenseCount: acct?.expenseCount ?? "0",
                periodRepaymentMinor: acct?.transferInMinor ?? "0",
                periodRepaymentCount: acct?.transferInCount ?? "0",
              };
            })
            .filter(
              (f) =>
                f.isActive ||
                BigInt(f.totalUnpaidMinor) > 0n ||
                BigInt(f.periodSpendingMinor) > 0n ||
                BigInt(f.periodRepaymentMinor) > 0n,
            );

          const creditSpendingBig = facilities.reduce((s, f) => s + BigInt(f.periodSpendingMinor), 0n);
          const creditExpenseCountBig = facilities.reduce((s, f) => s + BigInt(f.periodExpenseCount), 0n);
          const creditRepaymentBig = facilities.reduce((s, f) => s + BigInt(f.periodRepaymentMinor), 0n);
          const creditRepaymentCountBig = facilities.reduce((s, f) => s + BigInt(f.periodRepaymentCount), 0n);
          const totalSpendBig = BigInt(sumRow.spendingMinor);
          const cashSpendingBig = totalSpendBig > creditSpendingBig ? totalSpendBig - creditSpendingBig : 0n;

          const currentCycleBig = facilities
            .filter((f) => f.isActive)
            .reduce((s, f) => s + BigInt(f.currentBillMinor), 0n);
          const nextCycleBig = facilities
            .filter((f) => f.isActive)
            .reduce((s, f) => s + BigInt(f.nextBillMinor), 0n);
          const totalCreditUnpaidBig = facilities
            .filter((f) => f.isActive)
            .reduce((s, f) => s + BigInt(f.totalUnpaidMinor), 0n);

          const billCats = byCategory.filter((r) => r.currency === c.currency && BILL_CATEGORY_RE.test(r.name));
          const billCatSpendBig = billCats.reduce((s, r) => s + BigInt(r.spendingMinor), 0n);
          const billCatCountBig = billCats.reduce((s, r) => s + BigInt(r.expenseCount), 0n);

          const autoRow = byOrigin.find((r) => r.currency === c.currency && r.key === "automation");
          const cObligations = obligationsRows.filter((o) => o.currency === c.currency);
          const openObs = cObligations.filter((o) => o.status === "open");
          const settledObs = cObligations.filter((o) => o.settledInPeriod);
          const openObsBig = openObs.reduce((s, o) => s + BigInt(o.amountMinor), 0n);
          const openUncoveredBig = openObs.reduce((s, o) => s + BigInt(o.uncoveredMinor), 0n);
          const settledBig = settledObs.reduce((s, o) => s + BigInt(o.amountMinor), 0n);

          return {
            currency: c.currency,
            exponent: c.exponent,
            cashSpendingMinor: cashSpendingBig.toString(),
            creditSpendingMinor: creditSpendingBig.toString(),
            creditExpenseCount: creditExpenseCountBig.toString(),
            creditRepaymentMinor: creditRepaymentBig.toString(),
            creditRepaymentCount: creditRepaymentCountBig.toString(),
            currentCycleBillsMinor: currentCycleBig.toString(),
            nextCycleBillsMinor: nextCycleBig.toString(),
            totalCreditUnpaidMinor: totalCreditUnpaidBig.toString(),
            facilities,
            billCategorySpendingMinor: billCatSpendBig.toString(),
            billCategoryCount: billCatCountBig.toString(),
            automatedSpendingMinor: autoRow?.spendingMinor ?? "0",
            automatedExpenseCount: autoRow?.expenseCount ?? "0",
            openObligationsMinor: openObsBig.toString(),
            openObligationsUncoveredMinor: openUncoveredBig.toString(),
            openObligationsCount: openObs.length,
            settledInPeriodMinor: settledBig.toString(),
            settledInPeriodCount: settledObs.length,
            obligations: openObs.slice(0, 8).map((o) => ({
              id: o.id,
              title: o.title,
              labelName: o.labelName,
              amountMinor: o.amountMinor,
              coveredMinor: o.coveredMinor,
              uncoveredMinor: o.uncoveredMinor,
              dueOn: o.dueOn,
              status: o.status,
            })),
          };
        })
      : [];

    return { version: "p6a.v1", generatedAt: now.toISOString(), period, summary,
      byCategory,
      byIncomeCategory: dimension("income_category").sort(incomeRanking),
      byWeekday: dimension("weekday"),
      byAccount,
      byOrigin, monthly, daily: dimension("day"), charges, investmentFlows, expenseItems,
      creditAndBills,
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
