"use client";

import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import { compactAxisMoney, insightsMonthScroll, insightsTrendLayout, monthLabel, monthState, plotPercent } from "@/lib/analytics/presentation";
import { formatMinor } from "@/lib/finance/format";
import { FinancialAmount } from "./financial-amount";
import { useInsightsMonth, type InsightsMonthSelection } from "./use-insights-month";

export function InsightsTrend({ rows, report, selection, tableDisclosure = true }: { rows: DimensionRow[]; report: AnalyticsReport; selection?: InsightsMonthSelection; tableDisclosure?: boolean }) {
  const id = useId();
  const local = useInsightsMonth(rows, report), choice = selection ?? local;
  const scrollRef = useRef<HTMLDivElement>(null), selectedRef = useRef<SVGGElement>(null);
  const active = rows.find((row) => row.key === choice.month);
  const activeMonth = active?.key;
  const { compact, width, height, bottom, top, step } = insightsTrendLayout(rows.length);
  const scope = `${report.period.startDay}:${report.period.endDayExclusive}:${rows[0]?.currency ?? ""}`;
  useLayoutEffect(() => {
    const viewport = scrollRef.current, month = selectedRef.current;
    if (!viewport || !month || !activeMonth) return;
    const reveal = () => {
      const bounds = viewport.getBoundingClientRect(), target = month.getBoundingClientRect();
      const left = target.left - bounds.left + viewport.scrollLeft, right = target.right - bounds.left + viewport.scrollLeft;
      const next = insightsMonthScroll(viewport.scrollLeft, viewport.clientWidth, left, right, viewport.scrollWidth - viewport.clientWidth);
      if (next !== viewport.scrollLeft) viewport.scrollLeft = next;
    };
    reveal();
    let previousWidth = viewport.clientWidth;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth === previousWidth) return;
      previousWidth = viewport.clientWidth; reveal();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [activeMonth, scope, width]);
  if (!rows.length) return <p className="insight-note">Belum ada seri bulanan untuk mata uang ini.</p>;
  if (!active) return null;
  const currency = rows[0].currency, exponent = rows[0].exponent;
  const maximum = rows.reduce((max, row) => [BigInt(row.incomeMinor), BigInt(row.spendingMinor)].reduce((a, b) => a > b ? a : b, max), 0n);
  const money = (value: string) => formatMinor(value, currency, exponent);
  return <>
    <div className="insight-legend"><span><i className="insight-income-dot" />Pemasukan</span><span><i className="insight-spending-dot" />Belanja</span></div>
    <p className="insight-note">Nilai {currency} per bulan, hanya transaksi dalam rentang terpilih. Pilih batang atau bulan untuk melihat angka tepat. Geser grafik jika diperlukan.</p>
    {maximum === 0n && <p className="insight-note">Pemasukan dan belanja bernilai nol dalam rentang ini. Aktivitas Transfer ditampilkan terpisah.</p>}
    <div ref={scrollRef} className={`insight-chart-scroll${compact ? " insight-chart-scroll--compact" : ""}`} tabIndex={0} role="region" aria-label="Grafik bulanan yang dapat digeser">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-labelledby={`${id}-title ${id}-desc`}>
        <title id={`${id}-title`}>Pemasukan dan belanja bulanan</title><desc id={`${id}-desc`}>Skala dimulai dari nol. Belanja termasuk biaya P3. Net bukan pertumbuhan total aset. Tabel angka tersedia di bawah grafik.</desc>
        {(maximum === 0n ? [0] : [0, 1, 2]).map((tick) => {
          const amount = maximum * BigInt(tick) / 2n, y = bottom - (bottom - top) * tick / 2;
          return <g key={tick}><line x1="106" x2={width - 10} y1={y} y2={y} className="insight-gridline" />
            <text x="98" y={y + 4} textAnchor="end" className="insight-axis">{compactAxisMoney(amount, currency, exponent)}</text></g>;
        })}
        {rows.map((row, index) => {
          const x = 112 + step * index + step / 2, badge = monthState(row.key, report);
          const label = `${monthLabel(row.key)}${badge ? `, ${badge}` : ""}: pemasukan ${money(row.incomeMinor)}, belanja ${money(row.spendingMinor)}, net ${money(row.netMinor)}`;
          const incomeHeight = plotPercent(row.incomeMinor, maximum) * (bottom - top) / 100;
          const spendingHeight = plotPercent(row.spendingMinor, maximum) * (bottom - top) / 100;
          return <g key={row.key} ref={active.key === row.key ? selectedRef : undefined} role="button" tabIndex={0} aria-label={label} aria-pressed={active.key === row.key}
            onClick={() => choice.select(row.key)} onFocus={() => choice.select(row.key)} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choice.select(row.key); }
            }} className="insight-month">
            <title>{label}</title><rect x={x - 30} y={top} width="60" height={bottom - top} rx="5" className="insight-chart-hit" />
            <rect x={x - 21} y={bottom - incomeHeight} width="18" height={incomeHeight} rx="3" className="insight-income-bar" />
            <rect x={x + 3} y={bottom - spendingHeight} width="18" height={spendingHeight} rx="3" className="insight-spending-bar" />
            <text x={x} y={bottom + 22} textAnchor="middle" className="insight-axis">{monthLabel(row.key)}</text>
            <text x={x} y={bottom + 40} textAnchor="middle" className="insight-month-status" data-status={badge}>{badge}</text>
          </g>;
        })}
      </svg>
    </div>
    <label className="field insight-month-picker"><span>Rincian bulan</span><select value={active.key} onChange={(event) => choice.select(event.target.value)}>
      {rows.map((row) => <option key={row.key} value={row.key}>{monthLabel(row.key)}{monthState(row.key, report) ? ` · ${monthState(row.key, report)}` : ""}</option>)}
    </select></label>
    <div aria-live="polite"><p className="insight-note insight-selected-month"><strong>{monthLabel(active.key)}</strong> · {monthState(active.key, report)}</p>
      <dl className="insight-small-values"><div><dt>Pemasukan</dt><dd><FinancialAmount value={money(active.incomeMinor)} /></dd></div><div><dt>Belanja</dt><dd><FinancialAmount value={money(active.spendingMinor)} /></dd></div><div><dt>Net operasional</dt><dd><FinancialAmount value={money(active.netMinor)} /></dd></div></dl></div>
    <MonthlyTable disclosure={tableDisclosure}><div className="insight-chart-scroll" tabIndex={0} role="region" aria-label="Tabel angka bulanan yang dapat digeser"><table>
      <caption>Pemasukan, belanja, dan net operasional ({currency})</caption><thead><tr><th scope="col">Bulan</th><th scope="col">Pemasukan</th><th scope="col">Belanja</th><th scope="col">Net</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{monthLabel(row.key)} {monthState(row.key, report)}</th><td>{money(row.incomeMinor)}</td><td>{money(row.spendingMinor)}</td><td>{money(row.netMinor)}</td></tr>)}</tbody>
    </table></div></MonthlyTable>
  </>;
}

function MonthlyTable({ disclosure, children }: { disclosure: boolean; children: ReactNode }) {
  return disclosure ? <details className="insight-table-disclosure"><summary>Tabel angka bulanan</summary>{children}</details>
    : <div className="insight-table-disclosure">{children}</div>;
}
