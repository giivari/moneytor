import { TransactionsView } from "@/components/transactions-view";
import "./transactions.css";
import { readAnalytics } from "@/lib/analytics/service";
import { listActivities } from "@/lib/finance/service";
import { monthlyExpenses } from "@/lib/finance/summary";
import { reconcileAllAutomation } from "@/lib/automation/reconcile";

export const dynamic = "force-dynamic";
export default async function TransactionsPage() {
  await reconcileAllAutomation();
  const [activities, monthly, analytics] = await Promise.all([
    listActivities(false, 51),
    monthlyExpenses(),
    readAnalytics({ period: { kind: "monthly_trend", months: 12 } }).catch(() => null),
  ]);
  return <TransactionsView activities={activities} monthly={monthly} expenseItems={analytics?.expenseItems} />;
}
