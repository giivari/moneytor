"use client";

import { useEffect, useState } from "react";
import { Info } from "@phosphor-icons/react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport } from "@/lib/analytics/types";
import { insightsDraft, insightsQuery, periodLabel, type InsightsDraft } from "@/lib/analytics/presentation";
import { formatMinor } from "@/lib/finance/format";
import { useInsightsReport } from "./use-insights-report";
import { InsightsReportView } from "./insights-report";
import { useInsightsMonth } from "./use-insights-month";
import { ExcelStatusBar } from "./excel-status-bar";

const QUICK_PERIODS = [
  { kind: "last_7_days", label: "1 Minggu" },
  { kind: "last_30_days", label: "1 Bulan" },
  { kind: "current_month", label: "Bulan Ini" },
  { kind: "previous_month", label: "Bulan Lalu" },
  { kind: "last_3_months", label: "3 Bulan" },
  { kind: "last_6_months", label: "6 Bulan" },
  { kind: "last_1_year", label: "1 Tahun" },
  { kind: "current_year", label: "Tahun Ini" },
  { kind: "last_5_years", label: "5 Tahun" },
] as const;

const GRANULARITY_CHOICES: { value: AnalyticsGranularity; label: string }[] = [
  { value: "auto", label: "Grafik: Otomatis" },
  { value: "day", label: "Per Hari" },
  { value: "week", label: "Per Minggu" },
  { value: "month", label: "Per Bulan" },
  { value: "year", label: "Per Tahun" },
];

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
  const queryParams = new URLSearchParams(state.query);
  const selected = queryParams.get("currency") ?? state.report?.summary[0]?.currency ?? "";
  const activePeriod = queryParams.get("period") ?? "current_month";
  const activeGranularity: AnalyticsGranularity =
    (["day", "week", "month", "year"] as const).find((item) => item === queryParams.get("granularity")) ?? "auto";
  const monthSelection = useInsightsMonth(state.report?.monthly?.filter((row) => row.currency === selected) ?? [], state.report);
  const defaultCurrency = currencies.find((row) => row.currency === "IDR")?.currency ?? currencies[0]?.currency ?? "";
  const choices = [...new Set([...currencies.map((row) => row.currency), ...(initial?.summary.map((row) => row.currency) ?? []), draft.currency].filter(Boolean))];
  const apply = state.apply;

  function commitDraft(nextDraft: InsightsDraft) {
    const withCurrency: InsightsDraft = {
      ...nextDraft,
      currency: nextDraft.currency || selected || defaultCurrency,
    };
    setDraft(withCurrency);
    try {
      const query = insightsQuery(withCurrency);
      setInputError("");
      if (query !== state.query) {
        if (typeof window !== "undefined") {
          window.history.pushState(null, "", `${window.location.pathname}?${query}`);
        }
        apply(query);
      }
    } catch (cause) {
      setInputError(cause instanceof Error ? cause.message : "Rentang tanggal tidak valid.");
    }
  }

  useEffect(() => {
    const pop = () => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has("period")) params.set("period", "current_month");
      if (!params.has("currency") && defaultCurrency) params.set("currency", defaultCurrency);
      const query = params.toString();
      setDraft(insightsDraft(query));
      setInputError("");
      apply(query);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [apply, defaultCurrency]);

  const [analyticsMode, setAnalyticsMode] = useState<"consumption" | "cashflow">("consumption");
  const isCustom = draft.kind === "custom";
  const isTrendMonths = draft.kind === "monthly_trend";
  const summaryItem = state.report?.summary.find(
    (s) => s.currency === (selected || defaultCurrency)
  ) ?? state.report?.summary[0];

  return (
    <>
      <div className="page-body insight-workspace">
        <div className="insight-mode-bar">
        <div className="fluent-segmented-control" role="radiogroup" aria-label="Mode Analitik">
          <button
            type="button"
            role="radio"
            aria-checked={analyticsMode === "consumption"}
            className={`segmented-button ${analyticsMode === "consumption" ? "active" : ""}`}
            onClick={() => setAnalyticsMode("consumption")}
          >
            Mode Konsumsi Murni
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={analyticsMode === "cashflow"}
            className={`segmented-button ${analyticsMode === "cashflow" ? "active" : ""}`}
            onClick={() => setAnalyticsMode("cashflow")}
          >
            Mode Arus Kas Riil
          </button>
        </div>
        <div className="insight-mode-info">
          <Info size={15} className="insight-mode-icon" aria-hidden="true" />
          {analyticsMode === "consumption" ? (
            <span>
              <strong>Mode Konsumsi Murni:</strong> Hanya menghitung porsi belanja konsumsi pribadi &amp; mengabaikan transfer internal.
            </span>
          ) : (
            <span>
              <strong>Mode Arus Kas Riil:</strong> Menghitung seluruh arus kas keluar dari rekening bank termasuk talangan &amp; mutasi.
            </span>
          )}
        </div>
      </div>

      <section className="surface insight-toolbar" aria-label="Filter periode dan tampilan grafik">
        <div className="insight-toolbar-top">
          <div className="insight-toolbar-period">
            <strong>{state.report ? periodLabel(state.report.period) : "Periode laporan"}</strong>
            <span>{selected || defaultCurrency || "IDR"} · WIB</span>
          </div>
          <div className="insight-toolbar-selects">
            <label className="insight-inline-select">
              <span className="sr-only">Kelompok waktu</span>
              <select
                aria-label="Kelompok waktu"
                value={draft.granularity ?? activeGranularity}
                onChange={(e) => commitDraft({ ...draft, granularity: e.target.value as AnalyticsGranularity })}
              >
                {GRANULARITY_CHOICES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {choices.length > 1 && (
              <label className="insight-inline-select">
                <span className="sr-only">Mata uang</span>
                <select
                  aria-label="Mata uang"
                  value={draft.currency || selected}
                  onChange={(e) => commitDraft({ ...draft, currency: e.target.value })}
                >
                  {choices.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="insight-inline-select insight-period-select-mobile">
              <span className="sr-only">Rentang waktu</span>
              <select
                aria-label="Rentang waktu laporan"
                value={isCustom ? "custom" : draft.kind}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "custom") {
                    commitDraft({ ...draft, kind: "custom" });
                  } else {
                    commitDraft({ ...draft, kind: val });
                  }
                }}
              >
                {QUICK_PERIODS.map((preset) => (
                  <option key={preset.kind} value={preset.kind}>
                    {preset.label}
                  </option>
                ))}
                <option value="custom">Kustom...</option>
              </select>
            </label>
          </div>
        </div>

        <div className="insight-pill-scroller insight-period-pills-desktop" role="group" aria-label="Rentang waktu">
          {QUICK_PERIODS.map((preset) => (
            <button
              key={preset.kind}
              type="button"
              className="insight-pill"
              data-active={draft.kind === preset.kind ? "true" : "false"}
              onClick={() => commitDraft({ ...draft, kind: preset.kind })}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            className="insight-pill"
            data-active={isCustom ? "true" : "false"}
            onClick={() => commitDraft({ ...draft, kind: "custom" })}
          >
            Kustom
          </button>
        </div>

        {isCustom && (
          <div className="insight-custom-dates">
            <label className="field">
              <span>Dari tanggal</span>
              <input
                type="date"
                value={draft.start}
                onChange={(e) => commitDraft({ ...draft, kind: "custom", start: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Sampai tanggal</span>
              <input
                type="date"
                value={draft.end}
                onChange={(e) => commitDraft({ ...draft, kind: "custom", end: e.target.value })}
              />
            </label>
          </div>
        )}

        {isTrendMonths && (
          <div className="insight-custom-dates">
            <label className="field">
              <span>Jumlah bulan (1–36)</span>
              <input
                type="number"
                min="1"
                max="36"
                step="1"
                value={draft.months}
                onChange={(e) => commitDraft({ ...draft, kind: "monthly_trend", months: e.target.value })}
              />
            </label>
          </div>
        )}

        {inputError && (
          <p className="insight-input-error" role="alert">
            {inputError}
          </p>
        )}
      </section>

      <div aria-busy={state.loading}>
        <InsightsLoadState loading={state.loading} error={state.error} retry={state.retry} />
        {state.report && (
          <InsightsReportView
            key={state.query}
            report={state.report}
            currency={selected}
            granularity={activeGranularity}
            monthSelection={monthSelection}
            slideSelection={{ index: slide, select: setSlide }}
            periodKind={activePeriod}
          />
        )}
      </div>
      </div>

      <ExcelStatusBar
        rowCount={
          state.report
            ? (state.report.byCategory?.length ?? 0) + (state.report.byAccount?.length ?? 0)
            : 0
        }
        totalIn={
          summaryItem?.incomeMinor !== undefined
            ? formatMinor(summaryItem.incomeMinor, summaryItem.currency, summaryItem.exponent ?? 0)
            : undefined
        }
        totalOut={
          summaryItem?.spendingMinor !== undefined
            ? formatMinor(summaryItem.spendingMinor, summaryItem.currency, summaryItem.exponent ?? 0)
            : undefined
        }
        customNetLabel="Net Operasional"
        customNetValue={
          summaryItem?.netMinor !== undefined
            ? formatMinor(summaryItem.netMinor, summaryItem.currency, summaryItem.exponent ?? 0)
            : undefined
        }
        isNetNegative={summaryItem?.netMinor ? BigInt(summaryItem.netMinor) < 0n : false}
        extraLabel={`Basis: ${analyticsMode === "consumption" ? "Mode Konsumsi Murni" : "Mode Arus Kas Riil"}`}
      />
    </>
  );
}
