import type { AnalyticsReport } from "@/lib/analytics/types";
import { insightsCurrency, periodLabel } from "@/lib/analytics/presentation";
import { InsightsComposition, InsightsVisualTrend } from "./insights-visuals";
import { AppLink } from "./app-link";
import { HomeCard } from "./home-card";

/** One bounded P6A report supplies both Beranda charts, without a second snapshot. */
const insightsHref = (currency: string) => `/insights?period=monthly_trend&months=6&currency=${currency}`;

export function HomeTrend({ report, currency, exponent }: { report: AnalyticsReport | null; currency: string; exponent: number }) {
  if (!report) return <HomeCard className="home-trend" title="Arus kas 6 bulan"><p className="home-muted">Analisis belum tersedia. <AppLink href={insightsHref(currency)}>Buka Analitik</AppLink></p></HomeCard>;
  return <HomeCard className="home-trend" title="Arus kas 6 bulan" meta={`${periodLabel(report.period)} · ${currency}${report.period.partial ? " · Periode berjalan" : ""}`}
    action={<AppLink className="text-link" href={insightsHref(currency)}>Analitik lengkap</AppLink>}>
    <div className="home-chart insights-page" aria-label={`Tren ${currency}`}><InsightsVisualTrend report={report} currency={currency} exponent={exponent} dashboard /></div>
  </HomeCard>;
}

export function HomeComposition({ report, currency }: { report: AnalyticsReport | null; currency: string }) {
  if (!report) return null;
  const data = insightsCurrency(report, currency);
  return <HomeCard className="home-composition" title="Komposisi belanja" meta={`${periodLabel(report.period)} · ${currency}`}>
    <div className="insights-page" aria-label={`Kategori ${currency}`}><InsightsComposition rows={data.categories.rows} charges={data.charges} inlineDetails={false} dashboard /></div>
  </HomeCard>;
}
