import type { AnalyticsReport, DimensionRow } from "./types";
import { analyticsFilters } from "./filters.ts";
import { jakartaDay, previousPeriod, reportingPeriod } from "./periods.ts";
import { formatMinor } from "../finance/format.ts";

export type InsightsDraft = { kind: string; currency: string; months: string; start: string; end: string };
export function inclusiveEndDay(day: string) {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function insightsDraft(query: string, currency = "", now = new Date()): InsightsDraft {
  const params = new URLSearchParams(query), current = reportingPeriod({ kind: "current_month" }, now);
  return { kind: params.get("period") ?? "current_month", currency: params.get("currency") ?? currency,
    months: params.get("months") ?? "6", start: params.get("start") ?? current.startDay,
    end: params.get("end") ?? inclusiveEndDay(current.endDayExclusive) };
}
export function insightsQuery(draft: InsightsDraft): string {
  const params = new URLSearchParams({ period: draft.kind });
  if (draft.currency) params.set("currency", draft.currency);
  if (draft.kind === "monthly_trend") params.set("months", draft.months);
  if (draft.kind === "custom") { params.set("start", draft.start); params.set("end", draft.end); }
  const filters = analyticsFilters(params), now = new Date(), period = reportingPeriod(filters.period, now);
  previousPeriod(filters.period, period, now);
  return params.toString();
}
export function dayLabel(day: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}
export function periodLabel(period: AnalyticsReport["period"]) {
  return `${dayLabel(period.startDay)} – ${dayLabel(inclusiveEndDay(period.endDayExclusive))}`;
}
export function monthLabel(key: string) {
  return new Intl.DateTimeFormat("id-ID", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`));
}
export function percentageLabel(bps: string | null, signed = false): string {
  if (bps === null) return "—";
  const value = BigInt(bps), absolute = value < 0n ? -value : value;
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${value < 0n ? "−" : signed && value > 0n ? "+" : ""}${absolute / 100n},${fraction}%`;
}
/** These bounded Number conversions are chart geometry, never monetary calculations. */
export function plotPercent(value: string | bigint, maximum: bigint): number {
  if (maximum <= 0n) return 0;
  const amount = BigInt(value), clamped = amount < 0n ? 0n : amount > maximum ? maximum : amount;
  return Number(clamped * 10000n / maximum) / 100;
}
export function categoryShares(rows: DimensionRow[]) {
  if (new Set(rows.map((row) => row.currency)).size > 1) throw Error("Kategori harus dipilih per mata uang");
  const total = rows.reduce((sum, row) => sum + BigInt(row.spendingMinor), 0n);
  return { totalMinor: total.toString(), rows: rows.map((row) => ({ ...row,
    shareBps: total > 0n ? (BigInt(row.spendingMinor) * 10000n / total).toString() : null,
    plotPercent: plotPercent(row.spendingMinor, total) })) };
}
export function signedMoney(value: string, currency: string, exponent: number) {
  return `${BigInt(value) > 0n ? "+" : ""}${formatMinor(value, currency, exponent)}`;
}
export function compactAxisMoney(value: bigint, currency: string, exponent: number) {
  const scale = 10n ** BigInt(exponent);
  for (const [size, label] of [[1000000000000n, "T"], [1000000000n, "M"], [1000000n, "jt"], [1000n, "rb"]] as const) {
    if (value >= size * scale) {
      const tenths = value * 10n / (size * scale);
      return `${currency === "IDR" ? "Rp" : `${currency} `}${tenths / 10n},${tenths % 10n} ${label}`;
    }
  }
  return formatMinor(value, currency, exponent);
}
export function originLabel(key: string) {
  return ({ manual: "Manual", automation: "Automation", allocation_adjustment: "Penyesuaian alokasi" } as Record<string, string>)[key] ?? key;
}
/** Transfer costs may include tax/other catalogs; only fee-bucket costs partition feesMinor. */
export function feePartition(charges: AnalyticsReport["charges"]) {
  let service = 0n, transfer = 0n;
  for (const charge of charges) if (charge.bucket === "fee") {
    if (charge.activityKind === "transfer") transfer += BigInt(charge.amountMinor);
    else service += BigInt(charge.amountMinor);
  }
  return { serviceMinor: service.toString(), transferMinor: transfer.toString() };
}
export function monthState(key: string, report: AnalyticsReport) {
  const current = jakartaDay(new Date(report.generatedAt)).slice(0, 7);
  return key === current ? "Berjalan" : key > current ? "Belum dimulai" : "Selesai";
}
/** Calendar preference, not an aggregation: a valid explicit selection takes precedence. */
export function initialInsightsMonth(rows: DimensionRow[], report: AnalyticsReport, manual: string | null = null) {
  if (!rows.length) return "";
  if (manual && rows.some((row) => row.key === manual)) return manual;
  const current = jakartaDay(new Date(report.generatedAt)).slice(0, 7);
  if (rows.some((row) => row.key === current)) return current;
  const past = rows.filter((row) => row.key < current).sort((a, b) => a.key.localeCompare(b.key));
  return past.filter((row) => BigInt(row.activityCount) > 0n).at(-1)?.key
    ?? past.at(-1)?.key ?? [...rows].sort((a, b) => a.key.localeCompare(b.key))[0]?.key ?? "";
}
export function insightsTrendLayout(count: number) {
  const compact = count <= 2;
  const width = count <= 1 ? 280 : count === 2 ? 340 : Math.max(480, count * 90 + 120);
  const height = compact ? 208 : 272, bottom = height - 54, top = 24;
  return { compact, width, height, bottom, top, step: count > 0 ? (width - 120) / count : 0 };
}
/** Reveal only inside the horizontal chart viewport; an already-visible month does not move. */
export function insightsMonthScroll(scroll: number, viewport: number, left: number, right: number, maximum: number) {
  if (viewport <= 0 || (left >= scroll + 12 && right <= scroll + viewport - 12)) return scroll;
  return Math.max(0, Math.min(maximum, (left + right - viewport) / 2));
}
/** Select aggregate dimensions only. No activity replay, FX, or new canonical total. */
export function insightsCurrency(report: AnalyticsReport, currency: string) {
  return { summary: report.summary.find((row) => row.currency === currency),
    categories: categoryShares(report.byCategory.filter((row) => row.currency === currency)),
    monthly: report.monthly.filter((row) => row.currency === currency), charges: report.charges.filter((row) => row.currency === currency),
    accounts: report.byAccount.filter((row) => row.currency === currency), origins: report.byOrigin.filter((row) => row.currency === currency),
    comparison: report.comparison.currencies.find((row) => row.currency === currency),
    assets: report.context?.currencies.find((row) => row.currency === currency),
    investment: report.context?.investments.find((row) => row.currency === currency),
    flows: report.investmentFlows.find((row) => row.currency === currency) };
}
