import { AutomationBuilder } from "@/components/automation-builder";
import { readGeneralAutomation } from "@/lib/automation/composable-service";

export const dynamic = "force-dynamic";

export default async function NewAutomationPage() {
  // Builder routes only read configuration; reconciliation belongs to the workspace.
  const data = await readGeneralAutomation();
  return <AutomationBuilder categories={data.categories} />;
}
