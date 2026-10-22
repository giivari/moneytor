import "server-only";
import { reconcileAllocations } from "./allocation-service";
import { reconcileGeneralAutomation } from "./composable-service";
import { reconcileIncomeEvents } from "./income-events";
import { reconcileAutomation } from "./service";

/**
 * Reconciles all four automation subsystems in causal order:
 * 1. Legacy schedule rules (008)
 * 2. Composable general rules (010)
 * 3. Legacy income event rules (009)
 * 4. Allocation assessments on modified sources/results (011)
 */
export async function reconcileAllAutomation() {
  const schedule = await reconcileAutomation();
  const general = await reconcileGeneralAutomation();
  const incomeEvents = await reconcileIncomeEvents();
  const allocations = await reconcileAllocations();
  return { schedule, general, incomeEvents, allocations };
}

