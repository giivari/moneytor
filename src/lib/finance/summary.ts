import "server-only";
import type { PoolClient } from "pg";
import { requireOwnerSession } from "@/lib/auth/session";
import { database, inDatabaseTransaction } from "@/lib/db/pool";
import { prepareOwnerAssetRead } from "@/lib/repositories/assets";
import { listActivities } from "./service";
import { prepareOwnerInvestmentSummaryRead } from "@/lib/investments/read";
import { horizonDay, planningTotals } from "@/lib/domain/planning";
import { planningSchemaReady, readPlanningSummary } from "@/lib/planning/repository";

function planningHorizon() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
  return horizonDay(today, 30);
}

function monthRange() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00+07:00`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return [start, new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+07:00`)];
}
async function readMonthlyExpenses(client?: PoolClient) {
  const result = await (client ?? database()).query<{ currency: string; exponent: number; expenseMinor: string }>(`
    WITH items AS (
      SELECT currency_code,base_amount_minor::numeric AS amount FROM financial_activities
      WHERE kind='expense' AND status='posted' AND occurred_at >= $1 AND occurred_at < $2
      UNION ALL
      SELECT f.currency_code,ac.amount_minor::numeric FROM activity_charges ac
      JOIN financial_activities f ON f.id=ac.activity_id
      WHERE f.status='posted' AND f.occurred_at >= $1 AND f.occurred_at < $2
    )
    SELECT c.code AS currency,c.minor_unit_exponent AS exponent,COALESCE(sum(items.amount),0)::text AS "expenseMinor"
    FROM currencies c LEFT JOIN items ON items.currency_code=c.code
    WHERE EXISTS (SELECT 1 FROM assets a WHERE a.currency_code=c.code)
      OR EXISTS (SELECT 1 FROM financial_activities f WHERE f.currency_code=c.code)
      OR EXISTS (SELECT 1 FROM investment_portfolios p WHERE p.currency_code=c.code)
      OR EXISTS (SELECT 1 FROM investment_opening_positions o WHERE o.currency_code=c.code)
      OR EXISTS (SELECT 1 FROM investment_transactions t WHERE t.currency_code=c.code)
    GROUP BY c.code,c.minor_unit_exponent ORDER BY c.code`, monthRange());
  return result.rows;
}
/** Transactions does not need cash balances or investment replay to show monthly spending. */
export async function monthlyExpenses() {
  await requireOwnerSession();
  return readMonthlyExpenses();
}
export async function financeSnapshot({ includeRecent = true, includeExpenses = true }: { includeRecent?: boolean; includeExpenses?: boolean } = {}, existing?: PoolClient) {
  await requireOwnerSession();
  const [readAssets, readInvestments, recent] = await Promise.all([
    prepareOwnerAssetRead(), prepareOwnerInvestmentSummaryRead(),
    includeRecent ? listActivities(false, 4) : Promise.resolve([]),
  ]);
  const read = async (client: PoolClient) => {
    // One transaction uses one connection; queueing concurrent pg queries adds no parallelism.
    const assets = await readAssets(true, client);
    const investment = await readInvestments(client);
    const expense = includeExpenses ? await readMonthlyExpenses(client) : [];
    const throughDay = planningHorizon();
    const planningReady = await planningSchemaReady(client);
    const planning = planningReady ? await readPlanningSummary(client, throughDay) : new Map();
    const byCurrency = new Map<string, { currency: string; exponent: number; total: bigint; liquid: bigint; spendable: bigint; expense: bigint; unpricedCount: number }>();
    for (const asset of assets) {
      const entry = byCurrency.get(asset.currency) ?? { currency: asset.currency, exponent: asset.exponent, total: 0n, liquid: 0n, spendable: 0n, expense: 0n, unpricedCount: 0 };
      const balance = BigInt(asset.balanceMinor);
      entry.total += balance;
      if (asset.isActive && asset.normallyLiquid) entry.liquid += balance;
      if (asset.isActive && asset.normallySpendable) entry.spendable += balance;
      byCurrency.set(asset.currency, entry);
    }
    for (const total of investment.totals) {
      const entry = byCurrency.get(total.currency) ?? { currency: total.currency, exponent: total.exponent, total: 0n, liquid: 0n, spendable: 0n, expense: 0n, unpricedCount: 0 };
      entry.total += BigInt(total.marketMinor); entry.unpricedCount = total.unpricedCount;
      byCurrency.set(total.currency, entry);
    }
    for (const row of expense) {
      const entry = byCurrency.get(row.currency);
      if (entry) entry.expense = BigInt(row.expenseMinor);
    }
    const missing = [...planning.keys()].filter((currency) => !byCurrency.has(currency));
    if (missing.length) {
      const rows = await client.query<{ currency: string; exponent: number }>("SELECT code AS currency,minor_unit_exponent AS exponent FROM currencies WHERE code = ANY($1::text[])", [missing]);
      for (const row of rows.rows) byCurrency.set(row.currency, { currency: row.currency, exponent: row.exponent, total: 0n, liquid: 0n, spendable: 0n, expense: 0n, unpricedCount: 0 });
    }
    return { assets, recent, investment, planningReady, throughDay, currencies: [...byCurrency.values()].map((entry) => {
      const commitmentsForCurrency = planning.get(entry.currency);
      const position = planningTotals(entry.spendable, commitmentsForCurrency?.reservedMinor ?? "0",
        commitmentsForCurrency?.dueMinor ?? "0", commitmentsForCurrency?.coveredMinor ?? "0", commitmentsForCurrency?.uncoveredMinor ?? "0");
      return { currency: entry.currency, exponent: entry.exponent, totalMinor: entry.total.toString(),
        liquidMinor: entry.liquid.toString(), eligibleMinor: entry.spendable.toString(), ...position,
        expenseMinor: entry.expense.toString(), unpricedCount: entry.unpricedCount };
    }) };
  };
  if (existing) return read(existing);
  return inDatabaseTransaction(async (client) => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    return read(client);
  });
}
