import type { AnalyticsReport, ChargeReport, DimensionRow } from "./types";
import { dayLabel, inclusiveEndDay, monthLabel, plotPercent } from "./presentation.ts";
import { jakartaDay, type AnalyticsGranularity } from "./periods.ts";

export type VisualInterval = {
  key: string; startDay: string; endDayExclusive: string; label: string;
  incomeMinor: string; spendingMinor: string; netMinor: string; activityCount: string;
};
export type ResolvedGranularity = "day" | "week" | "month" | "year";

const dayMs = 86400000;
const stamp = (day: string) => Date.parse(`${day}T00:00:00Z`);
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
const sum = (rows: Pick<VisualInterval, "incomeMinor" | "spendingMinor" | "netMinor" | "activityCount">[]) => ({
  incomeMinor: rows.reduce((total, row) => total + BigInt(row.incomeMinor), 0n).toString(),
  spendingMinor: rows.reduce((total, row) => total + BigInt(row.spendingMinor), 0n).toString(),
  netMinor: rows.reduce((total, row) => total + BigInt(row.netMinor), 0n).toString(),
  activityCount: rows.reduce((total, row) => total + BigInt(row.activityCount), 0n).toString(),
});

/** Presentation buckets only. Supports explicit day/week/month/year or automatic selection.
 * Empty calendar buckets are zero; they are not invented financial observations. */
export function visualTrend(
  report: AnalyticsReport,
  currency: string,
  maximum = 6,
  granularity: AnalyticsGranularity = "auto",
) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 62) throw Error("Batas interval tidak valid");
  const start = stamp(report.period.startDay), end = stamp(report.period.endDayExclusive);
  const spanDays = (end - start) / dayMs;
  const resolved: ResolvedGranularity =
    granularity !== "auto"
      ? granularity
      : Array.isArray(report.daily) && spanDays <= 62
        ? "week"
        : "month";

  const weekly = resolved === "week";
  let intervals: VisualInterval[];

  if (resolved === "day") {
    const daily = new Map((report.daily ?? []).filter((row) => row.currency === currency).map((row) => [row.key, row]));
    intervals = [];
    for (let cursor = start; cursor < end; cursor += dayMs) {
      const key = day(cursor);
      const next = cursor + dayMs;
      const row = daily.get(key);
      intervals.push({
        key,
        startDay: key,
        endDayExclusive: day(next),
        label: dayLabel(key),
        ...sum(row ? [row] : []),
      });
    }
  } else if (resolved === "week") {
    const daily = new Map((report.daily ?? []).filter((row) => row.currency === currency).map((row) => [row.key, row]));
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
  } else if (resolved === "year") {
    const monthlyRows = report.monthly.filter((row) => row.currency === currency);
    const byYear = new Map<string, DimensionRow[]>();
    for (const row of monthlyRows) {
      const yr = row.key.slice(0, 4);
      const list = byYear.get(yr) ?? [];
      list.push(row);
      byYear.set(yr, list);
    }
    const startYr = Number(report.period.startDay.slice(0, 4));
    const endYr = Number(inclusiveEndDay(report.period.endDayExclusive).slice(0, 4));
    intervals = [];
    for (let yr = startYr; yr <= endYr; yr++) {
      const yrStr = String(yr);
      const yrStart = `${yrStr}-01-01` > report.period.startDay ? `${yrStr}-01-01` : report.period.startDay;
      const yrEndExcl = `${yr + 1}-01-01` < report.period.endDayExclusive ? `${yr + 1}-01-01` : report.period.endDayExclusive;
      intervals.push({
        key: yrStr,
        startDay: yrStart,
        endDayExclusive: yrEndExcl,
        label: `Tahun ${yrStr}`,
        ...sum(byYear.get(yrStr) ?? []),
      });
    }
  } else {
    intervals = report.monthly.filter((row) => row.currency === currency).map((row) => {
      const date = new Date(`${row.key}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1);
      const startDay = row.key + "-01" > report.period.startDay ? row.key + "-01" : report.period.startDay;
      const endDayExclusive = day(date.getTime()) < report.period.endDayExclusive ? day(date.getTime()) : report.period.endDayExclusive;
      return { key: row.key, startDay, endDayExclusive, label: monthLabel(row.key), ...sum([row]) };
    });
  }

  const size = Math.max(1, Math.ceil(intervals.length / maximum)), visible: VisualInterval[] = [];
  for (let index = 0; index < intervals.length; index += size) {
    const group = intervals.slice(index, index + size), first = group[0], last = group.at(-1)!;
    visible.push({ key: first.key, startDay: first.startDay, endDayExclusive: last.endDayExclusive,
      label: group.length === 1 ? first.label : `${dayLabel(first.startDay)} – ${dayLabel(inclusiveEndDay(last.endDayExclusive))}`,
      ...sum(group) });
  }
  return { intervals: visible, fullIntervals: intervals, weekly, granularity: resolved, grouped: size > 1 };
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
export function visualIntervalAxis(row: VisualInterval, weekly: boolean, granularity?: ResolvedGranularity) {
  const start = row.startDay, end = inclusiveEndDay(row.endDayExclusive);
  const year = start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}–${end.slice(0, 4)}`;
  if (granularity === "year") return { label: year, year };
  if (weekly || granularity === "day") return { label: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`)), year };
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

export function incomeShares(rows: DimensionRow[]) {
  if (new Set(rows.map((row) => row.currency)).size > 1) throw Error("Pilih satu mata uang");
  const total = rows.reduce((value, row) => value + BigInt(row.incomeMinor), 0n);
  let offset = 0;
  return { totalMinor: total.toString(), rows: rows.map((row) => {
    const percent = plotPercent(row.incomeMinor, total), start = offset;
    offset += percent;
    return { ...row, percent, offset: start, shareBps: total > 0n ? (BigInt(row.incomeMinor) * 10000n / total).toString() : null };
  }) };
}

export type CompositionEntry = {
  key: string;
  name: string;
  kind: "category" | "charge";
  badge: "Biaya" | "Pajak" | null;
  subtitle: string | null;
  archived: boolean;
  currency: string;
  exponent: number;
  spendingMinor: string;
  percent: number;
  offset: number;
  shareBps: string | null;
};

export function describeChargeItem(charge: ChargeReport) {
  const badge: "Biaya" | "Pajak" = charge.bucket === "tax" ? "Pajak" : "Biaya";
  const name =
    charge.activityKind === "transfer" && !/transfer/i.test(charge.name)
      ? `${charge.name} (Transfer)`
      : charge.name;
  const subtitle =
    charge.activityKind === "transfer"
      ? `Biaya admin pada transaksi Transfer · ${charge.chargeCount}x`
      : charge.activityKind === "income"
        ? `Potongan/biaya pada transaksi Pemasukan · ${charge.chargeCount}x`
        : charge.bucket === "tax"
          ? `Pajak pada transaksi Pengeluaran · ${charge.chargeCount}x`
          : charge.systemKey === "admin_fee"
            ? `Biaya admin pada transaksi Pengeluaran · ${charge.chargeCount}x`
            : charge.systemKey === "service_fee"
              ? `Biaya layanan pada transaksi Pengeluaran · ${charge.chargeCount}x`
              : `Biaya tambahan pada transaksi Pengeluaran · ${charge.chargeCount}x`;
  return { name, badge, subtitle };
}

export function compositionShares(rows: DimensionRow[], charges?: ChargeReport[]) {
  const currencies = new Set([
    ...rows.map((row) => row.currency),
    ...(charges ?? []).map((charge) => charge.currency),
  ]);
  if (currencies.size > 1) throw Error("Pilih satu mata uang");

  let principalTotal = 0n;
  let chargesTotal = 0n;
  const rawItems: Omit<CompositionEntry, "percent" | "offset" | "shareBps">[] = [];

  for (const row of rows) {
    const rawSpend = BigInt(row.spendingMinor);
    const rawPrincipal =
      charges !== undefined && row.expensePrincipalMinor !== undefined
        ? BigInt(row.expensePrincipalMinor)
        : rawSpend;
    const amount =
      charges !== undefined
        ? rawSpend === 0n
          ? 0n
          : rawPrincipal < rawSpend
            ? rawPrincipal
            : rawSpend
        : rawSpend;
    principalTotal += amount;
    rawItems.push({
      key: row.key,
      name: row.name,
      kind: "category",
      badge: null,
      subtitle: charges !== undefined && rawSpend > amount ? "Pokok kategori (biaya tambahan dirinci terpisah)" : null,
      archived: row.archived,
      currency: row.currency,
      exponent: row.exponent,
      spendingMinor: amount.toString(),
    });
  }

  for (const charge of charges ?? []) {
    const amount = BigInt(charge.amountMinor);
    chargesTotal += amount;
    const desc = describeChargeItem(charge);
    rawItems.push({
      key: `charge:${charge.typeId}:${charge.activityKind}`,
      name: desc.name,
      kind: "charge",
      badge: desc.badge,
      subtitle: desc.subtitle,
      archived: charge.archived,
      currency: charge.currency,
      exponent: charge.exponent,
      spendingMinor: amount.toString(),
    });
  }

  const sorted = [...rawItems].sort((a, b) =>
    BigInt(a.spendingMinor) === BigInt(b.spendingMinor)
      ? a.name.localeCompare(b.name)
      : BigInt(a.spendingMinor) > BigInt(b.spendingMinor)
        ? -1
        : 1,
  );
  const total = principalTotal + chargesTotal;
  let offset = 0;
  return {
    totalMinor: total.toString(),
    principalTotalMinor: principalTotal.toString(),
    chargesTotalMinor: chargesTotal.toString(),
    rows: sorted.map((item) => {
      const percent = plotPercent(item.spendingMinor, total);
      const start = offset;
      offset += percent;
      return {
        ...item,
        percent,
        offset: start,
        shareBps: total > 0n ? ((BigInt(item.spendingMinor) * 10000n) / total).toString() : null,
      };
    }),
  };
}

export function carouselPosition(left: number, positions: number[]) {
  return positions.reduce((best, position, index) => Math.abs(left - position) < Math.abs(left - positions[best]) ? index : best, 0);
}
