import { TransactionsView } from "@/components/transactions-view";
import "./transactions.css";
import { listActivities } from "@/lib/finance/service";
import { activityTotals, monthlyExpenses } from "@/lib/finance/summary";
import { reconcilePageNavigation } from "@/lib/automation/reconcile";
import { readAutomation } from "@/lib/automation/service";
import { readIncomeEvents } from "@/lib/automation/income-events";
import { readGeneralAutomation } from "@/lib/automation/composable-service";

export const dynamic = "force-dynamic";
export default async function TransactionsPage() {
  await reconcilePageNavigation();
  const [activities, monthly, totals, schedules, income, general] = await Promise.all([
    listActivities(false, 51),
    monthlyExpenses(),
    activityTotals(),
    readAutomation([]),
    readIncomeEvents([]),
    readGeneralAutomation([]),
  ]);
  return <TransactionsView activities={activities} monthly={monthly} totals={totals} automation={{ schedules, income, general }} />;
}
