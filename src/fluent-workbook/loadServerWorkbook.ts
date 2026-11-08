import { requireOwnerSession } from "@/lib/auth/session";
import { financeSnapshot } from "@/lib/finance/summary";
import { listActivities } from "@/lib/finance/service";
import { readAnalytics } from "@/lib/analytics/service";
import { investmentSnapshot } from "@/lib/investments/read";
import { listPlanning } from "@/lib/planning/repository";
import { listCatalog } from "@/lib/repositories/catalogs";
import { reconcileAllAutomation } from "@/lib/automation/reconcile";

export async function loadServerWorkbook() {
  await requireOwnerSession();
  await reconcileAllAutomation().catch(() => null);
  const [snapshot, activities, analytics6m, analyticsMonth, invSnap, planning, categories, assetTypes, providers, chargeTypes] =
    await Promise.all([
      financeSnapshot({ includeRecent: true, includeExpenses: true }),
      listActivities(true, 100),
      readAnalytics({ period: { kind: "monthly_trend", months: 6 }, includeContext: false }).catch(() => null),
      readAnalytics({ period: { kind: "current_month" }, includeContext: false }).catch(() => null),
      investmentSnapshot().catch(() => null),
      listPlanning().catch(() => null),
      listCatalog("transactionCategories").catch(() => []),
      listCatalog("assetTypes").catch(() => []),
      listCatalog("providers").catch(() => []),
      listCatalog("chargeTypes").catch(() => []),
    ]);

  return {
    snapshot,
    activities,
    analytics6m,
    analyticsMonth,
    invSnap,
    planning,
    catalogs: { categories, assetTypes, providers, chargeTypes },
  };
}
