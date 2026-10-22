"use client";

import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import type { InsightsMonthSelection } from "./use-insights-month";
import { InsightsCarousel, type InsightsSlideSelection } from "./insights-carousel";
import { InsightsDetailPair } from "./insights-detail-pair";
import { InsightsCategoryDetails, InsightsComposition, InsightsIntervalDetails, InsightsOrigins, InsightsTrendSummary, useInsightsVisualTrend } from "./insights-visuals";

export function InsightsPrimary({ report, currency, exponent, selection, slides, categories, origins }: {
  report: AnalyticsReport; currency: string; exponent: number; selection?: InsightsMonthSelection;
  slides: InsightsSlideSelection; categories: DimensionRow[]; origins: DimensionRow[];
}) {
  const model = useInsightsVisualTrend({ report, currency, exponent, selection });
  if (model.mobile) return <InsightsCarousel selection={slides}>{[
    <InsightsTrendSummary key="trend" model={model} inlineDetails />,
    <InsightsComposition key="categories" rows={categories} />,
    <InsightsOrigins key="origins" rows={origins} />,
  ]}</InsightsCarousel>;
  return <div className="insight-detail-groups">
    <InsightsDetailPair label="Grafik pemasukan dan kategori" items={[
      { key: "intervals", title: "Pemasukan & belanja", action: "Angka semua interval", content: <InsightsTrendSummary model={model} />, details: <InsightsIntervalDetails model={model} /> },
      { key: "categories", title: "Komposisi belanja", action: `Semua kategori (${categories.length})`, content: <InsightsComposition rows={categories} inlineDetails={false} />, details: <InsightsCategoryDetails rows={categories} /> },
    ]} />
    <section className="surface insight-panel insight-origin-section"><InsightsOrigins rows={origins} /></section>
  </div>;
}
