import type { AnalyticsReport, DimensionRow } from "./types";
import { dayLabel, inclusiveEndDay, monthLabel, plotPercent } from "./presentation.ts";
import { jakartaDay } from "./periods.ts";

export type VisualInterval = {
  key: string; startDay: string; endDayExclusive: string; label: string;
  incomeMinor: string; spendingMinor: string; netMinor: string; activityCount: string;
};
const dayMs = 86400000;
const stamp = (day: string) => Date.parse(`${day}T00:00:00Z`);
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
const sum = (rows: Pick<VisualInterval, "incomeMinor" | "spendingMinor" | "netMinor" | "activityCount">[]) => ({
  incomeMinor: rows.reduce((total, row) => total + BigInt(row.incomeMinor), 0n).toString(),
  spendingMinor: rows.reduce((total, row) => total + BigInt(row.spendingMinor), 0n).toString(),
  netMinor: rows.reduce((total, row) => total + BigInt(row.netMinor), 0n).toString(),
  activityCount: rows.reduce((total, row) => total + BigInt(row.activityCount), 0n).toString(),
});

/** Presentation buckets only. Monday–Sunday Jakarta weeks are clipped to the selected range.
 * Empty calendar buckets are zero; they are not invented financial observations. */
export function visualTrend(report: AnalyticsReport, currency: string, maximum = 6) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 36) throw Error("Batas interval tidak valid");
  const start = stamp(report.period.startDay), end = stamp(report.period.endDayExclusive);
  const weekly = Array.isArray(report.daily) && (end - start) / dayMs <= 62;
  let intervals: VisualInterval[];
  if (weekly) {
    const daily = new Map(report.daily.filter((row) => row.currency === currency).map((row) => [row.key, row]));
    intervals = [];
    for (let cursor = start; cursor < end;) {
      const weekday = (new Date(cursor).getUTCDay() + 6) % 7;
      const next = Math.min(end, cursor + (7 - weekday) * dayMs);
      const rows: DimensionRow[] = [];
      for (let date = cursor; date < next; date += dayMs) {
        const row = daily.get(day(date)); if (row) rows.push(row);
      }
      intervals.push({ key: day(cursor), startDay: day(cursor), endDayExclusive: day(next),
        label: `${dayLabel(day(cursor))} – ${dayLabel(day(next - dayMs))}`, ...sum(rows) });
      cursor = next;
    }
  } else intervals = report.monthly.filter((row) => row.currency === currency).map((row) => {
    const date = new Date(`${row.key}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1);
    const startDay = row.key + "-01" > report.period.startDay ? row.key + "-01" : report.period.startDay;
    const endDayExclusive = day(date.getTime()) < report.period.endDayExclusive ? day(date.getTime()) : report.period.endDayExclusive;
    return { key: row.key, startDay, endDayExclusive, label: monthLabel(row.key), ...sum([row]) };
  });
  const size = Math.max(1, Math.ceil(intervals.length / maximum)), visible: VisualInterval[] = [];
  for (let index = 0; index < intervals.length; index += size) {
    const group = intervals.slice(index, index + size), first = group[0], last = group.at(-1)!;
    visible.push({ key: first.key, startDay: first.startDay, endDayExclusive: last.endDayExclusive,
      label: group.length === 1 ? first.label : `${dayLabel(first.startDay)} – ${dayLabel(inclusiveEndDay(last.endDayExclusive))}`,
      ...sum(group) });
  }
  return { intervals: visible, fullIntervals: intervals, weekly, grouped: size > 1 };
}

export function initialVisualInterval(rows: VisualInterval[], report: AnalyticsReport, month?: string) {
  const today = jakartaDay(new Date(report.generatedAt));
  const contains = (row: VisualInterval, date: string) => row.startDay <= date && date < row.endDayExclusive;
  if (month && month !== today.slice(0, 7)) {
    const matching = rows.filter((row) => row.startDay.slice(0, 7) <= month && inclusiveEndDay(row.endDayExclusive).slice(0, 7) >= month);
    if (matching.length) return matching.filter((row) => BigInt(row.activityCount) > 0n).at(-1)?.key ?? matching.at(-1)!.key;
  }
  return rows.find((row) => contains(row, today))?.key
    ?? rows.filter((row) => row.startDay <= today && BigInt(row.activityCount) > 0n).at(-1)?.key
    ?? rows.filter((row) => row.startDay <= today).at(-1)?.key ?? rows[0]?.key ?? "";
}

export function visualIntervalState(row: VisualInterval, report: AnalyticsReport) {
  const today = jakartaDay(new Date(report.generatedAt));
  return today < row.startDay ? "Belum dimulai" : today >= row.endDayExclusive ? "Selesai" : "Berjalan";
}

/** Short axis labels accompany exact clipped interval labels, never substitute for them. */
export function visualIntervalAxis(row: VisualInterval, weekly: boolean) {
  const start = row.startDay, end = inclusiveEndDay(row.endDayExclusive);
  const year = start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}–${end.slice(0, 4)}`;
  if (weekly) return { label: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`)), year };
  const firstQuarter = Math.floor((Number(start.slice(5, 7)) - 1) / 3) + 1;
  const lastQuarter = Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1;
  const fullQuarter = start.endsWith("-01") && Number(start.slice(5, 7)) % 3 === 1
    && Number(end.slice(5, 7)) % 3 === 0 && row.endDayExclusive.endsWith("-01");
  if (fullQuarter && start.slice(0, 4) === end.slice(0, 4) && firstQuarter === lastQuarter) return { label: `TW${firstQuarter}`, year };
  const first = monthLabel(start.slice(0, 7)).split(" ")[0], last = monthLabel(end.slice(0, 7)).split(" ")[0];
  return { label: start.slice(0, 7) === end.slice(0, 7) ? first : `${first}–${last}`, year };
}

/** Spending-only denominator; rejects mixed currencies rather than implicitly converting. */
export function spendingShares(rows: DimensionRow[]) {
  if (new Set(rows.map((row) => row.currency)).size > 1) throw Error("Pilih satu mata uang");
  const total = rows.reduce((value, row) => value + BigInt(row.spendingMinor), 0n);
  let offset = 0;
  return { totalMinor: total.toString(), rows: rows.map((row) => {
    const percent = plotPercent(row.spendingMinor, total), start = offset;
    offset += percent;
    return { ...row, percent, offset: start, shareBps: total > 0n ? (BigInt(row.spendingMinor) * 10000n / total).toString() : null };
  }) };
}

export function carouselPosition(left: number, positions: number[]) {
  return positions.reduce((best, position, index) => Math.abs(left - position) < Math.abs(left - positions[best]) ? index : best, 0);
}
