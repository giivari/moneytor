import { TransactionsView } from "@/components/transactions-view";
import "./transactions.css";
import { listActivities } from "@/lib/finance/service";
import { activityTotals, monthlyExpenses } from "@/lib/finance/summary";
import { reconcilePageNavigation } from "@/lib/automation/reconcile";
import { readAutomation } from "@/lib/automation/service";
import { readIncomeEvents } from "@/lib/automation/income-events";
import { readGeneralAutomation } from "@/lib/automation/composable-service";
import { listImportBatches } from "@/lib/imports/service";
import { listAssets } from "@/lib/repositories/assets";
import { listCatalog } from "@/lib/repositories/catalogs";

export const dynamic = "force-dynamic";
export default async function TransactionsPage() {
  await reconcilePageNavigation();
  const [activities, monthly, totals, schedules, income, general, assets, categories, batches] = await Promise.all([
    listActivities(false, 51),
    monthlyExpenses(),
    activityTotals(),
    readAutomation([]),
    readIncomeEvents([]),
    readGeneralAutomation([]),
    listAssets(false),
    listCatalog("transactionCategories", false),
    listImportBatches(),
  ]);
  return (
    <TransactionsView
      activities={activities}
      monthly={monthly}
      totals={totals}
      automation={{ schedules, income, general }}
      imports={{ assets, categories, initialBatches: batches }}
    />
  );
}
