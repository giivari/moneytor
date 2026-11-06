import type { AnalyticsReport } from "@/lib/analytics/types";
import { insightsCurrency, periodLabel } from "@/lib/analytics/presentation";
import { InsightsComposition, InsightsVisualTrend } from "./insights-visuals";
import { AppLink } from "./app-link";
import { Card } from "./ui";
import { FinancialAmount } from "./financial-amount";
import { formatMinor } from "@/lib/finance/format";

/** Month (Asia/Jakarta) the report was generated in, i.e. the running month of a monthly trend. */
function reportMonth(report: AnalyticsReport) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit" }).format(new Date(report.generatedAt));
}

/** Belanja bulan ini and its difference with income, from the same report the chart draws; snapshot spending when there is no report. */
function MonthFigures({ report, currency, exponent, expenseMinor }: { report: AnalyticsReport | null; currency: string; exponent: number; expenseMinor: string }) {
  const row = report?.monthly.find((item) => item.currency === currency && item.key === reportMonth(report));
  const money = (value: string) => formatMinor(value, currency, exponent);
  const net = row ? BigInt(row.netMinor) : null;
  return <dl className="home-month-figures">
    <div><dt>Belanja bulan ini</dt><dd><FinancialAmount value={money(row?.spendingMinor ?? expenseMinor)} as="span" className="ui-amount" /></dd></div>
    {row && net !== null && <div><dt>Selisih dengan pemasukan</dt><dd><FinancialAmount value={`${net > 0n ? "+" : ""}${money(row.netMinor)}`} as="span" className={`ui-amount${net < 0n ? " pnl-negative" : net > 0n ? " pnl-positive" : ""}`} /></dd></div>}
  </dl>;
}

/** One bounded P6A report supplies both Beranda charts, without a second snapshot. */
const insightsHref = (currency: string) => `/insights?period=monthly_trend&months=6&currency=${currency}`;

export function HomeTrend({ report, currency, exponent, expenseMinor }: { report: AnalyticsReport | null; currency: string; exponent: number; expenseMinor: string }) {
  const figures = <MonthFigures report={report} currency={currency} exponent={exponent} expenseMinor={expenseMinor} />;
  if (!report) return <Card className="home-trend" title="Arus kas 6 bulan" figures={figures}><p className="ui-muted">Analisis belum tersedia. <AppLink href={insightsHref(currency)}>Buka Analitik</AppLink></p></Card>;
  return <Card className="home-trend" title="Arus kas 6 bulan" meta={`${periodLabel(report.period)} · ${currency}${report.period.partial ? " · Periode berjalan" : ""}`}
    action={<AppLink className="text-link" href={insightsHref(currency)}>Analitik lengkap</AppLink>} figures={figures}>
    <div className="home-chart insights-page" aria-label={`Tren ${currency}`}><InsightsVisualTrend report={report} currency={currency} exponent={exponent} dashboard /></div>
  </Card>;
}

export function HomeComposition({ report, currency }: { report: AnalyticsReport | null; currency: string }) {
  if (!report) return null;
  const data = insightsCurrency(report, currency);
  return <Card className="home-composition" title="Komposisi belanja" meta={`${periodLabel(report.period)} · ${currency}`}>
    <div className="insights-page" aria-label={`Kategori ${currency}`}><InsightsComposition rows={data.categories.rows} charges={data.charges} inlineDetails={false} dashboard /></div>
  </Card>;
}
