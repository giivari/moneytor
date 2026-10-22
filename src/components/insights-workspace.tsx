"use client";

import { useEffect, useState } from "react";
import type { AnalyticsReport } from "@/lib/analytics/types";
import { insightsDraft, insightsQuery, periodLabel, type InsightsDraft } from "@/lib/analytics/presentation";
import { useInsightsReport } from "./use-insights-report";
import { InsightsReportView } from "./insights-report";
import { useInsightsMonth } from "./use-insights-month";

export function InsightsLoadState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
  if (loading) return <div className="surface insight-state" role="status"><span className="insight-loading" aria-hidden="true" />Memuat laporan…</div>;
  if (error) return <div className="surface insight-state" role="alert"><p>{error}</p><button className="finance-secondary" onClick={retry}>Coba lagi</button></div>;
  return null;
}

export function InsightsWorkspace({ initial, initialQuery, initialError, currencies }: {
  initial: AnalyticsReport | null; initialQuery: string; initialError: string;
  currencies: { currency: string; exponent: number }[];
}) {
  const state = useInsightsReport(initial, initialQuery, initialError);
  const [draft, setDraft] = useState(() => insightsDraft(initialQuery));
  const [inputError, setInputError] = useState("");
  const [slide, setSlide] = useState(0);
  const selected = new URLSearchParams(state.query).get("currency") ?? state.report?.summary[0]?.currency ?? "";
  const monthSelection = useInsightsMonth(state.report?.monthly?.filter((row) => row.currency === selected) ?? [], state.report);
  const defaultCurrency = currencies.find((row) => row.currency === "IDR")?.currency ?? currencies[0]?.currency ?? "";
  const choices = [...new Set([...currencies.map((row) => row.currency), ...(initial?.summary.map((row) => row.currency) ?? []), draft.currency].filter(Boolean))];
  const set = (key: keyof InsightsDraft, value: string) => { setDraft((current) => ({ ...current, [key]: value })); setInputError(""); };
  let dirty = true;
  try { dirty = insightsQuery(draft) !== state.query; } catch { /* Invalid drafts remain editable. */ }
  const apply = state.apply;
  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has("period")) params.set("period", "current_month");
      if (!params.has("currency") && defaultCurrency) params.set("currency", defaultCurrency);
      const query = params.toString();
      setDraft(insightsDraft(query)); setInputError(""); apply(query);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [apply, defaultCurrency]);
  return <div className="insight-workspace">
    <details className="surface insight-filter-disclosure">
      <summary><span><strong>{state.report ? periodLabel(state.report.period) : "Periode laporan"}</strong><small>{selected || "Pilih mata uang"} · Asia/Jakarta</small></span></summary>
    <form className="surface insight-controls" onSubmit={(event) => {
      event.preventDefault();
      try {
        const query = insightsQuery(draft); setInputError("");
        window.history.pushState(null, "", `${window.location.pathname}?${query}`);
        apply(query);
      } catch (cause) { setInputError(cause instanceof Error ? cause.message : "Rentang tanggal tidak valid."); }
    }}>
      <div className="insight-control-fields">
        <label className="field"><span>Periode</span><select value={draft.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="current_month">Bulan ini</option><option value="previous_month">Bulan lalu</option>
          <option value="current_year">Tahun ini</option><option value="monthly_trend">Tren bulanan</option><option value="custom">Rentang tanggal</option>
        </select></label>
        {choices.length > 0 && <label className="field"><span>Mata uang</span><select value={draft.currency} required onChange={(e) => set("currency", e.target.value)}>
          {!draft.currency && <option value="" disabled>Pilih mata uang</option>}{choices.map((code) => <option key={code}>{code}</option>)}
        </select></label>}
        {draft.kind === "monthly_trend" && <label className="field"><span>Jumlah bulan</span><input type="number" min="1" max="36" step="1" required value={draft.months} onChange={(e) => set("months", e.target.value)} /></label>}
        {draft.kind === "custom" && <><label className="field"><span>Dari tanggal</span><input type="date" required value={draft.start} onChange={(e) => set("start", e.target.value)} /></label>
          <label className="field"><span>Sampai tanggal</span><input type="date" required value={draft.end} onChange={(e) => set("end", e.target.value)} /></label></>}
        <button className="button-primary" type="submit">Terapkan</button>
      </div>
      {inputError && <p className="insight-input-error" role="alert">{inputError}</p>}
      {dirty && !inputError && <p className="insight-note">Tekan Terapkan untuk menampilkan pilihan ini.</p>}
    </form>
    </details>
    <div aria-busy={state.loading}>
      <InsightsLoadState loading={state.loading} error={state.error} retry={state.retry} />
      {state.report && <InsightsReportView key={state.query} report={state.report} currency={selected} monthSelection={monthSelection} slideSelection={{ index: slide, select: setSlide }} periodKind={new URLSearchParams(state.query).get("period") ?? "current_month"} />}
    </div>
  </div>;
}
