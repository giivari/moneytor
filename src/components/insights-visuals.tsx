"use client";

import { useId, useState } from "react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport, ChargeReport, DimensionRow } from "@/lib/analytics/types";
import {
  compactAxisMoney,
  feePartition,
  inclusiveEndDay,
  insightsCurrency,
  percentageLabel,
  plotPercent,
  signedMoney,
} from "@/lib/analytics/presentation";
import {
  compositionShares,
  initialVisualInterval,
  visualIntervalAxis,
  visualIntervalState,
  visualTrend,
  type CompositionEntry,
} from "@/lib/analytics/visuals";
import { formatMinor } from "@/lib/finance/format";
import { SectionHeading } from "./section-heading";
import type { InsightsMonthSelection } from "./use-insights-month";
import { useInsightsViewport } from "./use-insights-viewport";
import { FinancialAmount } from "./financial-amount";

const colors = ["#526f99", "#6c5b98", "#357c85", "#8c6943", "#747b86", "#44535f"];

type VisualTrendProps = {
  report: AnalyticsReport;
  currency: string;
  exponent: number;
  selection?: InsightsMonthSelection;
  dashboard?: boolean;
  granularity?: AnalyticsGranularity;
};

export function useInsightsVisualTrend({
  report,
  currency,
  exponent,
  selection,
  dashboard = false,
  granularity = "auto",
}: VisualTrendProps) {
  const viewport = useInsightsViewport();
  const mobile = dashboard ? false : viewport;
  const duration = Date.parse(report.period.endDayExclusive) - Date.parse(report.period.startDay);
  const maxBins = mobile ? (duration <= 62 * 86400000 ? 6 : 4) : granularity === "day" ? 14 : 12;
  const data = visualTrend(report, currency, maxBins, granularity);
  const rows = data.intervals;
  const [manual, setManual] = useState<{ key: string; month?: string } | null>(null);
  const selected =
    manual && manual.month === selection?.month && rows.some((row) => row.key === manual.key)
      ? manual.key
      : initialVisualInterval(rows, report, selection?.month);
  const active = rows.find((row) => row.key === selected);
  const id = useId();
  const select = (key: string) => {
    const row = rows.find((item) => item.key === key);
    if (!row) return;
    const month = inclusiveEndDay(row.endDayExclusive).slice(0, 7);
    selection?.select(month);
    setManual({ key, month: selection ? month : undefined });
  };
  const maximum = rows.reduce(
    (max, row) => [BigInt(row.incomeMinor), BigInt(row.spendingMinor)].reduce((a, b) => (a > b ? a : b), max),
    0n,
  );
  const width = dashboard ? 600 : mobile ? 340 : Math.max(420, rows.length * 44 + 72);
  const bottom = dashboard ? 98 : 180;
  const axisLeft = 68;
  const step = (width - axisLeft - 12) / Math.max(1, rows.length);
  const money = (amount: string) => formatMinor(amount, currency, exponent);
  return { report, currency, exponent, mobile, data, rows, active, id, select, maximum, width, bottom, axisLeft, step, money };
}

export type VisualTrendModel = ReturnType<typeof useInsightsVisualTrend>;

export function InsightsVisualTrend(props: VisualTrendProps) {
  return renderTrendSummary(useInsightsVisualTrend(props), !props.dashboard, props.dashboard);
}

export function InsightsTrendSummary({ model, inlineDetails = false }: { model: VisualTrendModel; inlineDetails?: boolean }) {
  return renderTrendSummary(model, inlineDetails);
}

function renderTrendSummary(model: VisualTrendModel, inlineDetails: boolean, dashboard = false) {
  const { report, currency, exponent, mobile, data, rows, active, id, select, maximum, width, bottom, step, money } = model;
  if (!active) return <p className="insight-empty">Belum ada interval untuk mata uang ini.</p>;
  const helperCopy =
    data.granularity === "day"
      ? "Per hari · Tanggal kalender Asia/Jakarta dalam periode terpilih."
      : data.weekly
        ? "Per minggu · Senin–Minggu, dipotong batas periode."
        : data.granularity === "year"
          ? "Per tahun · Akumulasi tahun kalender dalam periode terpilih."
          : "Per bulan · Transaksi tercatat dalam periode terpilih.";
  const granWord =
    data.granularity === "day" ? "harian" : data.weekly ? "mingguan" : data.granularity === "year" ? "tahunan" : "bulanan";
  const detailWord =
    data.weekly ? "minggu" : data.granularity === "day" ? "hari" : data.granularity === "year" ? "tahun" : "bulan";

  return (
    <>
      <SectionHeading title="Pemasukan & belanja" helper={helperCopy} />
      <div className="insight-legend">
        <span>
          <i className="insight-income-dot" />
          Pemasukan
        </span>
        <span>
          <i className="insight-spending-dot" />
          Belanja
        </span>
      </div>
      {data.grouped && (
        <p className="insight-note">
          {mobile && data.granularity === "month" ? "Maksimal 4 interval; TW = triwulan. " : "Interval berurutan diringkas. "}
          Tanggal tepat ada pada pilihan interval; rincian lengkap tersedia pada tabel interval.
        </p>
      )}
      {maximum === 0n && <p className="insight-empty">Pemasukan dan belanja nol. Transfer tetap dilaporkan terpisah.</p>}
      <svg
        className="insight-fit-chart"
        viewBox={`0 0 ${width} ${dashboard ? 140 : 224}`}
        role="group"
        aria-labelledby={`${id}-title`}
      >
        <title id={`${id}-title`}>{`Pemasukan dan belanja ${granWord}; skala dari nol, angka tepat melalui pilihan interval.`}</title>
        {(maximum === 0n ? [0] : [0, 1, 2]).map((tick) => (
          <g key={tick}>
            <line
              x1={model.axisLeft ?? 68}
              x2={width - 8}
              y1={bottom - tick * (dashboard ? 36 : 74)}
              y2={bottom - tick * (dashboard ? 36 : 74)}
              className="insight-gridline"
            />
            <text x={(model.axisLeft ?? 68) - 6} y={bottom - tick * (dashboard ? 36 : 74) + 4} textAnchor="end" className="insight-axis">
              {compactAxisMoney((maximum * BigInt(tick)) / 2n, currency, exponent)}
            </text>
          </g>
        ))}
        {rows.map((row, index) => {
          const x = (model.axisLeft ?? 68) + step * (index + 0.5);
          const size = Math.min(18, step * 0.3);
          const income = plotPercent(row.incomeMinor, maximum) * (dashboard ? 0.72 : 1.48);
          const spending = plotPercent(row.spendingMinor, maximum) * (dashboard ? 0.72 : 1.48);
          const label = `${row.label}, ${visualIntervalState(row, report)}: pemasukan ${money(row.incomeMinor)}, belanja ${money(row.spendingMinor)}, net ${money(row.netMinor)}`;
          const isCompact = mobile || dashboard;
          const axisLabel = (() => {
            if (data.granularity === "year") {
              return visualIntervalAxis(row, false, "year").label;
            }
            if (isCompact) {
              if (data.granularity === "month") {
                return visualIntervalAxis(row, false, "month").label;
              }
              const day = Number(row.startDay.slice(8));
              const month = Number(row.startDay.slice(5, 7));
              if (step < 34 && index % Math.ceil(34 / step) !== 0 && index !== rows.length - 1) {
                return "";
              }
              return `${day}/${month}`;
            }
            if (data.weekly || data.granularity === "day") {
              return `${Number(row.startDay.slice(8))}/${Number(row.startDay.slice(5, 7))}`;
            }
            return (
              row.startDay.slice(5, 7) +
              (data.grouped ? `–${inclusiveEndDay(row.endDayExclusive).slice(5, 7)}` : "")
            );
          })();
          return (
            <g
              className="insight-month"
              key={row.key}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-pressed={row.key === active.key}
              onClick={() => select(row.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  select(row.key);
                }
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  const next = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
                  select(rows[next].key);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<SVGElement>('[role="button"]')
                    [next]?.focus({ preventScroll: true });
                }
              }}
            >
              <title>{label}</title>
              <rect className="insight-chart-hit" x={x - step * 0.45} y="24" width={step * 0.9} height={bottom - 22} rx="4" />
              <rect className="insight-income-bar" x={x - size - 2} y={bottom - income} width={size} height={income} rx="2" />
              <rect className="insight-spending-bar" x={x + 2} y={bottom - spending} width={size} height={spending} rx="2" />
              <text className="insight-axis" textAnchor="middle" x={x} y={bottom + 22}>
                {axisLabel}
              </text>
              {mobile && data.granularity === "month" && (
                <text className="insight-axis insight-axis-year" textAnchor="middle" x={x} y="220">
                  {visualIntervalAxis(row, false).year}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {dashboard ? (
        <div className="home-chart-selection" aria-live="polite">
          <small>
            {active.label} · {visualIntervalState(active, report)}
          </small>
          <dl>
            <div>
              <dt>Pemasukan</dt>
              <dd>
                <FinancialAmount value={money(active.incomeMinor)} as="span" className="insight-positive" />
              </dd>
            </div>
            <div>
              <dt>Belanja</dt>
              <dd>
                <FinancialAmount value={money(active.spendingMinor)} as="span" className="insight-negative" />
              </dd>
            </div>
            <div>
              <dt>Net operasional</dt>
              <dd>
                <FinancialAmount
                  value={money(active.netMinor)}
                  as="span"
                  className={BigInt(active.netMinor) < 0n ? "insight-negative" : "insight-positive"}
                />
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <>
          <label className="field insight-interval-picker">
            <span>Rincian {detailWord}</span>
            <select value={active.key} onChange={(event) => select(event.target.value)}>
              {rows.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.label} · {visualIntervalState(row, report)}
                </option>
              ))}
            </select>
          </label>
          <dl className="insight-interval-values" aria-live="polite">
            <div>
              <dt>Pemasukan</dt>
              <dd className={BigInt(active.incomeMinor) === 0n ? "insight-zero-muted" : "insight-positive"}>
                <FinancialAmount value={money(active.incomeMinor)} as="span" />
              </dd>
            </div>
            <div>
              <dt>Belanja</dt>
              <dd className={BigInt(active.spendingMinor) === 0n ? "insight-zero-muted" : "insight-negative"}>
                <FinancialAmount value={money(active.spendingMinor)} as="span" />
              </dd>
            </div>
            <div>
              <dt>Net operasional</dt>
              <dd className={BigInt(active.netMinor) < 0n ? "insight-negative" : BigInt(active.netMinor) > 0n ? "insight-positive" : "insight-zero-muted"}>
                <FinancialAmount value={money(active.netMinor)} as="span" />
              </dd>
            </div>
          </dl>
        </>
      )}
      {inlineDetails && (
        <details className="insight-inline-detail">
          <summary>Tabel semua interval</summary>
          <InsightsIntervalDetails model={model} />
        </details>
      )}
    </>
  );
}

export function InsightsIntervalDetails({ model }: { model: VisualTrendModel }) {
  const all = model.data.fullIntervals;
  const activeRows = all.filter(
    (row) =>
      BigInt(row.incomeMinor) !== 0n ||
      BigInt(row.spendingMinor) !== 0n ||
      BigInt(row.activityCount) > 0n,
  );
  const hiddenCount = all.length - activeRows.length;
  if (activeRows.length === 0) {
    return <p className="insight-empty">Belum ada transaksi tercatat pada interval di periode ini.</p>;
  }
  return (
    <div className="insight-interval-list-wrap">
      <div className="u-table-wrap insight-chart-scroll" tabIndex={0} role="region" aria-label="Tabel rincian per interval">
        <table className="u-table insight-interval-table">
          <caption>Pemasukan, belanja, dan net operasional ({model.currency})</caption>
          <thead>
            <tr>
              <th scope="col">Interval</th>
              <th scope="col">Pemasukan</th>
              <th scope="col">Belanja</th>
              <th scope="col">Net</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row) => {
              const inc = BigInt(row.incomeMinor);
              const exp = BigInt(row.spendingMinor);
              const net = BigInt(row.netMinor);
              const state = visualIntervalState(row, model.report);
              return (
                <tr key={row.key}>
                  <th scope="row">
                    <strong>{row.label}</strong>
                    <em className="u-pill" data-status={state}>
                      {state}
                    </em>
                  </th>
                  <td className={inc === 0n ? "insight-zero-muted" : "insight-positive"}>
                    {model.money(row.incomeMinor)}
                  </td>
                  <td className={exp === 0n ? "insight-zero-muted" : "insight-negative"}>
                    {model.money(row.spendingMinor)}
                  </td>
                  <td className={net < 0n ? "insight-negative" : net > 0n ? "insight-positive" : "insight-zero-muted"}>
                    {signedMoney(row.netMinor, model.currency, model.exponent)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <p className="insight-note">{hiddenCount} interval tanpa transaksi disembunyikan agar tetap ringkas.</p>
      )}
    </div>
  );
}

function renderCompositionRow(
  row: Pick<
    CompositionEntry,
    "key" | "name" | "archived" | "badge" | "subtitle" | "spendingMinor" | "currency" | "exponent" | "shareBps"
  >,
  color?: string,
) {
  return (
    <li key={row.key} className="insight-comp-row--compact">
      <span className="insight-comp-name">
        {color && <i style={{ background: color }} />}
        <span className="insight-comp-label">
          {row.name}
          {row.archived ? " · Diarsipkan" : ""}
        </span>
      </span>
      <strong>
        <FinancialAmount as="span" value={formatMinor(row.spendingMinor, row.currency, row.exponent)} />
        <small>{percentageLabel(row.shareBps)}</small>
      </strong>
    </li>
  );
}

export function InsightsComposition({
  rows,
  charges,
  inlineDetails = true,
  dashboard = false,
}: {
  rows: DimensionRow[];
  charges?: ChargeReport[];
  inlineDetails?: boolean;
  dashboard?: boolean;
}) {
  const shares = compositionShares(rows, charges);
  const id = useId();
  const sorted = shares.rows;
  const active = sorted.filter((row) => BigInt(row.spendingMinor) > 0n);
  const colorMap = new Map(active.map((row, index) => [row.key, colors[index % colors.length]]));
  const maxLines = dashboard ? 4 : 5;
  const total = BigInt(shares.totalMinor);
  const first = sorted[0];

  let displayRows: {
    row: Pick<
      CompositionEntry,
      "key" | "name" | "archived" | "badge" | "subtitle" | "spendingMinor" | "currency" | "exponent" | "shareBps"
    >;
    color: string;
  }[] = [];

  if (first && active.length <= maxLines) {
    displayRows = active.map((row) => ({ row, color: colorMap.get(row.key) ?? colors[0] }));
  } else if (first && active.length > maxLines) {
    const head = active.slice(0, maxLines - 1);
    const tail = active.slice(maxLines - 1);
    const tailMinor = tail.reduce((sum, item) => sum + BigInt(item.spendingMinor), 0n);
    const tailBps = total > 0n ? ((tailMinor * 10000n) / total).toString() : null;
    displayRows = [
      ...head.map((row) => ({ row, color: colorMap.get(row.key) ?? colors[0] })),
      {
        row: {
          key: "__others__",
          name: `Lainnya (${tail.length} pos)`,
          archived: false,
          badge: null,
          subtitle: null,
          spendingMinor: tailMinor.toString(),
          currency: first.currency,
          exponent: first.exponent,
          shareBps: tailBps,
        },
        color: "#94a3b1",
      },
    ];
  }

  const hasHiddenRows = sorted.length > active.length || active.length > maxLines || (charges?.length ?? 0) > 0;

  return (
    <>
      <SectionHeading title="Komposisi belanja" helper="Distribusi pengeluaran & biaya pada periode terpilih." />
      {!first || total === 0n ? (
        <p className="insight-empty">Belum ada belanja Expense untuk dikelompokkan menurut kategori.</p>
      ) : (
        <>
          <div className="insight-composition">
            <svg viewBox="0 0 160 160" role="img" aria-labelledby={`${id}-title`}>
              <title id={`${id}-title`}>{`Komposisi belanja & biaya; total ${formatMinor(total, first.currency, first.exponent)}. Rincian nominal dan persentase tersedia di bawah.`}</title>
              <circle cx="80" cy="80" r="60" fill="none" stroke="#e8edf1" strokeWidth="24" />
              {active.map((row, index) => {
                const offset = active.slice(0, index).reduce((amount, item) => amount + BigInt(item.spendingMinor), 0n);
                const detail = row.subtitle ? ` — ${row.subtitle}` : "";
                return (
                  <circle
                    key={row.key}
                    cx="80"
                    cy="80"
                    r="60"
                    pathLength="100"
                    fill="none"
                    stroke={colors[index % colors.length]}
                    strokeWidth="24"
                    strokeDasharray={`${row.percent} ${100 - row.percent}`}
                    strokeDashoffset={-plotPercent(offset, total)}
                    transform="rotate(-90 80 80)"
                  >
                    <title>{`${row.name}${detail}: ${formatMinor(row.spendingMinor, row.currency, row.exponent)} (${percentageLabel(row.shareBps)})`}</title>
                  </circle>
                );
              })}
              <text x="80" y="78" textAnchor="middle" className="insight-donut-label">
                {active.length}
              </text>
              <text x="80" y="96" textAnchor="middle" className="insight-axis">
                pos
              </text>
            </svg>
            <div>
              <span className="insight-note">Total pengeluaran</span>
              <FinancialAmount value={formatMinor(total, first.currency, first.exponent)} level="summary" className="insight-money" />
            </div>
          </div>
          <ol className="insight-visual-ranking">{displayRows.map(({ row, color }) => renderCompositionRow(row, color))}</ol>
          {inlineDetails && hasHiddenRows && (
            <details className="insight-inline-detail">
              <summary>Semua kategori &amp; biaya ({sorted.length})</summary>
              <InsightsCategoryDetails rows={rows} charges={charges} />
            </details>
          )}
        </>
      )}
    </>
  );
}

export function InsightsCategoryDetails({ rows, charges = [] }: { rows: DimensionRow[]; charges?: ChargeReport[] }) {
  const shares = compositionShares(rows, charges);
  const sorted = shares.rows;
  const first = sorted[0];
  if (!first || BigInt(shares.totalMinor) === 0n) {
    return <p className="insight-empty">Belum ada belanja Expense untuk dikelompokkan menurut kategori.</p>;
  }
  const fees = feePartition(charges);
  const taxesMinor = charges
    .filter((c) => c.bucket === "tax")
    .reduce((sum, c) => sum + BigInt(c.amountMinor), 0n);
  const otherChargesMinor = charges
    .filter((c) => c.bucket === "other")
    .reduce((sum, c) => sum + BigInt(c.amountMinor), 0n);

  return (
    <>
      <div className={charges.length > 0 ? "u-subgrid" : undefined}>
        <div className="u-table-section">
          {charges.length > 0 && <h4 className="u-table-title">Rincian pos pengeluaran</h4>}
          <div className="u-table-wrap">
            <table className="u-table" aria-label="Rincian kategori dan biaya">
              <thead>
                <tr>
                  <th scope="col">Pos pengeluaran</th>
                  <th scope="col">Nominal</th>
                  <th scope="col">Porsi</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const isZero = BigInt(row.spendingMinor) === 0n;
                  return (
                    <tr key={row.key}>
                      <th scope="row">
                        <strong>{row.name}</strong>
                        {row.archived && <em className="u-pill">Diarsipkan</em>}
                        {row.badge && (
                          <em className="u-pill" data-tone={row.badge === "Pajak" ? "warning" : undefined}>
                            {row.badge}
                          </em>
                        )}
                        {row.subtitle && <small className="u-cell-sub insight-entry-sub">{row.subtitle}</small>}
                      </th>
                      <td className={isZero ? "insight-zero-muted" : ""}>
                        <FinancialAmount as="span" value={formatMinor(row.spendingMinor, row.currency, row.exponent)} />
                      </td>
                      <td className="insight-zero-muted">{percentageLabel(row.shareBps)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {charges.length > 0 && (
          <div className="u-table-section">
            <h4 className="u-table-title">Rekapitulasi pokok &amp; biaya</h4>
            <div className="u-table-wrap">
              <table className="u-table" aria-label="Rekapitulasi pokok dan biaya">
                <thead>
                  <tr>
                    <th scope="col">Kelompok</th>
                    <th scope="col">Nominal</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Pokok kategori</th>
                    <td>
                      <FinancialAmount as="span" value={formatMinor(shares.principalTotalMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Administrasi / layanan</th>
                    <td className={BigInt(fees.serviceMinor) === 0n ? "insight-zero-muted" : ""}>
                      <FinancialAmount as="span" value={formatMinor(fees.serviceMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Biaya layanan pada Transfer</th>
                    <td className={BigInt(fees.transferMinor) === 0n ? "insight-zero-muted" : ""}>
                      <FinancialAmount as="span" value={formatMinor(fees.transferMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Pajak</th>
                    <td className={taxesMinor === 0n ? "insight-zero-muted" : ""}>
                      <FinancialAmount as="span" value={formatMinor(taxesMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Biaya lainnya</th>
                    <td className={otherChargesMinor === 0n ? "insight-zero-muted" : ""}>
                      <FinancialAmount as="span" value={formatMinor(otherChargesMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total pengeluaran</th>
                    <td>
                      <FinancialAmount as="span" value={formatMinor(shares.totalMinor, first.currency, first.exponent)} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
      <p className="insight-note">
        Persentase dihitung dari total seluruh pengeluaran efektif. Biaya Transfer sudah termasuk dalam total belanja, bukan tambahan lagi. Pokok Transfer antar akun sendiri tidak termasuk.
      </p>
    </>
  );
}

export function InsightsCashflowSlide({ model }: { model: VisualTrendModel }) {
  const id = useId();
  const { report, currency, exponent, data, rows, mobile } = model;
  const curData = insightsCurrency(report, currency);
  const summary = curData.summary;

  let running = 0n;
  const series = rows.map((row) => {
    const net = BigInt(row.netMinor);
    running += net;
    return { ...row, netBig: net, cumBig: running };
  });
  const maxAbs = series.reduce((acc, item) => {
    const a = item.netBig < 0n ? -item.netBig : item.netBig;
    const b = item.cumBig < 0n ? -item.cumBig : item.cumBig;
    const peak = a > b ? a : b;
    return peak > acc ? peak : acc;
  }, 0n);

  const width = 340;
  const yZero = 96;
  const half = 56;
  const axisLeft = 68;
  const step = (width - axisLeft - 12) / Math.max(1, series.length);
  const poly = series
    .map((item, idx) => {
      const cx = axisLeft + step * (idx + 0.5);
      const ratio = maxAbs > 0n ? Number((item.cumBig * 1000n) / maxAbs) / 1000 : 0;
      const cy = Math.round((yZero - ratio * half) * 10) / 10;
      return `${cx},${cy}`;
    })
    .join(" ");

  const opIn = BigInt(summary?.incomeMinor ?? "0");
  const opOut = BigInt(summary?.spendingMinor ?? "0");
  const invSell = BigInt(curData.flows?.saleProceedsMinor ?? "0");
  const invBuy = BigInt(curData.flows?.purchasePrincipalMinor ?? "0") + BigInt(curData.flows?.feesMinor ?? "0");
  const cashIn = opIn + invSell;
  const cashOut = opOut + invBuy;
  const cashNet = cashIn - cashOut;

  return (
    <>
      <SectionHeading title="Arus kas & akumulasi" helper="Surplus/defisit bersih & pergerakan kas kumulatif." />
      <div className="insight-legend">
        <span>
          <i className="insight-income-dot" />
          Surplus
        </span>
        <span>
          <i className="insight-spending-dot" />
          Defisit
        </span>
        <span>
          <i className="insight-cumulative-dot" />
          Kumulatif
        </span>
      </div>
      {maxAbs === 0n ? (
        <p className="insight-empty">Belum ada pergerakan arus kas bersih pada periode ini.</p>
      ) : (
        <svg className="insight-fit-chart" viewBox={`0 0 ${width} 192`} role="img" aria-labelledby={`${id}-cf-slide`}>
          <title id={`${id}-cf-slide`}>Grafik surplus, defisit, dan arus kas kumulatif pada periode terpilih.</title>
          <line x1={axisLeft} x2={width - 8} y1={yZero - half} y2={yZero - half} className="insight-gridline" />
          <line x1={axisLeft} x2={width - 8} y1={yZero} y2={yZero} className="insight-zero-line" />
          <line x1={axisLeft} x2={width - 8} y1={yZero + half} y2={yZero + half} className="insight-gridline" />
          <text x={axisLeft - 6} y={yZero - half + 4} textAnchor="end" className="insight-axis">
            +{compactAxisMoney(maxAbs, currency, exponent)}
          </text>
          <text x={axisLeft - 6} y={yZero + 4} textAnchor="end" className="insight-axis">
            {formatMinor(0n, currency, exponent)}
          </text>
          <text x={axisLeft - 6} y={yZero + half + 4} textAnchor="end" className="insight-axis">
            −{compactAxisMoney(maxAbs, currency, exponent)}
          </text>
          {series.map((item, idx) => {
            const cx = axisLeft + step * (idx + 0.5);
            const bw = Math.min(18, Math.max(7, step * 0.42));
            const absNet = item.netBig < 0n ? -item.netBig : item.netBig;
            const bh = (plotPercent(absNet, maxAbs) / 100) * half;
            const by = item.netBig >= 0n ? yZero - bh : yZero;
            const axisLabel = (() => {
              if (data.granularity === "year") {
                return visualIntervalAxis(item, false, "year").label;
              }
              if (mobile || width <= 360) {
                if (data.granularity === "month") {
                  return visualIntervalAxis(item, false, "month").label;
                }
                const day = Number(item.startDay.slice(8));
                const month = Number(item.startDay.slice(5, 7));
                if (step < 34 && idx % Math.ceil(34 / step) !== 0 && idx !== series.length - 1) {
                  return "";
                }
                return `${day}/${month}`;
              }
              return visualIntervalAxis(item, data.weekly, data.granularity).label;
            })();
            return (
              <g key={item.key}>
                <rect
                  x={cx - bw / 2}
                  y={by}
                  width={bw}
                  height={bh}
                  rx="2.5"
                  className={item.netBig >= 0n ? "insight-income-bar" : "insight-spending-bar"}
                />
                <text x={cx} y={yZero + half + 20} textAnchor="middle" className="insight-axis">
                  {axisLabel}
                </text>
              </g>
            );
          })}
          {series.length > 1 && <polyline points={poly} fill="none" className="insight-cumulative-line" />}
          {series.map((item, idx) => {
            const cx = axisLeft + step * (idx + 0.5);
            const ratio = Number((item.cumBig * 1000n) / maxAbs) / 1000;
            const cy = Math.round((yZero - ratio * half) * 10) / 10;
            return <circle key={`${item.key}-pt`} cx={cx} cy={cy} r="3" className="insight-cumulative-point" />;
          })}
        </svg>
      )}
      <dl className="insight-interval-values">
        <div>
          <dt>Kas masuk</dt>
          <dd className="insight-positive">
            <FinancialAmount as="span" value={formatMinor(cashIn, currency, exponent)} />
          </dd>
        </div>
        <div>
          <dt>Kas keluar</dt>
          <dd className="insight-negative">
            <FinancialAmount as="span" value={formatMinor(cashOut, currency, exponent)} />
          </dd>
        </div>
        <div>
          <dt>Arus kas bersih</dt>
          <dd className={cashNet < 0n ? "insight-negative" : "insight-positive"}>
            <FinancialAmount as="span" value={signedMoney(cashNet.toString(), currency, exponent)} />
          </dd>
        </div>
      </dl>
    </>
  );
}

export function InsightsCostBars({
  rows,
  currency,
  exponent,
}: {
  rows: { key: string; label: string; amount: string }[];
  currency: string;
  exponent: number;
}) {
  const maximum = rows.reduce((max, row) => (BigInt(row.amount) > max ? BigInt(row.amount) : max), 0n);
  if (maximum === 0n) return null;
  return (
    <ul className="insight-cost-bars">
      {rows.map((row) => (
        <li key={row.key}>
          <div>
            <span>{row.label}</span>
            <FinancialAmount value={formatMinor(row.amount, currency, exponent)} />
          </div>
          <div className="insight-category-track" aria-hidden="true">
            <span style={{ width: `${plotPercent(row.amount, maximum)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
