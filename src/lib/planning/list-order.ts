import type { PlanningItem } from "./repository";
import { compareIdentity, temporalComparator } from "../list-order.ts";

export const planningSortOptions = {
  budget: [
    {value:"current",label:"Periode aktif / terkini"}, {value:"period",label:"Periode terbaru"},
    {value:"usage",label:"Paling terpakai"}, {value:"remaining",label:"Sisa paling sedikit"},
    {value:"created_desc",label:"Terbaru dibuat"}, {value:"created_asc",label:"Terlama dibuat"},
  ],
  goal: [
    {value:"due_asc",label:"Target terdekat"}, {value:"due_desc",label:"Target terjauh"},
    {value:"progress_desc",label:"Paling dekat tercapai"}, {value:"progress_asc",label:"Progres terendah"},
    {value:"created_desc",label:"Terbaru dibuat"}, {value:"created_asc",label:"Terlama dibuat"},
  ],
  reserve: [
    {value:"created_desc",label:"Terbaru dibuat"}, {value:"created_asc",label:"Terlama dibuat"},
    {value:"amount_desc",label:"Nominal terbesar"}, {value:"amount_asc",label:"Nominal terkecil"},
  ],
  obligation: [
    {value:"due_asc",label:"Jatuh tempo terdekat"}, {value:"due_desc",label:"Jatuh tempo terjauh"},
    {value:"amount_desc",label:"Nominal terbesar"}, {value:"amount_asc",label:"Nominal terkecil"},
    {value:"uncovered",label:"Belum tercakup terbesar"}, {value:"created_desc",label:"Terbaru dibuat"},
  ],
} as const;
const compare = (a: bigint, b: bigint) => a < b ? -1 : a > b ? 1 : 0;
const rank = (item: PlanningItem) => item.kind === "obligation" ? item.status === "open" ? 0 : 2
  : !item.isActive ? 2 : item.kind === "goal" && BigInt(item.targetMinor) > 0n && BigInt(item.progressMinor) >= BigInt(item.targetMinor) ? 1 : 0;
const amount = (item: PlanningItem) => BigInt(item.kind === "budget" ? item.limitMinor : item.kind === "goal" ? item.targetMinor : item.amountMinor);
const due = (item: PlanningItem) => item.kind === "goal" ? item.targetOn : item.kind === "obligation" ? item.dueOn : null;

/** Presentation only. Ratios compare exact integers; monetary sorts group currencies. */
export function orderPlanning(items: readonly PlanningItem[], choice: string, today: string): PlanningItem[] {
  return [...items].sort((a,b) => {
    const state = rank(a) - rank(b);
    if (state) return state;
    let result = 0;
    if (choice.startsWith("created_")) return temporalComparator<PlanningItem>(choice === "created_asc" ? "asc" : "desc", item=>item.createdAt,item=>item.id)(a,b);
    if (choice.startsWith("due_")) return temporalComparator<PlanningItem>(choice === "due_asc" ? "asc" : "desc",due,item=>item.id)(a,b);
    if (choice === "usage" || choice.startsWith("progress_")) {
      const numerator = (item:PlanningItem) => BigInt(item.kind === "budget" ? item.spentMinor : item.kind === "goal" ? item.progressMinor : "0");
      const left = amount(a), right = amount(b);
      if (left <= 0n || right <= 0n) result = Number(left <= 0n)-Number(right <= 0n);
      else result = compare(numerator(a)*right,numerator(b)*left)*(choice === "progress_asc" ? 1 : -1);
    } else if (choice === "amount_desc" || choice === "amount_asc" || choice === "remaining" || choice === "uncovered") {
      result = compareIdentity(a.currency,b.currency);
      if (!result) {
        const value = (item:PlanningItem) => choice === "remaining" && item.kind === "budget" ? BigInt(item.limitMinor)-BigInt(item.spentMinor)
          : choice === "uncovered" && item.kind === "obligation" ? BigInt(item.uncoveredMinor) : amount(item);
        result = compare(value(a),value(b))*(choice === "amount_asc" || choice === "remaining" ? 1 : -1);
      }
    } else if (a.kind === "budget" && b.kind === "budget") {
      if (choice === "current") {
        const periodRank = (item:typeof a) => item.periodStart <= today && today <= item.periodEnd ? 0 : item.periodStart > today ? 1 : 2;
        result = periodRank(a)-periodRank(b);
        if (!result && periodRank(a) === 1) result = compareIdentity(a.periodStart,b.periodStart);
      }
      if (!result) result = compareIdentity(b.periodStart,a.periodStart) || compareIdentity(b.periodEnd,a.periodEnd);
    }
    return result || compareIdentity(a.id,b.id);
  });
}
