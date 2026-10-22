import { notFound } from "next/navigation";
import { AutomationBuilder } from "@/components/automation-builder";
import { unifyAutomation } from "@/lib/automation/composable-facade";
import { readGeneralAutomation } from "@/lib/automation/composable-service";
import { readAutomation } from "@/lib/automation/service";
import { readIncomeEvents } from "@/lib/automation/income-events";

export const dynamic = "force-dynamic";

export default async function EditAutomationPage({ params, searchParams }: {
  params: Promise<{ ruleId: string }>; searchParams: Promise<{ source?: string }>;
}) {
  const [{ ruleId }, { source = "general" }] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ruleId)
    || !["general", "schedule", "income_event"].includes(source)) notFound();
  const general = await readGeneralAutomation();
  if (source === "general") {
    const rule = general.rules.find((item) => item.id === ruleId);
    if (!rule) notFound();
    return <AutomationBuilder key={`general:${rule.id}`} categories={general.categories} editing={{ id: rule.id, input: rule.input, storage: "general" }} />;
  }
  // Keep legacy edit commands and authoritative storage; do not copy legacy rules.
  const schedules = source === "schedule" ? await readAutomation() : { ready: true, rules: [], occurrences: [] };
  const income = source === "income_event" ? await readIncomeEvents() : { ready: true, rules: [], instances: [] };
  const rule = unifyAutomation(schedules, income, general).rules.find((item) => item.id === ruleId && item.storage === source);
  if (!rule?.input) notFound();
  return <AutomationBuilder key={`${rule.storage}:${rule.id}`} categories={general.categories} editing={{ id: rule.id, input: rule.input, storage: rule.storage }} />;
}
