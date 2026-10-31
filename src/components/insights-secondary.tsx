"use client";

import { InsightsDisclosure } from "./insights-disclosure";
import { InsightsDetailPair, type InsightsDetailItem } from "./insights-detail-pair";
import { useInsightsViewport } from "./use-insights-viewport";

export function InsightsSecondary({ items }: { items: readonly [InsightsDetailItem, InsightsDetailItem] }) {
  const mobile = useInsightsViewport();
  if (mobile) {
    return (
      <div className="insight-secondary-grid">
        {items.map((item) => (
          <InsightsDisclosure key={item.key} title={item.title} summary={item.mobileSummary ?? item.summary ?? ""}>
            {item.details}
          </InsightsDisclosure>
        ))}
      </div>
    );
  }
  return (
    <div className="insight-detail-groups">
      <InsightsDetailPair label="Mutasi akun dan posisi aset" items={[items[0], items[1]]} />
    </div>
  );
}
