import { AssetsManager } from "@/components/assets-manager";
import { financeSnapshot } from "@/lib/finance/summary";

export const dynamic = "force-dynamic";
export default async function AssetsPage() {
  const { assets, currencies, investment } = await financeSnapshot({ includeRecent: false, includeExpenses: false });
  return <AssetsManager assets={assets} investmentTotals={investment.totals} totals={currencies.map((item) => ({
    currency: item.currency, exponent: item.exponent, amountMinor: item.totalMinor, unpricedCount: item.unpricedCount,
  }))} />;
}
