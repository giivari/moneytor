/** Presentation ordering only. Domains supply their own canonical business time. */
export type SortDirection = "asc" | "desc";
export type TemporalListMode = "history" | "upcoming";
export const temporalSortOptions = {
  history: [{ value: "desc", label: "Terbaru" }, { value: "asc", label: "Terlama" }],
  upcoming: [{ value: "asc", label: "Terdekat" }, { value: "desc", label: "Terjauh" }],
} as const;
export function defaultSortDirection(mode: TemporalListMode): SortDirection { return mode === "upcoming" ? "asc" : "desc"; }
export function isSortDirection(value: unknown): value is SortDirection { return value === "asc" || value === "desc"; }
export function compareIdentity(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
type TimeValue = string | Date | null | undefined;
function timeValue(value: TimeValue) { const result = value == null || value === "" ? NaN : (value instanceof Date ? value.getTime() : new Date(value).getTime()); return Number.isFinite(result) ? result : null; }
export function temporalComparator<T>(direction: SortDirection, time: (item: T) => TimeValue, identity: (item: T) => string) {
  const sign = direction === "asc" ? 1 : -1;
  return (a: T, b: T) => {
    const left = timeValue(time(a)), right = timeValue(time(b));
    // Missing dates always follow dated entries, independent of direction.
    if (left === null && right !== null) return 1;
    if (left !== null && right === null) return -1;
    return sign * ((left !== null && right !== null ? left - right : 0) || compareIdentity(identity(a), identity(b)));
  };
}
export function sortTemporal<T>(items: readonly T[], direction: SortDirection, time: (item: T) => TimeValue, identity: (item: T) => string): T[] {
  return [...items].sort(temporalComparator(direction, time, identity));
}
const collator = new Intl.Collator("id-ID", { sensitivity: "base", numeric: true });
export function sortNamed<T>(items: readonly T[], name: (item: T) => string, identity: (item: T) => string): T[] {
  return [...items].sort((a,b) => collator.compare(name(a),name(b)) || compareIdentity(identity(a),identity(b)));
}
/** SQL identifiers are developer-owned, never accepted from a UI request. */
export function temporalOrderSql(time: string, identity: string, direction: SortDirection = "desc") {
  if (![time,identity].every(value => /^[a-z_]+(?:\.[a-z_]+)?$/.test(value)) || !isSortDirection(direction)) throw new Error("Invalid list order");
  const sqlDirection = direction === "asc" ? "ASC" : "DESC";
  return time + " " + sqlDirection + "," + identity + " " + sqlDirection;
}
