import { financeSnapshot } from "@/lib/finance/summary";
import { CreditOverview } from "@/components/credit-overview";
import "./credit.css";

export const dynamic = "force-dynamic";
export default async function CreditPage() {
  const snapshot = await financeSnapshot({ includeRecent: false, includeExpenses: false });
  return <CreditOverview snapshot={snapshot} />;
}
