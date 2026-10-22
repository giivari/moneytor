"use client";

import { useEffect, useState } from "react";
import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import { initialInsightsMonth } from "@/lib/analytics/presentation";

export type InsightsMonthSelection = { month: string; select: (month: string) => void };

/** Lives above the loading boundary so a valid manual choice survives a report refresh. */
export function useInsightsMonth(rows: DimensionRow[], report: AnalyticsReport | undefined): InsightsMonthSelection {
  const [manual, setManual] = useState<string | null>(null);
  useEffect(() => {
    if (report && manual && !rows.some((row) => row.key === manual)) setManual(null);
  }, [rows, report, manual]);
  return { month: report ? initialInsightsMonth(rows, report, manual) : "", select: setManual };
}
