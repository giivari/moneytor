import { AutomationWorkspace } from "@/components/automation-workspace";
import { reconcileAllAutomation } from "@/lib/automation/reconcile";
import { readAutomation } from "@/lib/automation/service";
import { readIncomeEvents } from "@/lib/automation/income-events";
import { readGeneralAutomation } from "@/lib/automation/composable-service";

export const dynamic = "force-dynamic";
export default async function AutomationPage() {
  await reconcileAllAutomation();
  const [data,events,general] = await Promise.all([readAutomation([]),readIncomeEvents([]),readGeneralAutomation([])]);
  return <AutomationWorkspace schedules={data} income={events} general={general} />;
}
