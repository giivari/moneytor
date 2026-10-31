"use client";

import { useId, useState } from "react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport } from "@/lib/analytics/types";
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

  // Credit Facilities (Kartu Kredit, PayLater, Pinjaman, KTA) & Routine Bills
  const cb = data.creditAndBills;
  const facilities = cb?.facilities ?? [];
  const creditSpend = BigInt(cb?.creditSpendingMinor ?? "0");
  const cashSpend = cb ? BigInt(cb.cashSpendingMinor) : opSpending;
  const creditRepay = BigInt(cb?.creditRepaymentMinor ?? "0");
  const currentCycleBills = BigInt(cb?.currentCycleBillsMinor ?? "0");
  const nextCycleBills = BigInt(cb?.nextCycleBillsMinor ?? "0");
  const totalCreditUnpaid = BigInt(cb?.totalCreditUnpaidMinor ?? "0");

  const autoOriginRow = data.origins.find((r) => r.key === "automation");
  const autoSpend = BigInt(cb?.automatedSpendingMinor ?? autoOriginRow?.spendingMinor ?? "0");
  const autoCount = cb?.automatedExpenseCount ?? autoOriginRow?.expenseCount ?? "0";
  const billCatSpend = BigInt(cb?.billCategorySpendingMinor ?? "0");
  const billCatCount = cb?.billCategoryCount ?? "0";
  const openObs = cb?.obligations ?? [];
  const openObsTotal = BigInt(cb?.openObligationsMinor ?? "0");
  const settledObsCount = cb?.settledInPeriodCount ?? 0;
  const settledObsTotal = BigInt(cb?.settledInPeriodMinor ?? "0");

  const hasCreditOrBillsCard =
    facilities.length > 0 ||
    openObs.length > 0 ||
    settledObsCount > 0 ||
    autoSpend > 0n ||
    billCatSpend > 0n ||
    opSpending > 0n;

  // Top Expenses (Read-only sleek m-banking ranked list)
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

  // Desktop Deep-Dive Analytics Calculations
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
                        trendData.granularity === "day"
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
            <div className="insight-tab-pane insight-subgrid">
              <div>
                <h3>Pola belanja menurut hari</h3>
                <p className="insight-note">
                  {peakWeekday
                    ? `Puncak belanja pada hari ${peakWeekday.name} (${money(peakWeekday.spendingMinor)}).`
                    : "Distribusi pengeluaran Senin–Minggu."}
                </p>
                {maxWeekdaySpend === 0n ? (
                  <p className="insight-empty">Belum ada pengeluaran pada periode ini.</p>
                ) : (
                  <ul className="insight-bridge-bars" style={{ marginTop: 12 }}>
                    {fullWeekdays.map((day) => (
                      <li key={day.key}>
                        <div className="insight-bridge-head">
                          <span>
                            {day.name} <small>({day.expenseCount}x)</small>
                          </span>
                          <FinancialAmount as="span" value={money(day.spendingMinor)} className="insight-money" />
                        </div>
                        <div className="insight-category-track" aria-hidden="true">
                          <span
                            data-tone={peakWeekday?.key === day.key ? "negative" : "neutral"}
                            style={{ width: `${plotPercent(day.spendingMinor, maxWeekdaySpend)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3>Sumber pemasukan</h3>
                <p className="insight-note">Distribusi pemasukan berdasarkan kategori.</p>
                {opIncome === 0n || incomeBreakdown.length === 0 ? (
                  <p className="insight-empty">Belum ada pemasukan tercatat pada periode ini.</p>
                ) : (
                  <ul className="insight-visual-ranking">
                    {incomeBreakdown.map((row) => (
                      <li key={row.key}>
                        <span>
                          {row.name}
                          {row.archived ? " · Diarsipkan" : ""}
                          <small>{row.incomeCount}x pemasukan</small>
                        </span>
                        <strong>
                          <FinancialAmount as="span" value={money(row.incomeMinor)} />
                          <small>{percentageLabel(row.shareBps)}</small>
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === "ratios" && (
            <div className="insight-tab-pane">
              <div className="insight-health-grid">
                <div className="insight-health-card">
                  <span>Rasio Tabungan (Savings Rate)</span>
                  <strong
                    className={
                      savingsRateBps === null ? "" : BigInt(savingsRateBps) < 0n ? "insight-negative" : "insight-positive"
                    }
                  >
                    {percentageLabel(savingsRateBps, true)}
                  </strong>
                  <small>
                    {savingsRateBps === null
                      ? "Belum ada pemasukan periode ini"
                      : BigInt(savingsRateBps) >= 2000n
                        ? "Sehat (≥ 20% pemasukan tersimpan)"
                        : BigInt(savingsRateBps) >= 0n
                          ? "Positif (< 20% dari pemasukan)"
                          : "Pengeluaran melampaui pemasukan"}
                  </small>
                </div>

                <div className="insight-health-card">
                  <span>Rasio Belanja thd Pemasukan</span>
                  <strong>{percentageLabel(expenseRatioBps)}</strong>
                  <small>Porsi pemasukan yang terpakai</small>
                </div>

                <div className="insight-health-card">
                  <span>Burn Rate Harian ({daysElapsed.toString()} hr)</span>
                  <strong>
                    <FinancialAmount as="span" value={money(dailyBurnMinor)} className="insight-money" />
                  </strong>
                  <small>
                    Estimasi 30 hari: <FinancialAmount as="span" value={money(projectedMonthlyBurn)} />
                  </small>
                </div>

                <div className="insight-health-card">
                  <span>Rata-rata per Transaksi Belanja</span>
                  <strong>
                    <FinancialAmount
                      as="span"
                      value={expenseCount > 0n ? money(avgExpenseMinor) : "—"}
                      className="insight-money"
                    />
                  </strong>
                  <small>{summary.expenseCount} transaksi pengeluaran</small>
                </div>

                <div className="insight-health-card">
                  <span>Ketahanan Dana Likuid (Runway)</span>
                  <strong>
                    {runwayDays !== null
                      ? runwayDays >= 60n
                        ? `${(runwayDays / 30n).toString()} bln ${(runwayDays % 30n).toString()} hr`
                        : `${runwayDays.toString()} hari`
                      : liquidMinor !== null && dailyBurnMinor === 0n && liquidMinor > 0n
                        ? "Stabil"
                        : "—"}
                  </strong>
                  <small>
                    {liquidMinor !== null ? `Dari dana likuid ${money(liquidMinor)}` : "Data saldo likuid belum tersedia"}
                  </small>
                </div>

                <div className="insight-health-card">
                  <span>Kekayaan Bersih Diketahui</span>
                  <strong className={netWorthMinor !== null && netWorthMinor < 0n ? "insight-negative" : ""}>
                    {netWorthMinor !== null ? (
                      <FinancialAmount as="span" value={money(netWorthMinor)} className="insight-money" />
                    ) : (
                      "—"
                    )}
                  </strong>
                  <small>
                    {totalAssetsMinor !== null
                      ? creditDebtMinor > 0n
                        ? `Aset ${money(totalAssetsMinor)} − kewajiban kredit ${money(creditDebtMinor)}`
                        : `Total aset ${money(totalAssetsMinor)}`
                      : "Snapshot aset belum tersedia"}
                  </small>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="insight-mid-grid">
        {hasCreditOrBillsCard && (
          <section className="surface insight-panel insight-credit-bills-card" aria-label="Kredit dan Tagihan">
            <SectionHeading
              title="Kredit & Tagihan"
              helper="Pemakaian fasilitas kredit, pelunasan, dan kewajiban jatuh tempo."
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

            {facilities.length > 1 && (
              <div className="insight-multi-credit-summary">
                <div>
                  <span>Total {facilities.length} fasilitas kredit</span>
                  <strong className={totalCreditUnpaid > 0n ? "insight-negative" : ""}>
                    <FinancialAmount as="span" value={money(totalCreditUnpaid)} className="insight-money" />
                  </strong>
                </div>
                <div>
                  <span>Jatuh tempo terdekat</span>
                  <strong className={currentCycleBills > 0n ? "insight-negative" : "insight-positive"}>
                    {currentCycleBills > 0n ? (
                      <FinancialAmount as="span" value={money(currentCycleBills)} className="insight-money" />
                    ) : (
                      "Lunas"
                    )}
                  </strong>
                </div>
              </div>
            )}

            {facilities.length > 0 && (
              <div className="insight-credit-facilities">
                {facilities.map((fac) => {
                  const curBill = BigInt(fac.currentBillMinor);
                  const nextBill = BigInt(fac.nextBillMinor);
                  const unpaid = BigInt(fac.totalUnpaidMinor);
                  const limit = BigInt(fac.limitMinor);
                  const usedPct = limit > 0n ? plotPercent(unpaid, limit) : 0;
                  return (
                    <div key={fac.id} className="insight-facility-box">
                      <div className="insight-facility-head">
                        <strong>
                          {fac.name}
                          {!fac.isActive && <small> · Diarsipkan</small>}
                        </strong>
                        {fac.availableLimitMinor !== null && limit > 0n && (
                          <span>Sisa limit {money(fac.availableLimitMinor)}</span>
                        )}
                      </div>
                      {limit > 0n && (
                        <div className="insight-category-track" aria-hidden="true">
                          <span
                            data-tone={usedPct >= 75 ? "negative" : "neutral"}
                            style={{ width: `${usedPct}%` }}
                          />
                        </div>
                      )}
                      <dl className="insight-facility-bills">
                        <div>
                          <dt>Tagihan {formatShortDueIso(fac.currentDueIso)}</dt>
                          <dd className={curBill > 0n ? "insight-negative" : "insight-positive"}>
                            {curBill > 0n ? <FinancialAmount as="span" value={money(curBill)} /> : "Lunas"}
                          </dd>
                        </div>
                        <div>
                          <dt>Periode {formatShortDueIso(fac.nextDueIso)}</dt>
                          <dd>
                            <FinancialAmount as="span" value={money(nextBill)} />
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}

            {(autoSpend > 0n ||
              billCatSpend > 0n ||
              openObs.length > 0 ||
              currentCycleBills > 0n ||
              nextCycleBills > 0n ||
              settledObsCount > 0) && (
              <dl className="insight-bill-summary-rows">
                {autoSpend > 0n && (
                  <div>
                    <dt>Pengeluaran rutin / terjadwal</dt>
                    <dd>
                      <FinancialAmount as="span" value={money(autoSpend)} />
                      {BigInt(autoCount) > 0n && <small> · {autoCount}x</small>}
                    </dd>
                  </div>
                )}
                {billCatSpend > 0n && (
                  <div>
                    <dt>Kategori tagihan &amp; utilitas</dt>
                    <dd>
                      <FinancialAmount as="span" value={money(billCatSpend)} />
                      <small> · {billCatCount}x</small>
                    </dd>
                  </div>
                )}
                {(openObs.length > 0 || currentCycleBills > 0n || nextCycleBills > 0n) && (
                  <div>
                    <dt>Total kewajiban &amp; tagihan aktif</dt>
                    <dd className="insight-negative">
                      <FinancialAmount as="span" value={money(totalCreditUnpaid + openObsTotal)} />
                    </dd>
                  </div>
                )}
                {settledObsCount > 0 && (
                  <div>
                    <dt>Kewajiban Planning dilunasi</dt>
                    <dd className="insight-positive">
                      <FinancialAmount as="span" value={money(settledObsTotal)} />
                      <small> · {settledObsCount} selesai</small>
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {openObs.length > 0 && (
              <ul className="insight-mini-obligations">
                {openObs.slice(0, 3).map((ob) => (
                  <li key={ob.id}>
                    <span>
                      <strong>{ob.title}</strong>
                      <small>
                        {ob.labelName} · Jatuh tempo {dayLabel(ob.dueOn)}
                      </small>
                    </span>
                    <FinancialAmount as="span" value={money(ob.amountMinor)} className="insight-money" />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {visibleTopExpenses.length > 0 && (
          <section className="surface insight-panel insight-top-expenses-card" aria-label="Pengeluaran terbesar">
            <SectionHeading
              title="Pengeluaran terbesar"
              helper={`Urutan transaksi pengeluaran tertinggi pada periode ini (${sortedExpenses.length} transaksi).`}
            />
            <ol className="insight-top-list">
              {visibleTopExpenses.map((item, idx) => {
                const shortDate = new Date(item.occurredAt).toLocaleDateString("id-ID", {
                  timeZone: "Asia/Jakarta",
                  day: "numeric",
                  month: "short",
                });
                return (
                  <li key={item.id} className="insight-top-row">
                    <span className="insight-top-rank">{idx + 1}</span>
                    <div className="insight-top-info">
                      <strong>
                        {item.note?.trim() || item.categoryName || "Pengeluaran"}
                        {item.isCreditSource && <em className="insight-credit-chip">Kredit</em>}
                      </strong>
                      <small>
                        {item.categoryName ?? "Tanpa kategori"} · {item.sourceName} · {shortDate}
                      </small>
                    </div>
                    <FinancialAmount
                      as="span"
                      value={money(item.spendingMinor)}
                      className="insight-top-amount insight-negative"
                    />
                  </li>
                );
              })}
            </ol>

            {extraTopExpenses.length > 0 && (
              <details className="insight-inline-detail">
                <summary>
                  Lihat urutan {topLimit + 1}–{topLimit + extraTopExpenses.length}
                </summary>
                <ol className="insight-top-list" start={topLimit + 1}>
                  {extraTopExpenses.map((item, idx) => {
                    const shortDate = new Date(item.occurredAt).toLocaleDateString("id-ID", {
                      timeZone: "Asia/Jakarta",
                      day: "numeric",
                      month: "short",
                    });
                    return (
                      <li key={item.id} className="insight-top-row">
                        <span className="insight-top-rank">{topLimit + idx + 1}</span>
                        <div className="insight-top-info">
                          <strong>
                            {item.note?.trim() || item.categoryName || "Pengeluaran"}
                            {item.isCreditSource && <em className="insight-credit-chip">Kredit</em>}
                          </strong>
                          <small>
                            {item.categoryName ?? "Tanpa kategori"} · {item.sourceName} · {shortDate}
                          </small>
                        </div>
                        <FinancialAmount
                          as="span"
                          value={money(item.spendingMinor)}
                          className="insight-top-amount insight-negative"
                        />
                      </li>
                    );
                  })}
                </ol>
              </details>
            )}

            {uncategorizedCount > 0 && (
              <p className="insight-note insight-top-footer">
                Ada {uncategorizedCount} pengeluaran tanpa kategori ·{" "}
                <AppLink href="/transactions?kind=expense">Ubah detail di Transactions →</AppLink>
              </p>
            )}
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
