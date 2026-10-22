import type { AnalyticsReport } from "@/lib/analytics/types";
import { insightsCurrency, periodLabel } from "@/lib/analytics/presentation";
import { InsightsComposition, InsightsVisualTrend } from "./insights-visuals";
import { AppLink } from "./app-link";

/** A single bounded P6A report supplies both charts, without a second Home snapshot. */
export function HomeAnalytics({ report, currency, exponent }: { report: AnalyticsReport | null; currency: string; exponent: number }) {
  const href = `/insights?period=monthly_trend&months=6&currency=${currency}`;
  if (!report) return <p className="home-desktop-only home-analytics-unavailable">Analisis belum tersedia. <AppLink href={href}>Buka Insights</AppLink></p>;
  const data = insightsCurrency(report, currency);
  return <div className="home-analytics insights-page home-desktop-only">
    <div className="home-chart-range"><span>{periodLabel(report.period)} · {currency}{report.period.partial ? " · Periode berjalan" : ""}</span><AppLink className="text-link" href={href}>Lihat analisis lengkap</AppLink></div>
    <div className="home-chart-grid">
      <section className="surface home-trend" aria-label={`Tren ${currency}`}><InsightsVisualTrend report={report} currency={currency} exponent={exponent} dashboard /></section>
      <section className="surface home-composition" aria-label={`Kategori ${currency}`}><InsightsComposition rows={data.categories.rows} inlineDetails={false} /></section>
    </div>
  </div>;
}
