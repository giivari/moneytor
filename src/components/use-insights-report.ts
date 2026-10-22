"use client";

import { useCallback, useState } from "react";
import { requestJson } from "@/lib/finance/client";
import type { AnalyticsReport } from "@/lib/analytics/types";
import { useListRequest } from "./use-list-request";

export function useInsightsReport(initial: AnalyticsReport | null, initialQuery: string, initialError: string) {
  const [request, setRequest] = useState({ query: initialQuery, sequence: 0 });
  const load = useCallback((signal: AbortSignal) => requestJson<AnalyticsReport>(`/api/analytics?${request.query}`, { cache: "no-store", signal }), [request.query]);
  const state = useListRequest({ enabled: request.sequence > 0, scope: request.query,
    requestKey: `${request.query}#${request.sequence}`, revision: initial, load,
    initial: initial ? { scope: initialQuery, requestKey: `${initialQuery}#0`, value: initial } : undefined });
  const error = request.sequence === 0 ? initialError : state.error;
  const apply = useCallback((query: string) => setRequest((current) => ({ query, sequence: current.sequence + 1 })), []);
  const retry = useCallback(() => setRequest((current) => ({ ...current, sequence: current.sequence + 1 })), []);
  return { query: request.query, loading: state.loading, error,
    report: state.loading || error ? undefined : request.sequence === 0 ? initial ?? undefined : state.data,
    apply, retry };
}
