"use client";

import { InsightsDisclosure } from "./insights-disclosure";
import { InsightsDetailPair, type InsightsDetailItem } from "./insights-detail-pair";
import { useInsightsViewport } from "./use-insights-viewport";

export function InsightsSecondary({ items }: { items: readonly [InsightsDetailItem, InsightsDetailItem, InsightsDetailItem, InsightsDetailItem] }) {
  const mobile = useInsightsViewport();
  if (mobile) return <div className="insight-secondary-grid">{items.map((item) => <InsightsDisclosure key={item.key} title={item.title} summary={item.mobileSummary ?? item.summary ?? ""}>{item.details}</InsightsDisclosure>)}</div>;
  return <div className="insight-detail-groups">
    <InsightsDetailPair label="Biaya dan akun" items={[items[0], items[1]]} />
    <InsightsDetailPair label="Angka bulanan dan investasi" items={[items[2], items[3]]} />
  </div>;
}
