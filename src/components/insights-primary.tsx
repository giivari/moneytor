"use client";

import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport, ChargeReport, DimensionRow } from "@/lib/analytics/types";
import type { InsightsMonthSelection } from "./use-insights-month";
import { InsightsCarousel, type InsightsSlideSelection } from "./insights-carousel";
import { InsightsDetailPair } from "./insights-detail-pair";
import {
  InsightsCashflowSlide,
  InsightsCategoryDetails,
  InsightsComposition,
  InsightsIntervalDetails,
  InsightsTrendSummary,
  useInsightsVisualTrend,
} from "./insights-visuals";

export function InsightsPrimary({
  report,
  currency,
  exponent,
  selection,
  slides,
  categories,
  charges = [],
  granularity = "auto",
}: {
  report: AnalyticsReport;
  currency: string;
  exponent: number;
  selection?: InsightsMonthSelection;
  slides: InsightsSlideSelection;
  categories: DimensionRow[];
  charges?: ChargeReport[];
  granularity?: AnalyticsGranularity;
}) {
  const model = useInsightsVisualTrend({ report, currency, exponent, selection, granularity });
  const totalCount = categories.length + charges.length;

  if (model.mobile) {
    return (
      <InsightsCarousel selection={slides}>
        {[
          <InsightsTrendSummary key="trend" model={model} inlineDetails />,
          <InsightsComposition key="categories" rows={categories} charges={charges} />,
          <InsightsCashflowSlide key="cashflow" model={model} />,
        ]}
      </InsightsCarousel>
    );
  }

  return (
    <div className="insight-detail-groups">
      <InsightsDetailPair
        label="Grafik pemasukan dan kategori"
        items={[
          {
            key: "intervals",
            title: "Pemasukan & belanja",
            action: "Tabel semua interval",
            content: <InsightsTrendSummary model={model} />,
            details: <InsightsIntervalDetails model={model} />,
          },
          {
            key: "categories",
            title: "Komposisi belanja",
            action: `Semua kategori & biaya (${totalCount})`,
            content: <InsightsComposition rows={categories} charges={charges} inlineDetails={false} />,
            details: <InsightsCategoryDetails rows={categories} charges={charges} />,
          },
        ]}
      />
    </div>
  );
}
