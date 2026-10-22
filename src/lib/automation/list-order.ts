import { sortTemporal, defaultSortDirection, type SortDirection, type TemporalListMode } from "../list-order.ts";
import type { WorkspaceInstance } from "./composable-facade";
/** Called after facade normalization and filtering, before any progressive reveal. */
export function orderAutomationInstances(items: readonly WorkspaceInstance[], mode: TemporalListMode = "history", direction: SortDirection = defaultSortDirection(mode)) {
  return sortTemporal(items,direction,item => item.at,item => item.key);
}
