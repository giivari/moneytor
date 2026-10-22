export const ANALYTICS_TIME_ZONE = "Asia/Jakarta";
export type PeriodInput =
  | { kind: "current_month" | "previous_month" | "current_year" }
  | { kind: "monthly_trend"; months?: number }
  | { kind: "custom"; startDay: string; endDay: string };
export type ReportingPeriod = {
  startDay: string; endDayExclusive: string; startAt: string; endAt: string;
  timeZone: typeof ANALYTICS_TIME_ZONE; partial: boolean;
};

function dayDate(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < "1900-01-01" || day > "9998-12-31") throw Error("Tanggal laporan tidak valid");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw Error("Tanggal laporan tidak valid");
  return date;
}
export function jakartaDay(now: Date): string {
  if (Number.isNaN(now.getTime())) throw Error("Waktu laporan tidak valid");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ANALYTICS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return ["year", "month", "day"].map((key) => parts.find((part) => part.type === key)!.value).join("-");
}
function shiftDay(day: string, count: number) {
  const date = dayDate(day); date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function monthStart(day: string, offset = 0) {
  const date = dayDate(day); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}
export function periodBetween(startDay: string, endDayExclusive: string, now: Date): ReportingPeriod {
  const start = dayDate(startDay), end = dayDate(endDayExclusive);
  const days = (end.getTime() - start.getTime()) / 86400000;
  if (days <= 0 || days > 1096) throw Error("Rentang laporan harus 1–1096 hari");
  const startAt = new Date(`${startDay}T00:00:00+07:00`).toISOString();
  const endAt = new Date(`${endDayExclusive}T00:00:00+07:00`).toISOString();
  return { startDay, endDayExclusive, startAt, endAt, timeZone: ANALYTICS_TIME_ZONE, partial: endAt > now.toISOString() };
}
export function reportingPeriod(input: PeriodInput = { kind: "current_month" }, now = new Date()): ReportingPeriod {
  const today = jakartaDay(now);
  switch (input.kind) {
    case "current_month": return periodBetween(monthStart(today), monthStart(today, 1), now);
    case "previous_month": return periodBetween(monthStart(today, -1), monthStart(today), now);
    case "current_year": return periodBetween(`${today.slice(0, 4)}-01-01`, `${Number(today.slice(0, 4)) + 1}-01-01`, now);
    case "monthly_trend": {
      const months = input.months ?? 6;
      if (!Number.isInteger(months) || months < 1 || months > 36) throw Error("Tren dibatasi 1–36 bulan");
      return periodBetween(monthStart(today, 1 - months), monthStart(today, 1), now);
    }
    case "custom": return periodBetween(input.startDay, shiftDay(input.endDay, 1), now);
    default: throw Error("Periode laporan tidak valid");
  }
}
/** Full prior calendar period for calendar reports; equal day count for custom ranges. */
export function previousPeriod(input: PeriodInput, current: ReportingPeriod, now: Date): ReportingPeriod {
  if (input.kind === "current_month" || input.kind === "previous_month") return periodBetween(monthStart(current.startDay, -1), current.startDay, now);
  if (input.kind === "current_year") return periodBetween(`${Number(current.startDay.slice(0, 4)) - 1}-01-01`, current.startDay, now);
  if (input.kind === "monthly_trend") return periodBetween(monthStart(current.startDay, -(input.months ?? 6)), current.startDay, now);
  const days = (dayDate(current.endDayExclusive).getTime() - dayDate(current.startDay).getTime()) / 86400000;
  return periodBetween(shiftDay(current.startDay, -days), current.startDay, now);
}
export function monthKeys(period: ReportingPeriod): string[] {
  const result: string[] = [];
  for (let day = monthStart(period.startDay); day < period.endDayExclusive; day = monthStart(day, 1)) result.push(day.slice(0, 7));
  return result;
}
