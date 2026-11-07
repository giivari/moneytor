import { isSortDirection, type SortDirection } from "../list-order.ts";
import type { AnyActivityKind } from "./types";

export type ActivityReadOrder = { direction?: SortDirection; kind?: AnyActivityKind; after?: { at: string; id: string } };
/** Validated keyset boundary preserves PostgreSQL timestamp precision. */
export function activityReadOrder(options: ActivityReadOrder) {
  const direction = options.direction ?? "desc";
  if (!isSortDirection(direction) || (options.kind && !["income","expense","transfer","borrow","repay","refund","adjustment"].includes(options.kind))) throw new Error("Invalid activity order");
  if (options.after && (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(options.after.at)
    || !Number.isFinite(Date.parse(options.after.at)) || !/^[0-9a-f-]{36}$/i.test(options.after.id))) throw new Error("Invalid activity boundary");
  return { direction, operator: direction === "desc" ? "<" : ">", kind: options.kind ?? null, after: options.after };
}
