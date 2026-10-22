import { TransactionsView } from "@/components/transactions-view";
import { listActivities } from "@/lib/finance/service";
import { monthlyExpenses } from "@/lib/finance/summary";
import { reconcileAllAutomation } from "@/lib/automation/reconcile";

export const dynamic = "force-dynamic";
export default async function TransactionsPage() {
  await reconcileAllAutomation();
  const [activities, monthly] = await Promise.all([listActivities(false, 51), monthlyExpenses()]);
  return <TransactionsView activities={activities} monthly={monthly} />;
}
