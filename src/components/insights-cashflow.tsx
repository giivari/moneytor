"use client";

import { useId, useState } from "react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport, AnalyticsExpenseItem } from "@/lib/analytics/types";
import {
  compactAxisMoney,
  dayLabel,
  insightsCurrency,
  percentageLabel,
  plotPercent,
  signedMoney,
} from "@/lib/analytics/presentation";
import { incomeShares, visualIntervalAxis, visualTrend } from "@/lib/analytics/visuals";
import { formatShortDueIso } from "@/lib/domain/credit";
import { formatMinor } from "@/lib/finance/format";
import { AppLink } from "./app-link";
import { FinancialAmount } from "./financial-amount";
import { SectionHeading } from "./section-heading";
import { useInsightsViewport } from "./use-insights-viewport";

const weekdayNames: Record<string, string> = {
  "1": "Senin",
  "2": "Selasa",
  "3": "Rabu",
  "4": "Kamis",
  "5": "Jumat",
  "6": "Sabtu",
  "7": "Minggu",
};

type DeepTab = "cashflow" | "patterns" | "ratios";

export function elapsedDaysInPeriod(report: AnalyticsReport): bigint {
  const dayMs = 86400000;
  const start = Date.parse(`${report.period.startDay}T00:00:00Z`);
  const end = Date.parse(`${report.period.endDayExclusive}T00:00:00Z`);
  if (report.period.partial) {
    const genDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(report.generatedAt));
    const genNext = Date.parse(`${genDay}T00:00:00Z`) + dayMs;
    const bounded = Math.max(start + dayMs, Math.min(end, genNext));
    return BigInt(Math.max(1, Math.round((bounded - start) / dayMs)));
  }
  return BigInt(Math.max(1, Math.round((end - start) / dayMs)));
}

function renderExpenseTable(items: AnalyticsExpenseItem[], startIndex: number, money: (val: string | bigint) => string, ariaLabel: string) {
  return (
    <div className="u-table-wrap">
      <table className="u-table" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th scope="col">Transaksi</th>
            <th scope="col">Nominal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const shortDate = new Date(item.occurredAt).toLocaleDateString("id-ID", {
              timeZone: "Asia/Jakarta",
              day: "numeric",
              month: "short",
            });
            return (
              <tr key={item.id}>
                <th scope="row">
                  <span className="insight-rank-num">{startIndex + idx}.</span>
                  <strong>{item.note?.trim() || item.categoryName || "Pengeluaran"}</strong>
                  {item.isCreditSource && (
                    <em className="u-pill insight-credit-chip" data-tone="credit">
                      Kredit
                    </em>
                  )}
                  <small className="u-cell-sub">
                    {item.categoryName ?? "Tanpa kategori"} · {item.sourceName} · {shortDate}
                  </small>
                </th>
                <td className="insight-negative">
                  <FinancialAmount as="span" value={money(item.spendingMinor)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsFinancialSuite({
  report,
  currency,
  exponent,
  granularity = "auto",
}: {
  report: AnalyticsReport;
  currency: string;
  exponent: number;
  granularity?: AnalyticsGranularity;
}) {
  const mobile = useInsightsViewport();
  const chartId = useId();
  const [activeTab, setActiveTab] = useState<DeepTab>("cashflow");

  const data = insightsCurrency(report, currency);
  const summary = data.summary;
  if (!summary) return null;

  const money = (val: string | bigint) => formatMinor(val, currency, exponent);

  const opIncome = BigInt(summary.incomeMinor);
  const opSpending = BigInt(summary.spendingMinor);
  const transferFeesMinor = BigInt(summary.transferFeesMinor);
  const invBuy = BigInt(data.flows?.purchasePrincipalMinor ?? "0");
  const invSell = BigInt(data.flows?.saleProceedsMinor ?? "0");
  const invFees = BigInt(data.flows?.feesMinor ?? "0");
  const totalInflow = opIncome + invSell;
  const totalOutflow = opSpending + invBuy + invFees;
  const netCashFlow = totalInflow - totalOutflow;

  // Credit Facilities (strictly separated from non-credit Bills & Obligations; Automation is a recording method, not a bill)
  const cb = data.creditAndBills;
  const facilities = cb?.facilities ?? [];
  const creditSpend = BigInt(cb?.creditSpendingMinor ?? "0");
  const cashSpend = cb ? BigInt(cb.cashSpendingMinor) : opSpending;
  const creditRepay = BigInt(cb?.creditRepaymentMinor ?? "0");
  const currentCycleBills = BigInt(cb?.currentCycleBillsMinor ?? "0");
  const nextCycleBills = BigInt(cb?.nextCycleBillsMinor ?? "0");
  const totalCreditUnpaid = BigInt(cb?.totalCreditUnpaidMinor ?? "0");

  const billCatSpend = BigInt(cb?.billCategorySpendingMinor ?? "0");
  const billCatCount = cb?.billCategoryCount ?? "0";
  const billCategories = cb?.billCategories ?? [];
  const openObs = cb?.obligations ?? [];
  const openObsTotal = BigInt(cb?.openObligationsMinor ?? "0");
  const settledObsCount = cb?.settledInPeriodCount ?? 0;
  const settledObsTotal = BigInt(cb?.settledInPeriodMinor ?? "0");

  const hasCreditCard =
    facilities.length > 0 ||
    creditSpend > 0n ||
    creditRepay > 0n ||
    totalCreditUnpaid > 0n;

  const hasBillsCard =
    openObs.length > 0 ||
    settledObsCount > 0 ||
    billCatSpend > 0n;

  const sortedExpenses = [...data.expenseItems].sort((a, b) => {
    const diff = BigInt(b.spendingMinor) - BigInt(a.spendingMinor);
    return diff !== 0n ? (diff > 0n ? 1 : -1) : b.occurredAt.localeCompare(a.occurredAt);
  });
  const topLimit = 5;
  const visibleTopExpenses = sortedExpenses.slice(0, topLimit);
  const extraTopExpenses = mobile ? [] : sortedExpenses.slice(topLimit, 12);
  const uncategorizedCount = data.expenseItems.filter((item) => item.categoryId === null).length;

  const hasAnyActivity =
    summary.activityCount !== "0" || facilities.length > 0 || openObs.length > 0 || invBuy + invSell > 0n;

  if (!hasAnyActivity) return null;

  const trendData = visualTrend(report, currency, granularity === "day" ? 14 : 12, granularity);
  const intervals = trendData.intervals;
  let runningCumulative = 0n;
  const cashSeries = intervals.map((row) => {
    const net = BigInt(row.netMinor);
    runningCumulative += net;
    return { ...row, netBig: net, cumulativeBig: runningCumulative };
  });
  const maxAbsFlow = cashSeries.reduce((acc, item) => {
    const absNet = item.netBig < 0n ? -item.netBig : item.netBig;
    const absCum = item.cumulativeBig < 0n ? -item.cumulativeBig : item.cumulativeBig;
    const peak = absNet > absCum ? absNet : absCum;
    return peak > acc ? peak : acc;
  }, 0n);

  const svgWidth = Math.max(440, cashSeries.length * 46 + 80);
  const yZero = 100;
  const halfSpan = 64;
  const stepX = (svgWidth - 80) / Math.max(1, cashSeries.length);
  const polylinePoints = cashSeries
    .map((item, idx) => {
      const cx = 68 + stepX * (idx + 0.5);
      const ratio = maxAbsFlow > 0n ? Number((item.cumulativeBig * 1000n) / maxAbsFlow) / 1000 : 0;
      const cy = Math.round((yZero - ratio * halfSpan) * 10) / 10;
      return `${cx},${cy}`;
    })
    .join(" ");

  const daysElapsed = elapsedDaysInPeriod(report);
  const dailyBurnMinor = opSpending / daysElapsed;
  const projectedMonthlyBurn = dailyBurnMinor * 30n;
  const savingsRateBps = opIncome > 0n ? (((opIncome - opSpending) * 10000n) / opIncome).toString() : null;
  const expenseRatioBps = opIncome > 0n ? ((opSpending * 10000n) / opIncome).toString() : null;
  const expenseCount = BigInt(summary.expenseCount);
  const avgExpenseMinor = expenseCount > 0n ? (opSpending - transferFeesMinor) / expenseCount : 0n;

  const liquidMinor = data.assets ? BigInt(data.assets.liquidMinor) : null;
  const totalAssetsMinor = data.assets ? BigInt(data.assets.totalMinor) : null;
  const creditDebtMinor =
    data.assets && "creditDebtMinor" in data.assets && typeof data.assets.creditDebtMinor === "string"
      ? BigInt(data.assets.creditDebtMinor)
      : totalCreditUnpaid;
  const netWorthMinor = totalAssetsMinor !== null ? totalAssetsMinor - creditDebtMinor : null;
  const runwayDays =
    liquidMinor !== null && liquidMinor > 0n && dailyBurnMinor > 0n ? liquidMinor / dailyBurnMinor : null;

  const totalDebt = totalCreditUnpaid > 0n ? totalCreditUnpaid : currentCycleBills + nextCycleBills;
  const debtToIncomeBps =
    opIncome > 0n && totalDebt > 0n
      ? (totalDebt * 10000n) / opIncome
      : totalDebt === 0n && opIncome > 0n
        ? 0n
        : null;
  const debtToLiquidBps =
    liquidMinor !== null && liquidMinor > 0n && totalDebt > 0n
      ? (totalDebt * 10000n) / liquidMinor
      : totalDebt === 0n && liquidMinor !== null
        ? 0n
        : null;
  const cashCoverageBps =
    totalDebt > 0n && liquidMinor !== null && liquidMinor > 0n
      ? (liquidMinor * 10000n) / totalDebt
      : null;

  const incomeBreakdown = incomeShares(data.incomeCategories)
    .rows.filter((row) => BigInt(row.incomeMinor) > 0n)
    .sort((a, b) =>
      BigInt(a.incomeMinor) === BigInt(b.incomeMinor)
        ? a.name.localeCompare(b.name)
        : BigInt(a.incomeMinor) > BigInt(b.incomeMinor)
          ? -1
          : 1,
    );
  const weekdayMap = new Map(data.weekdays.map((row) => [row.key, row]));
  const fullWeekdays = ["1", "2", "3", "4", "5", "6", "7"].map((iso) => {
    const found = weekdayMap.get(iso);
    return {
      key: iso,
      name: weekdayNames[iso],
      spendingMinor: found?.spendingMinor ?? "0",
      expenseCount: found?.expenseCount ?? "0",
    };
  });
  const maxWeekdaySpend = fullWeekdays.reduce(
    (max, item) => (BigInt(item.spendingMinor) > max ? BigInt(item.spendingMinor) : max),
    0n,
  );
  const peakWeekday =
    maxWeekdaySpend > 0n
      ? fullWeekdays.find((item) => BigInt(item.spendingMinor) === maxWeekdaySpend) ?? null
      : null;

  const granularityLabel =
    trendData.granularity === "day"
      ? "harian"
      : trendData.granularity === "week"
        ? "mingguan"
        : trendData.granularity === "year"
          ? "tahunan"
          : "bulanan";

  const limitedFacilities = facilities.filter((f) => f.availableLimitMinor !== null && BigInt(f.limitMinor) > 0n);
  const totalAvailableLimit = limitedFacilities.reduce((sum, f) => sum + BigInt(f.availableLimitMinor ?? "0"), 0n);

  return (
    <div className="insight-suite">
      {!mobile && (
        <section className="surface insight-panel insight-deep-dive" aria-label="Analisis arus kas, pola, dan rasio">
          <div className="insight-deep-header">
            <div>
              <h2>Arus Kas &amp; Pola Keuangan</h2>
              <p className="insight-note">Pergerakan saldo kas kumulatif, distribusi hari belanja, dan rasio ketahanan dana.</p>
            </div>
            <div className="insight-seg-tabs" role="tablist" aria-label="Modul analisis keuangan">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "cashflow"}
                className="insight-seg-tab"
                data-active={activeTab === "cashflow" ? "true" : "false"}
                onClick={() => setActiveTab("cashflow")}
              >
                Arus Kas Kumulatif
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "patterns"}
                className="insight-seg-tab"
                data-active={activeTab === "patterns" ? "true" : "false"}
                onClick={() => setActiveTab("patterns")}
              >
                Pola Hari &amp; Pemasukan
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "ratios"}
                className="insight-seg-tab"
                data-active={activeTab === "ratios" ? "true" : "false"}
                onClick={() => setActiveTab("ratios")}
              >
                Rasio &amp; Burn Rate
              </button>
            </div>
          </div>

          {activeTab === "cashflow" && (
            <div className="insight-tab-pane">
              <div className="insight-cashflow-kpis">
                <div className="insight-cashflow-kpi">
                  <span>Kas Masuk</span>
                  <strong className="insight-positive">
                    <FinancialAmount as="span" value={money(totalInflow)} className="insight-money" />
                  </strong>
                  <small>
                    Pemasukan {money(opIncome)}
                    {invSell > 0n ? ` + Jual instrumen ${money(invSell)}` : ""}
                  </small>
                </div>
                <div className="insight-cashflow-kpi">
                  <span>Kas Keluar</span>
                  <strong className="insight-negative">
                    <FinancialAmount as="span" value={money(totalOutflow)} className="insight-money" />
                  </strong>
                  <small>
                    Belanja {money(opSpending)}
                    {invBuy + invFees > 0n ? ` + Investasi ${money(invBuy + invFees)}` : ""}
                  </small>
                </div>
                <div className="insight-cashflow-kpi">
                  <span>Arus Kas Bersih</span>
                  <strong className={netCashFlow < 0n ? "insight-negative" : "insight-positive"}>
                    <FinancialAmount
                      as="span"
                      value={signedMoney(netCashFlow.toString(), currency, exponent)}
                      className="insight-money"
                    />
                  </strong>
                  <small>{netCashFlow >= 0n ? "Surplus kas bersih" : "Defisit kas bersih"}</small>
                </div>
                <div className="insight-cashflow-kpi">
                  <span>Mutasi Transfer</span>
                  <strong>
                    <FinancialAmount as="span" value={money(summary.transferPrincipalMinor)} className="insight-money" />
                  </strong>
                  <small>{summary.transferCount}x perpindahan antar akun</small>
                </div>
              </div>

              {cashSeries.length > 0 && (
                <div className="insight-cashflow-chart-wrap">
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
                      Kas kumulatif ({granularityLabel})
                    </span>
                  </div>
                  <svg
                    className="insight-fit-chart insight-cashflow-svg"
                    viewBox={`0 0 ${svgWidth} 204`}
                    role="img"
                    aria-labelledby={`${chartId}-cf-title`}
                  >
                    <title id={`${chartId}-cf-title`}>
                      {`Grafik arus kas bersih dan saldo kas kumulatif ${granularityLabel}.`}
                    </title>
                    <line x1="64" x2={svgWidth - 10} y1={yZero - halfSpan} y2={yZero - halfSpan} className="insight-gridline" />
                    <line x1="64" x2={svgWidth - 10} y1={yZero} y2={yZero} className="insight-zero-line" />
                    <line x1="64" x2={svgWidth - 10} y1={yZero + halfSpan} y2={yZero + halfSpan} className="insight-gridline" />
                    <text x="58" y={yZero - halfSpan + 4} textAnchor="end" className="insight-axis">
                      {maxAbsFlow > 0n ? `+${compactAxisMoney(maxAbsFlow, currency, exponent)}` : money(0n)}
                    </text>
                    <text x="58" y={yZero + 4} textAnchor="end" className="insight-axis">
                      {money(0n)}
                    </text>
                    <text x="58" y={yZero + halfSpan + 4} textAnchor="end" className="insight-axis">
                      {maxAbsFlow > 0n ? `−${compactAxisMoney(maxAbsFlow, currency, exponent)}` : money(0n)}
                    </text>
                    {cashSeries.map((item, idx) => {
                      const cx = 68 + stepX * (idx + 0.5);
                      const barWidth = Math.min(22, Math.max(8, stepX * 0.42));
                      const absNet = item.netBig < 0n ? -item.netBig : item.netBig;
                      const barHeight = maxAbsFlow > 0n ? (plotPercent(absNet, maxAbsFlow) / 100) * halfSpan : 0;
                      const barY = item.netBig >= 0n ? yZero - barHeight : yZero;
                      const axisLabel =
                        mobile || trendData.granularity === "day" || trendData.weekly
                          ? `${Number(item.startDay.slice(8))}/${Number(item.startDay.slice(5, 7))}`
                          : visualIntervalAxis(item, trendData.weekly, trendData.granularity).label;
                      return (
                        <g key={item.key}>
                          <title>{`${item.label}: net ${signedMoney(item.netBig.toString(), currency, exponent)}, kumulatif ${signedMoney(item.cumulativeBig.toString(), currency, exponent)}`}</title>
                          <rect
                            x={cx - barWidth / 2}
                            y={barY}
                            width={barWidth}
                            height={barHeight}
                            rx="3"
                            className={item.netBig >= 0n ? "insight-income-bar" : "insight-spending-bar"}
                          />
                          <text x={cx} y={yZero + halfSpan + 22} textAnchor="middle" className="insight-axis">
                            {axisLabel}
                          </text>
                        </g>
                      );
                    })}
                    {maxAbsFlow > 0n && cashSeries.length > 1 && (
                      <polyline points={polylinePoints} fill="none" className="insight-cumulative-line" />
                    )}
                    {maxAbsFlow > 0n &&
                      cashSeries.map((item, idx) => {
                        const cx = 68 + stepX * (idx + 0.5);
                        const ratio = Number((item.cumulativeBig * 1000n) / maxAbsFlow) / 1000;
                        const cy = Math.round((yZero - ratio * halfSpan) * 10) / 10;
                        return <circle key={`${item.key}-pt`} cx={cx} cy={cy} r="3.5" className="insight-cumulative-point" />;
                      })}
                  </svg>
                </div>
              )}
            </div>
          )}

          {activeTab === "patterns" && (
            <div className="insight-tab-pane u-subgrid">
              <div className="u-table-section">
                <h4 className="u-table-title">Pola belanja menurut hari</h4>
                {maxWeekdaySpend === 0n ? (
                  <p className="insight-empty">Belum ada pengeluaran pada periode ini.</p>
                ) : (
                  <div className="u-table-wrap">
                    <table className="u-table" aria-label="Pola belanja menurut hari">
                      <thead>
                        <tr>
                          <th scope="col">Hari</th>
                          <th scope="col">Transaksi</th>
                          <th scope="col">Proporsi</th>
                          <th scope="col">Nominal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fullWeekdays.map((day) => {
                          const isZero = BigInt(day.spendingMinor) === 0n;
                          const isPeak = peakWeekday?.key === day.key;
                          return (
                            <tr key={day.key}>
                              <th scope="row">
                                <strong>{day.name}</strong>
                                {isPeak && (
                                  <em className="u-pill" data-tone="credit">
                                    Tertinggi
                                  </em>
                                )}
                              </th>
                              <td className="insight-zero-muted">{day.expenseCount}x</td>
                              <td>
                                <span className="u-inline-bar" aria-hidden="true">
                                  <span
                                    data-tone={isPeak ? "negative" : undefined}
                                    style={{ width: `${plotPercent(day.spendingMinor, maxWeekdaySpend)}%` }}
                                  />
                                </span>
                              </td>
                              <td className={isZero ? "insight-zero-muted" : ""}>
                                <FinancialAmount as="span" value={money(day.spendingMinor)} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="u-table-section">
                <h4 className="u-table-title">Sumber pemasukan</h4>
                {opIncome === 0n || incomeBreakdown.length === 0 ? (
                  <p className="insight-empty">Belum ada pemasukan tercatat pada periode ini.</p>
                ) : (
                  <div className="u-table-wrap">
                    <table className="u-table" aria-label="Sumber pemasukan">
                      <thead>
                        <tr>
                          <th scope="col">Kategori</th>
                          <th scope="col">Transaksi</th>
                          <th scope="col">Porsi</th>
                          <th scope="col">Nominal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incomeBreakdown.map((row) => (
                          <tr key={row.key}>
                            <th scope="row">
                              <strong>{row.name}</strong>
                              {row.archived && <em className="u-pill">Diarsipkan</em>}
                            </th>
                            <td className="insight-zero-muted">{row.incomeCount}x</td>
                            <td className="insight-zero-muted">{percentageLabel(row.shareBps)}</td>
                            <td className="insight-positive">
                              <FinancialAmount as="span" value={money(row.incomeMinor)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "ratios" && (
            <div className="insight-tab-pane u-subgrid">
              <div className="u-table-section">
                <h4 className="u-table-title">Efisiensi &amp; laju pengeluaran</h4>
                <div className="u-table-wrap">
                  <table className="u-table" aria-label="Indikator efisiensi dan laju pengeluaran">
                    <thead>
                      <tr>
                        <th scope="col">Indikator</th>
                        <th scope="col">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">
                          <strong>Rasio Tabungan (Savings Rate)</strong>
                          <small className="u-cell-sub">
                            {savingsRateBps === null
                              ? "Belum ada pemasukan periode ini"
                              : BigInt(savingsRateBps) >= 2000n
                                ? "Sehat (≥ 20% pemasukan tersimpan)"
                                : BigInt(savingsRateBps) >= 0n
                                  ? "Positif (< 20% dari pemasukan)"
                                  : "Pengeluaran melampaui pemasukan"}
                          </small>
                        </th>
                        <td
                          className={
                            savingsRateBps === null
                              ? "insight-zero-muted"
                              : BigInt(savingsRateBps) < 0n
                                ? "insight-negative"
                                : "insight-positive"
                          }
                        >
                          {percentageLabel(savingsRateBps, true)}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Rasio Belanja thd Pemasukan</strong>
                          <small className="u-cell-sub">Porsi pemasukan yang terpakai</small>
                        </th>
                        <td>{percentageLabel(expenseRatioBps)}</td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Rasio Beban Utang (Debt-to-Income / DTI)</strong>
                          <small className="u-cell-sub">
                            {totalDebt > 0n
                              ? opIncome > 0n
                                ? `Kewajiban kredit ${money(totalDebt)} thd pemasukan (Aman < 30%)`
                                : "Belum ada pemasukan periode ini"
                              : "Tidak ada kewajiban kredit aktif"}
                          </small>
                        </th>
                        <td
                          className={
                            debtToIncomeBps === null
                              ? "insight-zero-muted"
                              : debtToIncomeBps > 3000n
                                ? "insight-negative"
                                : "insight-positive"
                          }
                        >
                          {debtToIncomeBps !== null ? percentageLabel(debtToIncomeBps.toString()) : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Burn Rate Harian ({daysElapsed.toString()} hr)</strong>
                          <small className="u-cell-sub">
                            Estimasi 30 hari: <FinancialAmount as="span" value={money(projectedMonthlyBurn)} />
                          </small>
                        </th>
                        <td>
                          <FinancialAmount as="span" value={money(dailyBurnMinor)} />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="u-table-section">
                <h4 className="u-table-title">Ketahanan &amp; posisi bersih</h4>
                <div className="u-table-wrap">
                  <table className="u-table" aria-label="Indikator ketahanan dana dan posisi bersih">
                    <thead>
                      <tr>
                        <th scope="col">Indikator</th>
                        <th scope="col">Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">
                          <strong>Rata-rata per Transaksi Belanja</strong>
                          <small className="u-cell-sub">{summary.expenseCount} transaksi pengeluaran</small>
                        </th>
                        <td className={expenseCount === 0n ? "insight-zero-muted" : ""}>
                          {expenseCount > 0n ? <FinancialAmount as="span" value={money(avgExpenseMinor)} /> : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Rasio Utang thd Dana Kas Likuid</strong>
                          <small className="u-cell-sub">
                            {totalDebt > 0n
                              ? liquidMinor !== null && liquidMinor > 0n
                                ? `Kas likuid ${money(liquidMinor)} menutup ${percentageLabel(cashCoverageBps?.toString() ?? "0")} utang`
                                : "Saldo kas likuid belum tersedia"
                              : "Bebas utang kredit"}
                          </small>
                        </th>
                        <td
                          className={
                            debtToLiquidBps === null
                              ? "insight-zero-muted"
                              : debtToLiquidBps > 10000n
                                ? "insight-negative"
                                : "insight-positive"
                          }
                        >
                          {debtToLiquidBps !== null ? percentageLabel(debtToLiquidBps.toString()) : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Ketahanan Dana Likuid (Runway)</strong>
                          <small className="u-cell-sub">
                            {liquidMinor !== null ? `Dari dana likuid ${money(liquidMinor)}` : "Data saldo likuid belum tersedia"}
                          </small>
                        </th>
                        <td>
                          {runwayDays !== null
                            ? runwayDays >= 60n
                              ? `${(runwayDays / 30n).toString()} bln ${(runwayDays % 30n).toString()} hr`
                              : `${runwayDays.toString()} hari`
                            : liquidMinor !== null && dailyBurnMinor === 0n && liquidMinor > 0n
                              ? "Stabil"
                              : "—"}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <strong>Kekayaan Bersih Diketahui</strong>
                          <small className="u-cell-sub">
                            {totalAssetsMinor !== null
                              ? creditDebtMinor > 0n
                                ? `Aset ${money(totalAssetsMinor)} − kewajiban kredit ${money(creditDebtMinor)}`
                                : `Total aset ${money(totalAssetsMinor)}`
                              : "Snapshot aset belum tersedia"}
                          </small>
                        </th>
                        <td className={netWorthMinor !== null && netWorthMinor < 0n ? "insight-negative" : ""}>
                          {netWorthMinor !== null ? <FinancialAmount as="span" value={money(netWorthMinor)} /> : "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="insight-mid-grid">
        {hasCreditCard && (
          <section className="surface insight-panel insight-credit-card" aria-label="Fasilitas Kredit">
            <SectionHeading
              title="Fasilitas Kredit"
              helper="Pemakaian limit, siklus jatuh tempo, dan pelunasan akun kredit."
            />

            <div className="insight-compact-kpis">
              <div>
                <span>Belanja Kas / Debit</span>
                <strong>
                  <FinancialAmount as="span" value={money(cashSpend)} className="insight-money" />
                </strong>
              </div>
              <div>
                <span>Belanja via Kredit</span>
                <strong className={creditSpend > 0n ? "insight-negative" : ""}>
                  <FinancialAmount as="span" value={money(creditSpend)} className="insight-money" />
                </strong>
                {cb && BigInt(cb.creditExpenseCount) > 0n && <small>{cb.creditExpenseCount}x transaksi</small>}
              </div>
              <div>
                <span>Pelunasan Kredit</span>
                <strong className={creditRepay > 0n ? "insight-positive" : ""}>
                  <FinancialAmount as="span" value={money(creditRepay)} className="insight-money" />
                </strong>
                {cb && BigInt(cb.creditRepaymentCount) > 0n && <small>{cb.creditRepaymentCount}x pelunasan</small>}
              </div>
            </div>

            <div className="insight-credit-ratios-strip">
              <div className="insight-credit-ratio-box">
                <span className="insight-ratio-label">Beban thd Pemasukan (DTI)</span>
                <strong
                  className={
                    debtToIncomeBps !== null && debtToIncomeBps > 3000n
                      ? "insight-negative"
                      : "insight-positive"
                  }
                >
                  {debtToIncomeBps !== null ? percentageLabel(debtToIncomeBps.toString()) : "—"}
                </strong>
                <small className="u-cell-sub">
                  {opIncome > 0n
                    ? `Kewajiban ${money(totalDebt)} dari pemasukan ${money(opIncome)} (Aman < 30%)`
                    : "Belum ada pemasukan pada periode ini"}
                </small>
              </div>
              <div className="insight-credit-ratio-box">
                <span className="insight-ratio-label">Beban thd Dana Kas Likuid</span>
                <strong
                  className={
                    debtToLiquidBps !== null && debtToLiquidBps > 10000n
                      ? "insight-negative"
                      : "insight-positive"
                  }
                >
                  {debtToLiquidBps !== null ? percentageLabel(debtToLiquidBps.toString()) : "—"}
                </strong>
                <small className="u-cell-sub">
                  {liquidMinor !== null && liquidMinor > 0n
                    ? totalDebt > 0n
                      ? `Kas saat ini (${money(liquidMinor)}) menutup ${percentageLabel(cashCoverageBps?.toString() ?? "0")} kewajiban`
                      : "Tidak ada beban kredit aktif"
                    : "Data saldo kas likuid belum tersedia"}
                </small>
              </div>
            </div>

            {facilities.length > 0 && (
              <div className="u-table-wrap insight-table-gap">
                {mobile ? (
                  <table className="u-table" aria-label="Daftar fasilitas kredit">
                    <thead>
                      <tr>
                        <th scope="col">Fasilitas &amp; limit</th>
                        <th scope="col">Tagihan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facilities.map((fac) => {
                        const curBill = BigInt(fac.currentBillMinor);
                        const nextBill = BigInt(fac.nextBillMinor);
                        const unpaid = BigInt(fac.totalUnpaidMinor);
                        const limit = BigInt(fac.limitMinor);
                        const usedPct = limit > 0n ? plotPercent(unpaid, limit) : 0;
                        return (
                          <tr key={fac.id}>
                            <th scope="row">
                              <strong>{fac.name}</strong>
                              {!fac.isActive && <em className="u-pill">Diarsipkan</em>}
                              <small className="u-cell-sub">
                                {fac.availableLimitMinor !== null && limit > 0n
                                  ? `Sisa limit ${money(fac.availableLimitMinor)} (plafon ${usedPct}%)`
                                  : "Bebas tagihan"}
                              </small>
                            </th>
                            <td className={curBill > 0n ? "insight-negative" : "insight-positive"}>
                              {curBill > 0n ? (
                                <FinancialAmount as="span" value={money(curBill)} />
                              ) : (
                                "Lunas"
                              )}
                              <small className="u-cell-sub">
                                {formatShortDueIso(fac.currentDueIso)}
                                {nextBill > 0n ? ` · Depan: ${money(nextBill)}` : ""}
                              </small>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {facilities.length > 1 && (
                      <tfoot>
                        <tr>
                          <th scope="row">Total {facilities.length} fasilitas kredit</th>
                          <td className={currentCycleBills > 0n ? "insight-negative" : "insight-positive"}>
                            {currentCycleBills > 0n ? (
                              <FinancialAmount as="span" value={money(currentCycleBills)} />
                            ) : (
                              "Lunas"
                            )}
                            {nextCycleBills > 0n && (
                              <small className="u-cell-sub">Depan: {money(nextCycleBills)}</small>
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                ) : (
                  <table className="u-table" aria-label="Daftar fasilitas kredit">
                    <thead>
                      <tr>
                        <th scope="col">Fasilitas</th>
                        <th scope="col">Sisa limit</th>
                        <th scope="col">Tagihan terdekat</th>
                        <th scope="col">Periode depan</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facilities.map((fac) => {
                        const curBill = BigInt(fac.currentBillMinor);
                        const nextBill = BigInt(fac.nextBillMinor);
                        const unpaid = BigInt(fac.totalUnpaidMinor);
                        const limit = BigInt(fac.limitMinor);
                        const usedPct = limit > 0n ? plotPercent(unpaid, limit) : 0;
                        const facIncomeBps = opIncome > 0n && unpaid > 0n ? (unpaid * 10000n) / opIncome : null;
                        const facLiquidBps =
                          liquidMinor !== null && liquidMinor > 0n && unpaid > 0n ? (unpaid * 10000n) / liquidMinor : null;
                        return (
                          <tr key={fac.id}>
                            <th scope="row">
                              <strong>{fac.name}</strong>
                              {!fac.isActive && <em className="u-pill">Diarsipkan</em>}
                              <small className="u-cell-sub">
                                {facIncomeBps !== null
                                  ? `${percentageLabel(facIncomeBps.toString())} pemasukan`
                                  : ""}
                                {facIncomeBps !== null && facLiquidBps !== null ? " · " : ""}
                                {facLiquidBps !== null
                                  ? `${percentageLabel(facLiquidBps.toString())} kas likuid`
                                  : ""}
                                {facIncomeBps === null && facLiquidBps === null
                                  ? limit > 0n
                                    ? `Plafon terpakai ${usedPct}%`
                                    : "Bebas tagihan"
                                  : ""}
                              </small>
                            </th>
                            <td className="insight-zero-muted">
                              {fac.availableLimitMinor !== null && limit > 0n ? (
                                <>
                                  <FinancialAmount as="span" value={money(fac.availableLimitMinor)} />
                                  <small className="u-cell-sub">
                                    dari {money(limit)} (plafon {usedPct}%)
                                  </small>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className={curBill > 0n ? "insight-negative" : "insight-positive"}>
                              {curBill > 0n ? <FinancialAmount as="span" value={money(curBill)} /> : "Lunas"}
                              <small className="u-cell-sub">{formatShortDueIso(fac.currentDueIso)}</small>
                            </td>
                            <td className={nextBill === 0n ? "insight-zero-muted" : ""}>
                              <FinancialAmount as="span" value={money(nextBill)} />
                              <small className="u-cell-sub">{formatShortDueIso(fac.nextDueIso)}</small>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {facilities.length > 1 && (
                      <tfoot>
                        <tr>
                          <th scope="row">Total {facilities.length} fasilitas kredit</th>
                          <td className="insight-zero-muted">
                            {limitedFacilities.length > 0 ? (
                              <FinancialAmount as="span" value={money(totalAvailableLimit)} />
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className={currentCycleBills > 0n ? "insight-negative" : "insight-positive"}>
                            {currentCycleBills > 0n ? <FinancialAmount as="span" value={money(currentCycleBills)} /> : "Lunas"}
                          </td>
                          <td className={nextCycleBills === 0n ? "insight-zero-muted" : ""}>
                            <FinancialAmount as="span" value={money(nextCycleBills)} />
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
            )}

            <p className="insight-note insight-card-footer">
              {totalDebt > 0n ? (
                <>
                  Kewajiban kredit aktif{" "}
                  <FinancialAmount as="span" value={money(totalDebt)} className="insight-money" />
                  . Rasio beban utang: <strong>{debtToIncomeBps !== null ? percentageLabel(debtToIncomeBps.toString()) : "—"}</strong>{" "}
                  dari pemasukan · <strong>{debtToLiquidBps !== null ? percentageLabel(debtToLiquidBps.toString()) : "—"}</strong>{" "}
                  dari kas likuid.
                </>
              ) : (
                <>Tidak ada tagihan kredit berjalan atau pinjaman aktif pada periode ini.</>
              )}
            </p>
          </section>
        )}

        {hasBillsCard && (
          <section className="surface insight-panel insight-bills-card" aria-label="Tagihan dan Kewajiban">
            <SectionHeading
              title="Tagihan & Kewajiban"
              helper="Kewajiban jatuh tempo di Planning serta realisasi belanja kategori tagihan & utilitas."
            />

            {(openObs.length > 0 || settledObsCount > 0) && (
              <div className="u-table-wrap">
                <table className="u-table" aria-label="Kewajiban aktif dan tagihan belum lunas">
                  <thead>
                    <tr>
                      <th scope="col">Kewajiban Planning</th>
                      <th scope="col">Nominal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openObs.slice(0, 5).map((ob) => (
                      <tr key={ob.id}>
                        <th scope="row">
                          <strong>{ob.title}</strong>
                          <small className="u-cell-sub">
                            {ob.labelName} · Jatuh tempo {dayLabel(ob.dueOn)}
                          </small>
                        </th>
                        <td className="insight-negative">
                          <FinancialAmount as="span" value={money(ob.amountMinor)} />
                        </td>
                      </tr>
                    ))}
                    {settledObsCount > 0 && (
                      <tr>
                        <th scope="row">
                          <strong>Kewajiban dilunasi periode ini</strong>
                          <small className="u-cell-sub">{settledObsCount} kewajiban selesai</small>
                        </th>
                        <td className="insight-positive">
                          <FinancialAmount as="span" value={money(settledObsTotal)} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {openObs.length > 1 && (
                    <tfoot>
                      <tr>
                        <th scope="row">Total kewajiban belum lunas</th>
                        <td className="insight-negative">
                          <FinancialAmount as="span" value={money(openObsTotal)} />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            {billCatSpend > 0n && (
              <div className={`u-table-wrap${openObs.length > 0 || settledObsCount > 0 ? " insight-table-gap" : ""}`}>
                <table className="u-table" aria-label="Realisasi pengeluaran kategori tagihan dan utilitas">
                  <thead>
                    <tr>
                      <th scope="col">Tagihan &amp; utilitas tercatat</th>
                      <th scope="col">Nominal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billCategories.length > 0 ? (
                      billCategories.map((cat) => (
                        <tr key={cat.key}>
                          <th scope="row">
                            <strong>{cat.name}</strong>
                            {cat.archived && <em className="u-pill">Diarsipkan</em>}
                            <small className="u-cell-sub">{cat.expenseCount}x transaksi</small>
                          </th>
                          <td>
                            <FinancialAmount as="span" value={money(cat.spendingMinor)} />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <th scope="row">
                          <strong>Kategori tagihan &amp; utilitas</strong>
                          <small className="u-cell-sub">{billCatCount}x transaksi</small>
                        </th>
                        <td>
                          <FinancialAmount as="span" value={money(billCatSpend)} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {billCategories.length > 1 && (
                    <tfoot>
                      <tr>
                        <th scope="row">Total tagihan &amp; utilitas</th>
                        <td>
                          <FinancialAmount as="span" value={money(billCatSpend)} />
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}

            <p className="insight-note insight-card-footer">
              {openObsTotal > 0n || billCatSpend > 0n ? (
                <>
                  Total kewajiban terbuka &amp; tagihan tercatat{" "}
                  <FinancialAmount as="span" value={money(openObsTotal + billCatSpend)} className="insight-money" />.
                </>
              ) : (
                <>Semua kewajiban operasional &amp; tagihan tercatat telah terlunasi.</>
              )}
            </p>
          </section>
        )}

        {visibleTopExpenses.length > 0 && (
          <section className="surface insight-panel insight-top-expenses-card" aria-label="Pengeluaran terbesar">
            <SectionHeading
              title="Pengeluaran terbesar"
              helper={`Urutan transaksi pengeluaran tertinggi pada periode ini (${sortedExpenses.length} transaksi).`}
            />
            {renderExpenseTable(visibleTopExpenses, 1, money, "Pengeluaran terbesar")}

            {extraTopExpenses.length > 0 && (
              <details className="insight-inline-detail">
                <summary>
                  Lihat urutan {topLimit + 1}–{topLimit + extraTopExpenses.length}
                </summary>
                {renderExpenseTable(extraTopExpenses, topLimit + 1, money, "Pengeluaran terbesar lanjutan")}
              </details>
            )}

            <p className="insight-note insight-top-footer">
              {uncategorizedCount > 0 ? (
                <>
                  Ada {uncategorizedCount} pengeluaran tanpa kategori ·{" "}
                  <AppLink href="/transactions?kind=expense">Ubah detail di Transactions →</AppLink>
                </>
              ) : (
                <>
                  Semua transaksi memiliki kategori ·{" "}
                  <AppLink href="/transactions?kind=expense">Lihat seluruh mutasi di Transactions →</AppLink>
                </>
              )}
            </p>
          </section>
        )}
      </div>

      {mobile && (
        <p className="insight-mobile-gatekeep" role="note">
          Tampilan mobile diringkas agar tetap rapi. Buka di layar desktop untuk melihat rincian pola belanja harian, rasio burn rate &amp; runway, serta perbandingan sumber pemasukan.
        </p>
      )}
    </div>
  );
}
