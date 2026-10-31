import type { ReactNode } from "react";
import type { AnalyticsGranularity } from "@/lib/analytics/periods";
import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import { dayLabel, insightsCurrency, originLabel, percentageLabel, periodLabel, signedMoney } from "@/lib/analytics/presentation";
import { formatMinor } from "@/lib/finance/format";
import type { InsightsMonthSelection } from "./use-insights-month";
import type { InsightsSlideSelection } from "./insights-carousel";
import { InsightsCostBars } from "./insights-visuals";
import { InsightsPrimary } from "./insights-primary";
import { InsightsSecondary } from "./insights-secondary";
import { elapsedDaysInPeriod, InsightsFinancialSuite } from "./insights-cashflow";
import { FinancialAmount } from "./financial-amount";
import { SectionHeading } from "./section-heading";

function Money({
  value,
  currency,
  exponent,
  className = "",
  suffix = "",
}: {
  value: string;
  currency: string;
  exponent: number;
  className?: string;
  suffix?: string;
}) {
  const text = formatMinor(value, currency, exponent) + suffix;
  return <FinancialAmount value={text} as="span" className={`insight-money ${className}`} />;
}

function Lines({ children }: { children: ReactNode }) {
  return <dl className="insight-lines">{children}</dl>;
}

function Dimensions({ rows }: { rows: DimensionRow[] }) {
  if (!rows.length) return <p className="insight-note">Belum ada aktivitas tercatat pada periode ini.</p>;
  return (
    <ul className="insight-dimensions">
      {rows.map((row) => {
        const inc = BigInt(row.incomeMinor);
        const trfIn = BigInt(row.transferInMinor ?? "0");
        const exp = BigInt(row.spendingMinor);
        const trfOut = BigInt(row.transferPrincipalMinor);
        const netMutation = inc + trfIn - exp - trfOut;
        return (
          <li key={row.key}>
            <div className="insight-dimension-heading">
              <strong>
                {row.name}
                {row.archived && <small> · Diarsipkan</small>}
              </strong>
              <span>
                <em
                  className={`insight-account-net ${netMutation < 0n ? "insight-negative" : netMutation > 0n ? "insight-positive" : ""}`}
                >
                  Mutasi {signedMoney(netMutation.toString(), row.currency, row.exponent)} ·{" "}
                </em>
                {row.activityCount} transaksi
              </span>
            </div>
            <dl className="insight-small-values insight-account-values">
              <div>
                <dt>Pemasukan</dt>
                <dd className={inc === 0n ? "insight-zero-muted" : "insight-positive"}>
                  <Money value={row.incomeMinor} currency={row.currency} exponent={row.exponent} />
                </dd>
              </div>
              <div>
                <dt>Transfer masuk</dt>
                <dd className={trfIn === 0n ? "insight-zero-muted" : "insight-positive"}>
                  <Money value={row.transferInMinor ?? "0"} currency={row.currency} exponent={row.exponent} />
                </dd>
              </div>
              <div>
                <dt>Belanja &amp; biaya</dt>
                <dd className={exp === 0n ? "insight-zero-muted" : "insight-negative"}>
                  <Money value={row.spendingMinor} currency={row.currency} exponent={row.exponent} />
                </dd>
              </div>
              <div>
                <dt>Transfer keluar</dt>
                <dd className={trfOut === 0n ? "insight-zero-muted" : ""}>
                  <Money value={row.transferPrincipalMinor} currency={row.currency} exponent={row.exponent} />
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

export function InsightsReportView({
  report,
  currency,
  periodKind = "current_month",
  granularity = "auto",
  monthSelection,
  slideSelection = { index: 0, select: () => {} },
}: {
  report: AnalyticsReport;
  currency: string;
  periodKind?: string;
  granularity?: AnalyticsGranularity;
  monthSelection?: InsightsMonthSelection;
  slideSelection?: InsightsSlideSelection;
}) {
  const data = insightsCurrency(report, currency);
  const summary = data.summary;
  if (!summary) {
    return (
      <div className="surface insight-state" role="status">
        Belum ada akun atau portofolio dengan mata uang yang dapat dilaporkan.
      </div>
    );
  }
  const money = (value: string, className = "") => (
    <Money value={value} currency={currency} exponent={summary.exponent} className={className} />
  );
  const line = (label: string, value: string) => (
    <div key={label}>
      <dt>{label}</dt>
      <dd>
        {money(
          value,
          BigInt(value) < 0n ? "insight-negative" : label.startsWith("P/L") && BigInt(value) > 0n ? "insight-positive" : "",
        )}
      </dd>
    </div>
  );

  const opIncome = BigInt(summary.incomeMinor);
  const opSpending = BigInt(summary.spendingMinor);
  const savingsRateBps = opIncome > 0n ? (((opIncome - opSpending) * 10000n) / opIncome).toString() : null;
  const daysElapsed = elapsedDaysInPeriod(report);
  const dailyBurnMinor = (opSpending / daysElapsed).toString();
  const hasTrades = Boolean(data.flows && BigInt(data.flows.tradeCount) > 0n);

  return (
    <div className="insight-report">
      <div className="insight-period-heading">
        <div>
          <strong>{periodLabel(report.period)}</strong>
          <span>{currency} · Kalender Asia/Jakarta</span>
        </div>
        <small>
          Dibaca{" "}
          {new Intl.DateTimeFormat("id-ID", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "Asia/Jakarta",
          }).format(new Date(report.generatedAt))}{" "}
          WIB
        </small>
      </div>
      {!!(data.assets?.unpricedCount || data.investment?.unpricedCount) && (
        <p className="insight-warning" role="note">
          Ada posisi investasi tanpa harga. Total aset diketahui dan nilai pasar belum mencakup semuanya; rincian ada di Posisi aset &amp; investasi.
        </p>
      )}
      {report.context && !report.context.planningReady && (
        <p className="insight-warning" role="note">
          Planning belum tersedia; konteks kewajiban belum lengkap.
        </p>
      )}

      <section className="surface insight-panel insight-overview" aria-label="Ringkasan keuangan">
        <div className="insight-main-metrics">
          {(
            [
              ["Pemasukan", "incomeMinor", "income", "positive"],
              ["Total belanja", "spendingMinor", "spending", "negative"],
              ["Net operasional", "netMinor", "net", BigInt(summary.netMinor) < 0n ? "negative" : "positive"],
            ] as const
          ).map(([label, valueKey, compareKey, tone]) => {
            const comparison = data.comparison?.[compareKey];
            return (
              <div className="insight-main-metric" key={valueKey}>
                <span>{label}</span>
                <strong>{money(summary[valueKey], `insight-${tone}`)}</strong>
                <small>
                  {comparison ? (
                    <>
                      {signedMoney(comparison.differenceMinor, currency, summary.exponent)}{" "}
                      <span>({percentageLabel(comparison.percentageChangeBps, true)})</span>
                    </>
                  ) : (
                    "—"
                  )}
                  <span className="insight-comparison-label"> · vs periode lalu</span>
                </small>
              </div>
            );
          })}
          <div className="insight-main-metric">
            <span>{savingsRateBps !== null ? "Rasio tabungan" : "Rata-rata harian"}</span>
            <strong
              className={
                savingsRateBps === null
                  ? ""
                  : BigInt(savingsRateBps) < 0n
                    ? "insight-negative"
                    : "insight-positive"
              }
            >
              {savingsRateBps !== null ? percentageLabel(savingsRateBps, true) : money(dailyBurnMinor)}
            </strong>
            <small>
              {savingsRateBps !== null ? (
                <>
                  Belanja rata-rata {formatMinor(dailyBurnMinor, currency, summary.exponent)}/hari
                </>
              ) : (
                <>
                  {summary.expenseCount}x pengeluaran dalam {daysElapsed.toString()} hari
                </>
              )}
            </small>
          </div>
        </div>

        <div className="insight-overview-foot">
          <details className="insight-inline-detail insight-summary-detail">
            <summary>Rincian komponen &amp; perbandingan</summary>
            <dl className="insight-support-metrics">
              {line("Pokok pengeluaran", summary.expensePrincipalMinor)}
              {line("Biaya layanan & Transfer", summary.feesMinor)}
              {line("Pajak", summary.taxesMinor)}
              {line("Biaya lainnya", summary.otherChargesMinor)}
            </dl>
            <dl className="insight-comparison-details">
              {(
                [
                  ["Pemasukan", "income"],
                  ["Belanja", "spending"],
                  ["Net operasional", "net"],
                ] as const
              ).map(([label, key]) => (
                <div key={key}>
                  <dt>Selisih {label}</dt>
                  <dd>
                    {data.comparison
                      ? `${signedMoney(data.comparison[key].differenceMinor, currency, summary.exponent)} (${percentageLabel(data.comparison[key].percentageChangeBps, true)})`
                      : "—"}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="insight-note">
              Pembanding: {periodLabel(report.comparison.period)}.{" "}
              {["custom", "last_7_days", "last_30_days"].includes(periodKind)
                ? "Interval sebelumnya dengan jumlah hari yang sama."
                : "Blok kalender sebelumnya secara penuh."}{" "}
              Persentase — berarti basis tidak positif atau tidak dapat dibandingkan.
            </p>
            <p className="insight-note">
              Net = pemasukan − belanja, bukan pertumbuhan total aset. Pokok Transfer antar akun sendiri tidak dihitung sebagai pemasukan atau belanja.
            </p>
            <p className="insight-note insight-activity-meta">
              <span>
                {summary.activityCount} transaksi tercatat: {summary.incomeCount} Pemasukan · {summary.expenseCount} Pengeluaran ·{" "}
                {summary.transferCount} Transfer.
              </span>
              <span className="insight-transfer-meta">
                Transfer: <Money value={summary.transferPrincipalMinor} currency={currency} exponent={summary.exponent} suffix="." />
              </span>
            </p>
            {data.origins.length > 0 && (
              <p className="insight-note">
                Sumber pencatatan belanja:{" "}
                {data.origins
                  .map((r) => `${originLabel(r.key)} ${formatMinor(r.spendingMinor, currency, summary.exponent)}`)
                  .join(" · ")}
                . Setiap transaksi dihitung sekali; proposal dan tinjauan otomatisasi yang belum dikonfirmasi tidak dihitung sebagai pergerakan uang.
              </p>
            )}
          </details>
          {(report.period.partial || report.comparison.partialComparison) && (
            <span className="insight-live-pill" role="note">
              <i className="insight-status-dot" aria-hidden="true" />
              {report.period.partial ? "Periode berjalan" : "Pembanding parsial"}
            </span>
          )}
        </div>
        {summary.activityCount === "0" && (
          <p className="insight-empty">
            Belum ada transaksi tercatat pada periode ini. Konteks aset dan investasi tetap ditampilkan jika tersedia.
          </p>
        )}
      </section>

      <InsightsPrimary
        report={report}
        currency={currency}
        exponent={summary.exponent}
        selection={monthSelection}
        slides={slideSelection}
        categories={data.categories.rows}
        charges={data.charges}
        granularity={granularity}
      />

      <InsightsFinancialSuite report={report} currency={currency} exponent={summary.exponent} granularity={granularity} />

      <InsightsSecondary
        items={[
          {
            key: "accounts",
            title: "Aktivitas menurut akun",
            summary: `${data.accounts.length} akun · Pemasukan, Transfer masuk/keluar & Belanja`,
            action: "Rincian mutasi akun",
            content: (
              <>
                <SectionHeading
                  title="Aktivitas menurut akun"
                  helper="Belanja per akun pembayar · Mutasi masuk & keluar lengkap ada di rincian."
                />
                <InsightsCostBars
                  currency={currency}
                  exponent={summary.exponent}
                  rows={[...data.accounts]
                    .sort((a, b) =>
                      BigInt(a.spendingMinor) === BigInt(b.spendingMinor)
                        ? a.key.localeCompare(b.key)
                        : BigInt(a.spendingMinor) > BigInt(b.spendingMinor)
                          ? -1
                          : 1,
                    )
                    .slice(0, 4)
                    .map((row) => ({
                      key: row.key,
                      label: `${row.name}${row.archived ? " · Diarsipkan" : ""}`,
                      amount: row.spendingMinor,
                    }))}
                />
                {!data.accounts.some((row) => BigInt(row.spendingMinor) > 0n) && (
                  <p className="insight-empty">
                    Belum ada belanja pada akun di periode ini. Pemasukan dan Transfer tersedia di rincian.
                  </p>
                )}
              </>
            ),
            details: (
              <>
                <p className="insight-note">
                  Rincian mutasi per akun mencakup Pemasukan, Transfer masuk, Belanja &amp; biaya, serta Transfer keluar yang tercatat pada periode ini.
                </p>
                <Dimensions rows={data.accounts} />
              </>
            ),
          },
          {
            key: "investments",
            title: "Posisi aset & investasi",
            mobileSummary: "Snapshot terkini · Likuiditas, aset & portofolio",
            summary: `${data.assets ? `Aset diketahui ${formatMinor(data.assets.totalMinor, currency, summary.exponent)} · ` : ""}Snapshot posisi terkini`,
            action: "Rincian aset & investasi",
            content: (
              <>
                <SectionHeading
                  title="Posisi aset & investasi"
                  helper="Snapshot posisi saat ini · Transaksi investasi terpisah dari pengeluaran konsumsi."
                />
                {data.assets && (
                  <dl className="insight-asset-snapshot-grid">
                    <div>
                      <dt>Total aset diketahui</dt>
                      <dd>{money(data.assets.totalMinor)}</dd>
                    </div>
                    <div>
                      <dt>Dana likuid</dt>
                      <dd>{money(data.assets.liquidMinor)}</dd>
                    </div>
                    <div>
                      <dt>Dapat digunakan</dt>
                      <dd>{money(data.assets.spendableMinor)}</dd>
                    </div>
                    <div>
                      <dt>Setelah kewajiban</dt>
                      <dd>{money(data.assets.availableMinor)}</dd>
                    </div>
                  </dl>
                )}
                {data.investment && BigInt(data.investment.marketMinor) > 0n && (
                  <p className="insight-investment-snapshot">
                    Nilai pasar investasi: {money(data.investment.marketMinor)}
                  </p>
                )}
                {hasTrades && data.flows && (
                  <InsightsCostBars
                    currency={currency}
                    exponent={summary.exponent}
                    rows={[
                      { key: "buy", label: "Pembelian investasi", amount: data.flows.purchasePrincipalMinor },
                      { key: "sell", label: "Penjualan investasi", amount: data.flows.saleProceedsMinor },
                      { key: "fee", label: "Biaya transaksi investasi", amount: data.flows.feesMinor },
                    ]}
                  />
                )}
                {!data.assets && !hasTrades && (
                  <p className="insight-empty">Belum ada posisi aset atau transaksi investasi pada mata uang ini.</p>
                )}
                {!!data.investment?.unpricedCount && (
                  <p className="insight-note">
                    {data.investment.unpricedCount} posisi investasi belum memiliki harga pasar.
                  </p>
                )}
              </>
            ),
            details: (
              <>
                <p className="insight-note">
                  Nilai berikut adalah kondisi saat laporan dibaca, bukan nilai pada akhir periode terpilih. Riwayat valuasi aset belum tersedia.
                </p>
                <p className="insight-note">
                  Snapshot dibaca{" "}
                  {new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Jakarta",
                  }).format(new Date(report.generatedAt))}{" "}
                  WIB.
                </p>
                {data.assets ? (
                  <>
                    <Lines>
                      {line("Total aset diketahui", data.assets.totalMinor)}
                      {line("Dana likuid", data.assets.liquidMinor)}
                      {line("Dapat digunakan", data.assets.spendableMinor)}
                      {line("Setelah kewajiban", data.assets.availableMinor)}
                    </Lines>
                    <p className="insight-note">
                      {report.context?.planningReady
                        ? `Setelah cadangan dan kewajiban sampai ${dayLabel(report.context.throughDay)}.`
                        : "Planning belum tersedia; konteks kewajiban belum lengkap."}
                    </p>
                    {data.assets.unpricedCount > 0 && (
                      <p className="insight-warning">
                        {data.assets.unpricedCount} posisi tanpa harga tidak termasuk dalam total aset diketahui.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="insight-empty">Konteks aset tidak disertakan atau belum tersedia untuk mata uang ini.</p>
                )}
                {data.investment && (
                  <>
                    <h3>Valuasi investasi terkini</h3>
                    <Lines>
                      {line("Nilai pasar yang diketahui", data.investment.marketMinor)}
                      {line("P/L belum terealisasi (posisi berharga)", data.investment.unrealizedMinor)}
                      {line("P/L terealisasi sepanjang riwayat", data.investment.realizedMinor)}
                    </Lines>
                    {data.investment.unpricedCount > 0 && (
                      <p className="insight-warning">
                        {data.investment.unpricedCount} posisi belum memiliki harga. Nilai pasar dan P/L belum terealisasi tidak mencakup posisi tersebut.
                      </p>
                    )}
                  </>
                )}
                <h3>Transaksi investasi pada periode terpilih</h3>
                <p className="insight-note">
                  Pembelian, penjualan, dan biaya transaksi investasi dicatat terpisah dari pemasukan maupun pengeluaran konsumsi. P/L terealisasi di atas adalah sepanjang riwayat, bukan P/L periode ini.
                </p>
                {data.flows && BigInt(data.flows.tradeCount) > 0n ? (
                  <Lines>
                    {line("Pembelian instrumen", data.flows.purchasePrincipalMinor)}
                    {line("Hasil penjualan instrumen", data.flows.saleProceedsMinor)}
                    {line("Biaya transaksi investasi", data.flows.feesMinor)}
                    {line("Arus kas bersih investasi", data.flows.netCashMinor)}
                  </Lines>
                ) : (
                  <p className="insight-empty">Belum ada transaksi jual/beli investasi pada periode ini.</p>
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
