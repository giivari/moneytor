"use client";

import { useId, useState } from "react";
import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import { compactAxisMoney, inclusiveEndDay, originLabel, percentageLabel, plotPercent } from "@/lib/analytics/presentation";
import { initialVisualInterval, spendingShares, visualIntervalAxis, visualIntervalState, visualTrend } from "@/lib/analytics/visuals";
import { formatMinor } from "@/lib/finance/format";
import { SectionHeading } from "./section-heading";
import type { InsightsMonthSelection } from "./use-insights-month";
import { useInsightsViewport } from "./use-insights-viewport";
import { FinancialAmount } from "./financial-amount";

const colors = ["#526f99", "#6c5b98", "#357c85", "#8c6943", "#747b86", "#44535f"];
function categoryShares(rows: DimensionRow[]) {
  const shares = spendingShares(rows);
  return { ...shares, rows: [...shares.rows].sort((a, b) => BigInt(a.spendingMinor) === BigInt(b.spendingMinor) ? a.name.localeCompare(b.name) : BigInt(a.spendingMinor) > BigInt(b.spendingMinor) ? -1 : 1) };
}
type VisualTrendProps = { report: AnalyticsReport; currency: string; exponent: number; selection?: InsightsMonthSelection; dashboard?: boolean };
export function useInsightsVisualTrend({ report, currency, exponent, selection, dashboard = false }: VisualTrendProps) {
  const viewport = useInsightsViewport();
  const mobile = dashboard ? false : viewport;
  const duration = Date.parse(report.period.endDayExclusive) - Date.parse(report.period.startDay);
  const data = visualTrend(report, currency, mobile ? duration <= 62 * 86400000 ? 6 : 4 : 12), rows = data.intervals;
  const [manual, setManual] = useState<{ key: string; month?: string } | null>(null);
  const selected = manual && manual.month === selection?.month && rows.some((row) => row.key === manual.key) ? manual.key : initialVisualInterval(rows, report, selection?.month);
  const active = rows.find((row) => row.key === selected), id = useId();
  const select = (key: string) => {
    const row = rows.find((item) => item.key === key); if (!row) return;
    const month = inclusiveEndDay(row.endDayExclusive).slice(0, 7);
    selection?.select(month); setManual({ key, month: selection ? month : undefined });
  };
  const maximum = rows.reduce((max, row) => [BigInt(row.incomeMinor), BigInt(row.spendingMinor)].reduce((a, b) => a > b ? a : b, max), 0n);
  const width = dashboard ? 600 : mobile ? 320 : Math.max(420, rows.length * 44 + 72), bottom = dashboard ? 98 : 180, step = (width - 72) / Math.max(1, rows.length);
  const money = (amount: string) => formatMinor(amount, currency, exponent);
  return { report, currency, exponent, mobile, data, rows, active, id, select, maximum, width, bottom, step, money };
}
type VisualTrendModel = ReturnType<typeof useInsightsVisualTrend>;
export function InsightsVisualTrend(props: VisualTrendProps) {
  return renderTrendSummary(useInsightsVisualTrend(props), !props.dashboard, props.dashboard);
}
export function InsightsTrendSummary({ model, inlineDetails = false }: { model: VisualTrendModel; inlineDetails?: boolean }) {
  return renderTrendSummary(model, inlineDetails);
}
function renderTrendSummary(model: VisualTrendModel, inlineDetails: boolean, dashboard = false) {
  const { report, currency, exponent, mobile, data, rows, active, id, select, maximum, width, bottom, step, money } = model;
  if (!active) return <p className="insight-empty">Belum ada interval untuk mata uang ini.</p>;
  return <>
    <SectionHeading title="Pemasukan & belanja" helper={data.weekly ? "Per minggu · Senin–Minggu, dipotong batas periode." : "Per bulan · Transaksi efektif dalam periode terpilih."} />
    <div className="insight-legend"><span><i className="insight-income-dot" />Pemasukan</span><span><i className="insight-spending-dot" />Belanja</span></div>
    {data.grouped && <p className="insight-note">{mobile && !data.weekly ? "Maksimal 4 interval; TW = triwulan. " : "Interval berurutan diringkas. "}Tanggal tepat ada pada pilihan interval; semua bulan tersedia di rincian.</p>}
    {maximum === 0n && <p className="insight-empty">Pemasukan dan belanja nol. Transfer tetap dilaporkan terpisah.</p>}
    <svg className="insight-fit-chart" viewBox={`0 0 ${width} ${dashboard ? 140 : 224}`} role="group" aria-labelledby={`${id}-title`}>
      <title id={`${id}-title`}>{`Pemasukan dan belanja ${data.weekly ? "mingguan" : "bulanan"}; skala dari nol, angka tepat melalui pilihan interval.`}</title>
      {(maximum === 0n ? [0] : [0, 1, 2]).map((tick) => <g key={tick}><line x1="64" x2={width - 8} y1={bottom - tick * (dashboard ? 36 : 74)} y2={bottom - tick * (dashboard ? 36 : 74)} className="insight-gridline" /><text x="58" y={bottom - tick * (dashboard ? 36 : 74) + 4} textAnchor="end" className="insight-axis">{compactAxisMoney(maximum * BigInt(tick) / 2n, currency, exponent)}</text></g>)}
      {rows.map((row, index) => {
        const x = 64 + step * (index + .5), size = Math.min(18, step * .3);
        const income = plotPercent(row.incomeMinor, maximum) * (dashboard ? .72 : 1.48), spending = plotPercent(row.spendingMinor, maximum) * (dashboard ? .72 : 1.48);
        const label = `${row.label}, ${visualIntervalState(row, report)}: pemasukan ${money(row.incomeMinor)}, belanja ${money(row.spendingMinor)}, net ${money(row.netMinor)}`;
        return <g className="insight-month" key={row.key} role="button" tabIndex={0} aria-label={label} aria-pressed={row.key === active.key} onClick={() => select(row.key)} onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(row.key); }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopPropagation();
            const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
            select(rows[next].key);
            event.currentTarget.parentElement?.querySelectorAll<SVGElement>('[role="button"]')[next]?.focus({ preventScroll: true });
          }
        }}>
          <title>{label}</title><rect className="insight-chart-hit" x={x - step * .45} y="24" width={step * .9} height={bottom - 22} rx="4" />
          <rect className="insight-income-bar" x={x - size - 2} y={bottom - income} width={size} height={income} rx="2" /><rect className="insight-spending-bar" x={x + 2} y={bottom - spending} width={size} height={spending} rx="2" />
          <text className="insight-axis" textAnchor="middle" x={x} y={bottom + 22}>{mobile || dashboard ? visualIntervalAxis(row, data.weekly).label : data.weekly ? `${Number(row.startDay.slice(8))}/${Number(row.startDay.slice(5, 7))}` : row.startDay.slice(5, 7) + (data.grouped ? `–${inclusiveEndDay(row.endDayExclusive).slice(5, 7)}` : "")}</text>
          {mobile && !data.weekly && <text className="insight-axis insight-axis-year" textAnchor="middle" x={x} y="220">{visualIntervalAxis(row, false).year}</text>}
        </g>;
      })}
    </svg>
    {dashboard ? <div className="home-chart-selection" aria-live="polite"><small>{active.label} · {visualIntervalState(active, report)}</small><dl>
      <div><dt>Pemasukan</dt><dd><FinancialAmount value={money(active.incomeMinor)} as="span" className="insight-positive" /></dd></div>
      <div><dt>Belanja</dt><dd><FinancialAmount value={money(active.spendingMinor)} as="span" className="insight-negative" /></dd></div>
      <div><dt>Net operasional</dt><dd><FinancialAmount value={money(active.netMinor)} as="span" className={BigInt(active.netMinor) < 0n ? "insight-negative" : "insight-positive"} /></dd></div>
    </dl></div> : <><label className="field insight-interval-picker"><span>Rincian {data.weekly ? "minggu" : "interval"}</span><select value={active.key} onChange={(event) => select(event.target.value)}>{rows.map((row) => <option key={row.key} value={row.key}>{row.label} · {visualIntervalState(row, report)}</option>)}</select></label>
    <dl className="insight-interval-values" aria-live="polite"><div><dt>Pemasukan</dt><dd><FinancialAmount value={money(active.incomeMinor)} as="span" /></dd></div><div><dt>Belanja</dt><dd><FinancialAmount value={money(active.spendingMinor)} as="span" /></dd></div><div><dt>Net operasional</dt><dd className={BigInt(active.netMinor) < 0n ? "insight-negative" : "insight-positive"}><FinancialAmount value={money(active.netMinor)} as="span" /></dd></div></dl></>}
    {inlineDetails && <details className="insight-inline-detail"><summary>Angka semua interval</summary><InsightsIntervalDetails model={model} /></details>}
  </>;
}

export function InsightsIntervalDetails({ model }: { model: VisualTrendModel }) {
  return <dl className="insight-interval-table">{model.data.fullIntervals.map((row) => <div key={row.key}><dt>{row.label} · {visualIntervalState(row, model.report)}</dt><dd>Pemasukan {model.money(row.incomeMinor)} · Belanja {model.money(row.spendingMinor)} · Net {model.money(row.netMinor)}</dd></div>)}</dl>;
}

export function InsightsComposition({ rows, inlineDetails = true }: { rows: DimensionRow[]; inlineDetails?: boolean }) {
  const shares = categoryShares(rows), id = useId();
  const sorted = shares.rows;
  const total = BigInt(shares.totalMinor), first = rows[0];
  return <>
    <SectionHeading title="Komposisi belanja" helper="Expense + biaya terlampir. Biaya Transfer tidak termasuk." />
    {!first || total === 0n ? <p className="insight-empty">Belum ada belanja Expense untuk dikelompokkan menurut kategori.</p> : <>
      <div className="insight-composition"><svg viewBox="0 0 160 160" role="img" aria-labelledby={`${id}-title`}>
        <title id={`${id}-title`}>{`Komposisi kategori; total ${formatMinor(total, first.currency, first.exponent)}. Rincian nominal dan persentase tersedia di bawah.`}</title>
        <circle cx="80" cy="80" r="60" fill="none" stroke="#e8edf1" strokeWidth="24" />
        {sorted.filter((row) => BigInt(row.spendingMinor) > 0n).map((row, index) => {
          const offset = sorted.slice(0, index).reduce((amount, item) => amount + BigInt(item.spendingMinor), 0n);
          return <circle key={row.key} cx="80" cy="80" r="60" pathLength="100" fill="none" stroke={colors[index % colors.length]} strokeWidth="24" strokeDasharray={`${row.percent} ${100 - row.percent}`} strokeDashoffset={-plotPercent(offset, total)} transform="rotate(-90 80 80)"><title>{`${row.name}: ${formatMinor(row.spendingMinor, row.currency, row.exponent)} (${percentageLabel(row.shareBps)})`}</title></circle>;
        })}
        <text x="80" y="77" textAnchor="middle" className="insight-donut-label">{sorted.filter((row) => BigInt(row.spendingMinor) > 0n).length}</text><text x="80" y="97" textAnchor="middle" className="insight-axis">kategori</text>
      </svg><div><span className="insight-note">Total cakupan kategori</span><FinancialAmount value={formatMinor(total, first.currency, first.exponent)} className="insight-money" /></div></div>
      <ol className="insight-visual-ranking">{sorted.slice(0, 3).map((row, index) => <li key={row.key}><span><i style={{ background: colors[index % colors.length] }} />{row.name}{row.archived ? " · Diarsipkan" : ""}</span><strong><FinancialAmount as="span" value={formatMinor(row.spendingMinor, row.currency, row.exponent)} /><small>{percentageLabel(row.shareBps)}</small></strong></li>)}</ol>
      {inlineDetails && <details className="insight-inline-detail"><summary>Semua kategori ({rows.length})</summary><InsightsCategoryDetails rows={rows} /></details>}
    </>}
  </>;
}

export function InsightsCategoryDetails({ rows }: { rows: DimensionRow[] }) {
  const shares = categoryShares(rows), sorted = shares.rows;
  if (BigInt(shares.totalMinor) === 0n) return <p className="insight-empty">Belum ada belanja Expense untuk dikelompokkan menurut kategori.</p>;
  return <><ol className="insight-visual-ranking">{sorted.map((row) => <li key={row.key}><span>{row.name}{row.archived ? " · Diarsipkan" : ""}</span><strong><FinancialAmount as="span" value={formatMinor(row.spendingMinor, row.currency, row.exponent)} /><small>{percentageLabel(row.shareBps)}</small></strong></li>)}</ol><p className="insight-note">Persentase memakai total cakupan kategori, bukan total belanja termasuk Transfer. Pembulatan dapat membuat jumlah persentase berbeda sedikit dari 100%.</p></>;
}

export function InsightsOrigins({ rows }: { rows: DimensionRow[] }) {
  const shares = spendingShares(rows);
  return <>
    <SectionHeading title="Asal belanja" helper="Porsi belanja efektif · Pemasukan tidak masuk denominator." />
    {BigInt(shares.totalMinor) === 0n ? <p className="insight-empty">Belum ada belanja untuk dibandingkan menurut asal transaksi.</p> : <>
      <div className="insight-origin-bar" role="img" aria-label={`Asal belanja: ${shares.rows.map((row) => `${originLabel(row.key)} ${percentageLabel(row.shareBps)}`).join(", ")}`}>
        {shares.rows.map((row, index) => <span key={row.key} style={{ flexGrow: row.percent, background: colors[index % colors.length] }} title={`${originLabel(row.key)}: ${formatMinor(row.spendingMinor, row.currency, row.exponent)}`} />)}
      </div>
      <ul className="insight-visual-ranking">{shares.rows.map((row, index) => <li key={row.key}><span><i style={{ background: colors[index % colors.length] }} />{originLabel(row.key)}</span><strong><FinancialAmount as="span" value={formatMinor(row.spendingMinor, row.currency, row.exponent)} /><small>{percentageLabel(row.shareBps)}</small></strong></li>)}</ul>
    </>}
    <p className="insight-note">Setiap hasil P3 dihitung sekali. Proposal, tinjauan dan transaksi yang dilewati bukan pergerakan uang.</p>
  </>;
}

export function InsightsCostBars({ rows, currency, exponent }: { rows: { key: string; label: string; amount: string }[]; currency: string; exponent: number }) {
  const maximum = rows.reduce((max, row) => BigInt(row.amount) > max ? BigInt(row.amount) : max, 0n);
  if (maximum === 0n) return null;
  return <ul className="insight-cost-bars">{rows.map((row) => <li key={row.key}><div><span>{row.label}</span><FinancialAmount value={formatMinor(row.amount, currency, exponent)} /></div><div className="insight-category-track" aria-hidden="true"><span style={{ width: `${plotPercent(row.amount, maximum)}%` }} /></div></li>)}</ul>;
}
