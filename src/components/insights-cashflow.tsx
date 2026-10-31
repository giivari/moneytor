"use client";

import { useEffect, useId, useState } from "react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsExpenseItem, AnalyticsReport } from "@/lib/analytics/types";
import {
  compactAxisMoney,
  dayLabel,
  inclusiveEndDay,
  insightsCurrency,
  originLabel,
  percentageLabel,
  plotPercent,
  signedMoney,
} from "@/lib/analytics/presentation";
import { incomeShares, visualIntervalAxis, visualTrend } from "@/lib/analytics/visuals";
import { financeRequest } from "@/lib/finance/client";
import { formatMinor } from "@/lib/finance/format";
import { FinancialAmount } from "./financial-amount";
import { useFinanceFeedback } from "./finance-feedback";
import { useFinanceOptions } from "./finance-form-hooks";
import { InlineCatalogSelect } from "./inline-catalog-select";
import { LoadingIndicator } from "./loading-indicator";
import { SectionHeading } from "./section-heading";

const weekdayNames: Record<string, string> = {
  "1": "Senin",
  "2": "Selasa",
  "3": "Rabu",
  "4": "Kamis",
  "5": "Jumat",
  "6": "Sabtu",
  "7": "Minggu",
};

function elapsedDaysInPeriod(report: AnalyticsReport): bigint {
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

function ExpenseCategoryEditor({
  items,
  currency,
  exponent,
  onSaved,
}: {
  items: AnalyticsExpenseItem[];
  currency: string;
  exponent: number;
  onSaved?: () => void;
}) {
  const { options, optionsError, retry, reload } = useFinanceOptions();
  const { notify, refresh } = useFinanceFeedback();
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    setSelected((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (!(item.id in next) && item.categoryId) next[item.id] = item.categoryId;
      }
      return next;
    });
  }, [items]);

  const categories = (options?.catalogs.transactionCategories ?? []).filter(
    (cat) => cat.isActive && cat.appliesTo === "expense",
  );

  async function saveCategory(item: AnalyticsExpenseItem) {
    const categoryId = selected[item.id] ?? "";
    if (!categoryId || savingId) return;
    setSavingId(item.id);
    setRowError((prev) => ({ ...prev, [item.id]: "" }));
    try {
      await financeRequest("replace", {
        id: item.id,
        idempotencyKey: crypto.randomUUID(),
        draft: {
          kind: "expense",
          amountMinor: item.baseAmountMinor,
          occurredAt: item.occurredAt,
          note: item.note ?? undefined,
          sourceAssetId: item.sourceAssetId,
          categoryId,
          charges: item.charges,
        },
      });
      notify("Kategori transaksi berhasil diperbarui.");
      refresh();
      onSaved?.();
    } catch (cause) {
      setRowError((prev) => ({
        ...prev,
        [item.id]: cause instanceof Error ? cause.message : "Gagal menyimpan kategori.",
      }));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <ul className="insight-uncategorized-list">
      {items.map((item) => {
        const currentVal = selected[item.id] ?? item.categoryId ?? "";
        const changed = Boolean(currentVal) && currentVal !== (item.categoryId ?? "");
        const dateLabel = new Date(item.occurredAt).toLocaleDateString("id-ID", {
          timeZone: "Asia/Jakarta",
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        return (
          <li key={item.id} className="insight-uncategorized-item">
            <div className="insight-uncategorized-meta">
              <div className="insight-uncategorized-title">
                <strong>{item.note?.trim() || "Pengeluaran"}</strong>
                <FinancialAmount
                  as="span"
                  value={formatMinor(item.spendingMinor, currency, exponent)}
                  className="insight-money insight-negative"
                />
              </div>
              <small>
                {item.sourceName} · {originLabel(item.origin)} · {dateLabel}
                {item.categoryName ? ` · Kategori saat ini: ${item.categoryName}` : " · Belum berkategori"}
              </small>
            </div>
            {options ? (
              <div className="insight-uncategorized-actions">
                <InlineCatalogSelect
                  label="Pilih kategori"
                  catalog="transactionCategories"
                  appliesTo="expense"
                  value={currentVal}
                  onChange={(val) => setSelected((prev) => ({ ...prev, [item.id]: val }))}
                  items={categories}
                  emptyLabel="Pilih kategori pengeluaran…"
                  disabled={savingId !== null}
                  onCreated={() => reload()}
                />
                <button
                  type="button"
                  className="button-primary"
                  disabled={!changed || savingId !== null}
                  onClick={() => void saveCategory(item)}
                >
                  {savingId === item.id ? <LoadingIndicator>Menyimpan…</LoadingIndicator> : "Simpan kategori"}
                </button>
              </div>
            ) : optionsError ? (
              <div className="insight-uncategorized-actions">
                <span className="finance-error">{optionsError}</span>
                <button type="button" className="finance-secondary" onClick={retry}>
                  Muat ulang daftar kategori
                </button>
              </div>
            ) : (
              <p className="insight-note">Menyiapkan daftar kategori…</p>
            )}
            {rowError[item.id] && (
              <p className="finance-error" role="alert">
                {rowError[item.id]}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function InsightsFinancialSuite({
  report,
  currency,
  exponent,
  granularity = "auto",
  onRefreshReport,
}: {
  report: AnalyticsReport;
  currency: string;
  exponent: number;
  granularity?: AnalyticsGranularity;
  onRefreshReport?: () => void;
}) {
  const chartId = useId();
  const data = insightsCurrency(report, currency);
  const summary = data.summary;
  if (!summary) return null;

  const money = (val: string | bigint) => formatMinor(val, currency, exponent);

  // 1. Audit Tanpa Kategori
  const uncategorizedRow = data.categories.rows.find((row) => row.id === null || row.key === "uncategorized");
  const uncategorizedMinor = BigInt(uncategorizedRow?.spendingMinor ?? "0");
  const uncategorizedItems = data.expenseItems.filter((item) => item.categoryId === null);
  const categorizedItems = data.expenseItems.filter((item) => item.categoryId !== null);
  const transferFeesMinor = BigInt(summary.transferFeesMinor);

  // 2. Cash Flow Calculation (Operational P3 + Investment P4)
  const opIncome = BigInt(summary.incomeMinor);
  const opSpending = BigInt(summary.spendingMinor);
  const expPrincipal = BigInt(summary.expensePrincipalMinor);
  const totalCharges = BigInt(summary.chargesMinor);
  const invBuy = BigInt(data.flows?.purchasePrincipalMinor ?? "0");
  const invSell = BigInt(data.flows?.saleProceedsMinor ?? "0");
  const invFees = BigInt(data.flows?.feesMinor ?? "0");
  const totalInflow = opIncome + invSell;
  const totalOutflow = opSpending + invBuy + invFees;
  const netCashFlow = totalInflow - totalOutflow;

  // Cash Flow Cumulative Trend across selected granularity
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
  const yZero = 104;
  const halfSpan = 68;
  const stepX = (svgWidth - 80) / Math.max(1, cashSeries.length);
  const polylinePoints = cashSeries
    .map((item, idx) => {
      const cx = 68 + stepX * (idx + 0.5);
      const ratio = maxAbsFlow > 0n ? Number((item.cumulativeBig * 1000n) / maxAbsFlow) / 1000 : 0;
      const cy = Math.round((yZero - ratio * halfSpan) * 10) / 10;
      return `${cx},${cy}`;
    })
    .join(" ");

  // Cash Flow Bridge Bars
  const bridgeDenominator = totalInflow > totalOutflow ? totalInflow : totalOutflow;
  const bridgeRows = [
    { key: " inflow", label: "Kas masuk (Income + pencairan investasi)", amount: totalInflow, tone: "positive" },
    { key: "principal", label: "Pokok belanja konsumsi (Expense)", amount: expPrincipal, tone: "negative" },
    { key: "charges", label: "Biaya layanan, admin transfer & pajak", amount: totalCharges, tone: "negative" },
    ...(invBuy + invFees > 0n
      ? [{ key: "invest", label: "Alokasi beli & biaya investasi", amount: invBuy + invFees, tone: "neutral" }]
      : []),
    {
      key: "surplus",
      label: netCashFlow >= 0n ? "Surplus kas bersih tersimpan" : "Defisit kas (ditutup saldo awal)",
      amount: netCashFlow >= 0n ? netCashFlow : -netCashFlow,
      tone: netCashFlow >= 0n ? "positive" : "negative",
    },
  ];

  // 3. Financial Health Ratios & Burn Rate
  const daysElapsed = elapsedDaysInPeriod(report);
  const dailyBurnMinor = opSpending / daysElapsed;
  const projectedMonthlyBurn = dailyBurnMinor * 30n;
  const savingsRateBps = opIncome > 0n ? (((opIncome - opSpending) * 10000n) / opIncome).toString() : null;
  const expenseRatioBps = opIncome > 0n ? ((opSpending * 10000n) / opIncome).toString() : null;
  const expenseCount = BigInt(summary.expenseCount);
  const avgExpenseMinor =
    expenseCount > 0n ? (opSpending - transferFeesMinor) / expenseCount : 0n;

  const liquidMinor = data.assets ? BigInt(data.assets.liquidMinor) : null;
  const totalAssetsMinor = data.assets ? BigInt(data.assets.totalMinor) : null;
  const creditDebtMinor =
    data.assets && "creditDebtMinor" in data.assets && typeof data.assets.creditDebtMinor === "string"
      ? BigInt(data.assets.creditDebtMinor)
      : 0n;
  const netWorthMinor = totalAssetsMinor !== null ? totalAssetsMinor - creditDebtMinor : null;
  const runwayDays =
    liquidMinor !== null && liquidMinor > 0n && dailyBurnMinor > 0n ? liquidMinor / dailyBurnMinor : null;

  // 4. Income Sources & Weekday Spending Pattern
  const incomeBreakdown = incomeShares(data.incomeCategories).rows.sort((a, b) =>
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
      ? "per hari"
      : trendData.granularity === "week"
        ? "per minggu"
        : trendData.granularity === "year"
          ? "per tahun"
          : "per bulan";

  return (
    <div className="insight-suite">
      {uncategorizedMinor > 0n && uncategorizedItems.length > 0 && (
        <section className="surface insight-panel insight-uncategorized-panel" aria-label="Transaksi tanpa kategori">
          <SectionHeading
            eyebrow="AUDIT KATEGORI PENGELUARAN"
            title={`Transaksi belum berkategori (${uncategorizedItems.length})`}
            helper={`Total ${money(uncategorizedMinor)} berasal murni dari transaksi Pengeluaran (Expense) yang belum memiliki kategori. Pokok maupun biaya Transfer tidak pernah dimasukkan ke Komposisi belanja${transferFeesMinor > 0n ? ` (biaya transfer ${money(transferFeesMinor)} dihitung terpisah)` : ""}.`}
          />
          <ExpenseCategoryEditor
            items={uncategorizedItems}
            currency={currency}
            exponent={exponent}
            onSaved={onRefreshReport}
          />
        </section>
      )}

      <section className="surface insight-panel insight-cashflow-section" aria-label="Analisis arus kas">
        <SectionHeading
          eyebrow="ARUS KAS MENYELURUH"
          title="Analisis Cash Flow & Akumulasi Kas"
          helper={`Menggabungkan arus kas operasional dan investasi (${granularityLabel}). Transfer antar akun dilaporkan terpisah karena tidak mengubah total kas.`}
        />
        <div className="insight-cashflow-kpis">
          <div className="insight-cashflow-kpi">
            <span>Arus kas masuk (Inflow)</span>
            <strong className="insight-positive">
              <FinancialAmount as="span" value={money(totalInflow)} className="insight-money" />
            </strong>
            <small>
              Income {money(opIncome)}
              {invSell > 0n ? ` + Jual investasi ${money(invSell)}` : ""}
            </small>
          </div>
          <div className="insight-cashflow-kpi">
            <span>Arus kas keluar (Outflow)</span>
            <strong className="insight-negative">
              <FinancialAmount as="span" value={money(totalOutflow)} className="insight-money" />
            </strong>
            <small>
              Belanja {money(opSpending)}
              {invBuy + invFees > 0n ? ` + Beli investasi ${money(invBuy + invFees)}` : ""}
            </small>
          </div>
          <div className="insight-cashflow-kpi">
            <span>Arus kas bersih (Net Cash Flow)</span>
            <strong className={netCashFlow < 0n ? "insight-negative" : "insight-positive"}>
              <FinancialAmount
                as="span"
                value={signedMoney(netCashFlow.toString(), currency, exponent)}
                className="insight-money"
              />
            </strong>
            <small>{netCashFlow >= 0n ? "Surplus kas bersih periode ini" : "Defisit kas bersih periode ini"}</small>
          </div>
          <div className="insight-cashflow-kpi">
            <span>Mutasi Transfer internal</span>
            <strong>
              <FinancialAmount as="span" value={money(summary.transferPrincipalMinor)} className="insight-money" />
            </strong>
            <small>{summary.transferCount} perpindahan antar akun sendiri</small>
          </div>
        </div>

        {cashSeries.length > 0 && (
          <div className="insight-cashflow-chart-wrap">
            <div className="insight-legend">
              <span>
                <i className="insight-income-dot" />
                Surplus interval
              </span>
              <span>
                <i className="insight-spending-dot" />
                Defisit interval
              </span>
              <span>
                <i className="insight-cumulative-dot" />
                Saldo kas kumulatif
              </span>
            </div>
            <svg
              className="insight-fit-chart insight-cashflow-svg"
              viewBox={`0 0 ${svgWidth} 214`}
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
                    <text x={cx} y={yZero + halfSpan + 24} textAnchor="middle" className="insight-axis">
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

        {bridgeDenominator > 0n && (
          <div className="insight-bridge-block">
            <h3>Alokasi & daya serap arus kas</h3>
            <ul className="insight-bridge-bars">
              {bridgeRows.map((row) => (
                <li key={row.key}>
                  <div className="insight-bridge-head">
                    <span>{row.label}</span>
                    <FinancialAmount
                      as="span"
                      value={money(row.amount)}
                      className={`insight-money ${row.tone === "positive" ? "insight-positive" : row.tone === "negative" ? "insight-negative" : ""}`}
                    />
                  </div>
                  <div className="insight-category-track" aria-hidden="true">
                    <span
                      data-tone={row.tone}
                      style={{ width: `${plotPercent(row.amount, bridgeDenominator)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="surface insight-panel insight-health-section" aria-label="Indikator kesehatan keuangan">
        <SectionHeading
          eyebrow="INDIKATOR KESEHATAN KEUANGAN"
          title="Rasio Finansial, Burn Rate & Ketahanan Dana"
          helper={`Dihitung dari ${daysElapsed.toString()} hari efektif (${dayLabel(report.period.startDay)} – ${dayLabel(inclusiveEndDay(report.period.endDayExclusive))}) dan posisi saldo terkini.`}
        />
        <div className="insight-health-grid">
          <div className="insight-health-card">
            <span>Rasio Tabungan (Savings Rate)</span>
            <strong
              className={
                savingsRateBps === null
                  ? ""
                  : BigInt(savingsRateBps) < 0n
                    ? "insight-negative"
                    : "insight-positive"
              }
            >
              {percentageLabel(savingsRateBps, true)}
            </strong>
            <small>
              {savingsRateBps === null
                ? "Belum ada pemasukan tercatat pada periode ini."
                : BigInt(savingsRateBps) >= 2000n
                  ? "Sehat (≥ 20% pemasukan berhasil dipertahankan)."
                  : BigInt(savingsRateBps) >= 0n
                    ? "Positif namun tipis (< 20% dari pemasukan)."
                    : "Belanja melampaui pemasukan periode ini."}
            </small>
          </div>

          <div className="insight-health-card">
            <span>Rasio Belanja thd Pemasukan</span>
            <strong>{percentageLabel(expenseRatioBps)}</strong>
            <small>
              {expenseRatioBps === null
                ? "Membutuhkan pemasukan > 0 sebagai pembanding."
                : "Porsi pemasukan yang terpakai untuk konsumsi & biaya."}
            </small>
          </div>

          <div className="insight-health-card">
            <span>Burn Rate Harian</span>
            <strong>
              <FinancialAmount as="span" value={money(dailyBurnMinor)} className="insight-money" />
            </strong>
            <small>
              Proyeksi 30 hari: <FinancialAmount as="span" value={money(projectedMonthlyBurn)} />
            </small>
          </div>

          <div className="insight-health-card">
            <span>Rata-rata per Pengeluaran</span>
            <strong>
              <FinancialAmount
                as="span"
                value={expenseCount > 0n ? money(avgExpenseMinor) : "—"}
                className="insight-money"
              />
            </strong>
            <small>{summary.expenseCount} transaksi Expense tercatat pada periode ini.</small>
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
              {liquidMinor !== null
                ? `Berdasarkan dana likuid saat ini ${money(liquidMinor)}.`
                : "Konteks saldo likuid belum tersedia."}
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
                  ? `Aset ${money(totalAssetsMinor)} − tagihan kredit ${money(creditDebtMinor)}.`
                  : `Total aset diketahui ${money(totalAssetsMinor)} tanpa tagihan kredit.`
                : "Snapshot aset belum tersedia."}
            </small>
          </div>
        </div>
      </section>

      <div className="insight-subgrid">
        <section className="surface insight-panel" aria-label="Sumber pemasukan">
          <SectionHeading
            title="Sumber pemasukan"
            helper="Distribusi pemasukan berdasarkan kategori Income."
          />
          {opIncome === 0n || incomeBreakdown.length === 0 ? (
            <p className="insight-empty">Belum ada pemasukan tercatat pada periode ini.</p>
          ) : (
            <ul className="insight-visual-ranking">
              {incomeBreakdown
                .filter((row) => BigInt(row.incomeMinor) > 0n)
                .map((row) => (
                  <li key={row.key}>
                    <span>
                      {row.name}
                      {row.archived ? " · Diarsipkan" : ""}
                      <small>{row.incomeCount} pemasukan</small>
                    </span>
                    <strong>
                      <FinancialAmount as="span" value={money(row.incomeMinor)} />
                      <small>{percentageLabel(row.shareBps)}</small>
                    </strong>
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className="surface insight-panel" aria-label="Pola pengeluaran mingguan">
          <SectionHeading
            title="Pola belanja menurut hari"
            helper={
              peakWeekday
                ? `Puncak pengeluaran terjadi pada hari ${peakWeekday.name} (${money(peakWeekday.spendingMinor)}).`
                : "Distribusi pengeluaran Senin–Minggu dalam periode terpilih."
            }
          />
          {maxWeekdaySpend === 0n ? (
            <p className="insight-empty">Belum ada pengeluaran untuk memetakan pola hari belanja.</p>
          ) : (
            <ul className="insight-bridge-bars">
              {fullWeekdays.map((day) => (
                <li key={day.key}>
                  <div className="insight-bridge-head">
                    <span>
                      {day.name} <small>({day.expenseCount}x)</small>
                    </span>
                    <FinancialAmount
                      as="span"
                      value={money(day.spendingMinor)}
                      className="insight-money"
                    />
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
        </section>
      </div>

      {categorizedItems.length > 0 && (
        <section className="surface insight-panel" aria-label="Transaksi pengeluaran terbesar">
          <details className="insight-inline-detail">
            <summary>
              <strong>Tinjau & ubah kategori transaksi pengeluaran terbesar ({categorizedItems.length})</strong>
            </summary>
            <p className="insight-note">
              Anda dapat menyesuaikan kategori transaksi langsung dari sini tanpa harus mencari manual di halaman Transactions.
            </p>
            <ExpenseCategoryEditor
              items={categorizedItems.slice(0, 15)}
              currency={currency}
              exponent={exponent}
              onSaved={onRefreshReport}
            />
          </details>
        </section>
      )}
    </div>
  );
}

