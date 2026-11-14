import "server-only";
import { reconcileAllocations } from "./allocation-service";
import { reconcileGeneralAutomation } from "./composable-service";
import { reconcileIncomeEvents } from "./income-events";
import { reconcileAutomation } from "./service";

const globalReconcile = globalThis as unknown as {
  __moneytorLastReconcileAt?: number;
};

/**
 * Reconciles all four automation subsystems in causal order:
 * 1. Legacy schedule rules (008)
 * 2. Composable general rules (010)
 * 3. Legacy income event rules (009)
 * 4. Allocation assessments on modified sources/results (011)
 * The throttle timestamp is recorded only after a full successful run, so a failure is retried on the next navigation.
 */
export async function reconcileAllAutomation() {
  const schedule = await reconcileAutomation();
  const general = await reconcileGeneralAutomation();
  const incomeEvents = await reconcileIncomeEvents();
  const allocations = await reconcileAllocations();
  globalReconcile.__moneytorLastReconcileAt = Date.now();
  return { schedule, general, incomeEvents, allocations };
}

/** Forgets the last run, so the next page navigation reconciles again (called after every finance/automation mutation). */
export function resetReconcileThrottle() {
  globalReconcile.__moneytorLastReconcileAt = 0;
}

/**
 * Throttled page-navigation helper: skips heavy write transactions if a reconciliation already
 * succeeded within the last 60 seconds in this server process and no mutation happened since.
 */
export async function reconcilePageNavigation() {
  const last = globalReconcile.__moneytorLastReconcileAt ?? 0;
  if (Date.now() - last < 60_000) return;
  await reconcileAllAutomation();
}
