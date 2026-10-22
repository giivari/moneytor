import { financeSnapshot } from "@/lib/finance/summary";
import { reconcileAutomation } from "@/lib/automation/service";
import { reconcileGeneralAutomation } from "@/lib/automation/composable-service";
import { HomeOverview } from "@/components/home-overview";
import { readAnalytics } from "@/lib/analytics/service";
import "./insights/insights.css";

export const dynamic = "force-dynamic";
export default async function HomePage() {
  // Preserve the existing ordinary Home lifecycle; presentation adds no execution.
  await reconcileAutomation();
  await reconcileGeneralAutomation();
  const [snapshot, analytics] = await Promise.all([
    financeSnapshot(),
    readAnalytics({ period: { kind: "monthly_trend", months: 6 }, includeContext: false }).catch(() => null),
  ]);
  const date = new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeZone: "Asia/Jakarta" }).format(new Date());
  return <HomeOverview snapshot={snapshot} analytics={analytics} date={date} />;
}
