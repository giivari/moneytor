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
import { useInsightsViewport } from "./use-insights-viewport";

function Money({
  value,
  currency,
  exponent,
  level = "supporting",
  className = "",
  suffix = "",
}: {
  value: string;
  currency: string;
  exponent: number;
  level?: "hero" | "summary" | "entity" | "row" | "supporting";
  className?: string;
  suffix?: string;
}) {
  const text = formatMinor(value, currency, exponent) + suffix;
  return <FinancialAmount value={text} level={level} as="span" className={`insight-money ${className}`} />;
}

function AccountMutationTable({ rows }: { rows: DimensionRow[] }) {
  const mobile = useInsightsViewport();
  if (!rows.length) return <p className="insight-note">Belum ada aktivitas tercatat pada periode ini.</p>;

  if (mobile) {
    return (
      <div className="u-table-wrap" tabIndex={0} role="region" aria-label="Tabel rincian mutasi per akun">
        <table className="u-table" aria-label="Rincian mutasi per akun">
          <thead>
            <tr>
              <th scope="col">Akun</th>
              <th scope="col">Mutasi bersih</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const inc = BigInt(row.incomeMinor);
              const trfIn = BigInt(row.transferInMinor ?? "0");
              const exp = BigInt(row.spendingMinor);
              const trfOut = BigInt(row.transferPrincipalMinor);
              const netMutation = inc + trfIn - exp - trfOut;
              const hasActivity = inc > 0n || trfIn > 0n || exp > 0n || trfOut > 0n;
              return (
                <tr key={row.key}>
                  <th scope="row">
                    <strong>{row.name}</strong>
                    {row.archived && <em className="u-pill">Diarsipkan</em>}
                    <small className="u-cell-sub">
                      {hasActivity
                        ? [
                            exp > 0n ? `Belanja ${formatMinor(row.spendingMinor, row.currency, row.exponent)}` : null,
                            inc > 0n ? `Masuk ${formatMinor(row.incomeMinor, row.currency, row.exponent)}` : null,
                            `${row.activityCount}x transaksi`,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "Tidak ada aktivitas"}
                    </small>
                  </th>
                  <td
                    className={
                      netMutation < 0n
                        ? "insight-negative"
                        : netMutation > 0n
                          ? "insight-positive"
                          : "insight-zero-muted"
                    }
                  >
                    <FinancialAmount
                      as="span"
                      value={signedMoney(netMutation.toString(), row.currency, row.exponent)}
                      className="insight-money"
                    />
                    <small className="u-cell-sub">
                      {inc + trfIn > 0n && exp + trfOut > 0n
                        ? `Masuk ${formatMinor((inc + trfIn).toString(), row.currency, row.exponent)}`
                        : "Mutasi bersih"}
                    </small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="u-table-wrap insight-chart-scroll" tabIndex={0} role="region" aria-label="Tabel rincian mutasi per akun">
      <table className="u-table" aria-label="Rincian mutasi per akun">
        <thead>
          <tr>
            <th scope="col">Akun</th>
            <th scope="col">Transaksi</th>
            <th scope="col">Pemasukan</th>
            <th scope="col">Transfer masuk</th>
            <th scope="col">Belanja &amp; biaya</th>
            <th scope="col">Transfer keluar</th>
            <th scope="col">Mutasi bersih</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inc = BigInt(row.incomeMinor);
            const trfIn = BigInt(row.transferInMinor ?? "0");
            const exp = BigInt(row.spendingMinor);
            const trfOut = BigInt(row.transferPrincipalMinor);
            const netMutation = inc + trfIn - exp - trfOut;
            return (
              <tr key={row.key}>
                <th scope="row">
                  <strong>{row.name}</strong>
                  {row.archived && <em className="u-pill">Diarsipkan</em>}
                </th>
                <td className="insight-zero-muted">{row.activityCount}x</td>
                <td className={inc === 0n ? "insight-zero-muted" : "insight-positive"}>
                  <Money value={row.incomeMinor} currency={row.currency} exponent={row.exponent} />
                </td>
                <td className={trfIn === 0n ? "insight-zero-muted" : "insight-positive"}>
                  <Money value={row.transferInMinor ?? "0"} currency={row.currency} exponent={row.exponent} />
                </td>
                <td className={exp === 0n ? "insight-zero-muted" : "insight-negative"}>
                  <Money value={row.spendingMinor} currency={row.currency} exponent={row.exponent} />
                </td>
                <td className={trfOut === 0n ? "insight-zero-muted" : ""}>
                  <Money value={row.transferPrincipalMinor} currency={row.currency} exponent={row.exponent} />
                </td>
                <td
                  className={
                    netMutation < 0n
                      ? "insight-negative"
                      : netMutation > 0n
                        ? "insight-positive"
                        : "insight-zero-muted"
                  }
                >
                  <FinancialAmount
                    as="span"
                    value={signedMoney(netMutation.toString(), row.currency, row.exponent)}
                    className="insight-money"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
  const money = (value: string, className = "", level: "summary" | "supporting" = "supporting") => (
    <Money value={value} currency={currency} exponent={summary.exponent} level={level} className={className} />
  );
  const rowCell = (label: string, value: string, sub?: string) => {
    const valBig = BigInt(value);
    const tone =
      valBig < 0n ? "insight-negative" : label.startsWith("P/L") && valBig > 0n ? "insight-positive" : valBig === 0n ? "insight-zero-muted" : "";
    return (
      <tr key={label}>
        <th scope="row">
          <strong>{label}</strong>
          {sub && <small className="u-cell-sub">{sub}</small>}
        </th>
        <td className={tone}>{money(value)}</td>
      </tr>
    );
  };

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
                <strong>{money(summary[valueKey], `insight-${tone}`, "summary")}</strong>
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
              {savingsRateBps !== null ? percentageLabel(savingsRateBps, true) : money(dailyBurnMinor, "", "summary")}
            </strong>
            <small>
              {savingsRateBps !== null ? (
                <>Belanja rata-rata {formatMinor(dailyBurnMinor, currency, summary.exponent)}/hari</>
              ) : (
                <>
                  {summary.expenseCount}x pengeluaran dalam {daysElapsed.toString()} hari
                </>
              )}
            </small>
          </div>
        </div>

        <div className="insight-overview-foot">
          {(report.period.partial || report.comparison.partialComparison) && (
            <span className="insight-live-pill" role="note">
              <i className="insight-status-dot" aria-hidden="true" />
              {report.period.partial ? "Periode berjalan" : "Pembanding parsial"}
            </span>
          )}
          <details className="insight-inline-detail insight-summary-detail">
            <summary>Rincian komponen &amp; perbandingan</summary>
            <div className="insight-summary-expanded">
              <div className="u-subgrid">
                <div className="u-table-section">
                  <h4 className="u-table-title">Perbandingan vs {periodLabel(report.comparison.period)}</h4>
                  <div className="u-table-wrap">
                    <table className="u-table" aria-label="Perbandingan dengan periode sebelumnya">
                      <thead>
                        <tr>
                          <th scope="col">Indikator</th>
                          <th scope="col">Periode ini</th>
                          <th scope="col">Selisih</th>
                          <th scope="col">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(
                          [
                            ["Pemasukan", summary.incomeMinor, "income", "insight-positive"],
                            ["Belanja", summary.spendingMinor, "spending", "insight-negative"],
                            [
                              "Net operasional",
                              summary.netMinor,
                              "net",
                              BigInt(summary.netMinor) < 0n ? "insight-negative" : "insight-positive",
                            ],
                          ] as const
                        ).map(([label, currentVal, key, tone]) => {
                          const comp = data.comparison?.[key];
                          const diffBig = comp ? BigInt(comp.differenceMinor) : 0n;
                          return (
                            <tr key={key}>
                              <th scope="row">
                                <strong>{label}</strong>
                              </th>
                              <td className={BigInt(currentVal) === 0n ? "insight-zero-muted" : tone}>{money(currentVal)}</td>
                              <td className={!comp || diffBig === 0n ? "insight-zero-muted" : ""}>
                                {comp ? signedMoney(comp.differenceMinor, currency, summary.exponent) : "—"}
                              </td>
                              <td className="insight-zero-muted">{comp ? percentageLabel(comp.percentageChangeBps, true) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="u-table-section">
                  <h4 className="u-table-title">Komponen belanja &amp; aktivitas ({summary.activityCount} transaksi)</h4>
                  <div className="u-table-wrap">
                    <table className="u-table" aria-label="Rincian komponen pengeluaran">
                      <thead>
                        <tr>
                          <th scope="col">Komponen</th>
                          <th scope="col">Nominal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rowCell("Pokok pengeluaran", summary.expensePrincipalMinor, `${summary.expenseCount}x pengeluaran`)}
                        {rowCell("Biaya layanan & Transfer", summary.feesMinor, "Termasuk biaya admin transfer")}
                        {rowCell("Pajak", summary.taxesMinor)}
                        {rowCell("Biaya lainnya", summary.otherChargesMinor)}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">Total belanja</th>
                          <td className={BigInt(summary.spendingMinor) === 0n ? "insight-zero-muted" : "insight-negative"}>
                            {money(summary.spendingMinor)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              </div>

              <p className="insight-note insight-activity-meta">
                <span>
                  Pembanding:{" "}
                  {["custom", "last_7_days", "last_30_days"].includes(periodKind)
                    ? "Interval sebelumnya dengan jumlah hari yang sama."
                    : "Blok kalender sebelumnya secara penuh."}{" "}
                  Net = pemasukan − belanja (bukan pertumbuhan total aset).{" "}
                  {data.origins.length > 0 && (
                    <>
                      Sumber pencatatan:{" "}
                      {data.origins
                        .map((r) => `${originLabel(r.key)} ${formatMinor(r.spendingMinor, currency, summary.exponent)}`)
                        .join(" · ")}
                      . Setiap transaksi dihitung sekali; proposal otomatisasi belum dikonfirmasi tidak dihitung.{" "}
                    </>
                  )}
                </span>
                <span className="insight-transfer-meta">
                  Transfer: <Money value={summary.transferPrincipalMinor} currency={currency} exponent={summary.exponent} suffix="." />
                </span>
              </p>
            </div>
          </details>
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
                <AccountMutationTable rows={data.accounts} />
                <p className="insight-note">
                  Mutasi bersih dihitung dari Pemasukan + Transfer masuk − Belanja &amp; biaya − Transfer keluar pada periode terpilih.
                </p>
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
                <div className="u-subgrid">
                  <div className="u-table-section">
                    <h4 className="u-table-title">Posisi kas &amp; aset saat ini</h4>
                    {data.assets ? (
                      <>
                        <div className="u-table-wrap">
                          <table className="u-table" aria-label="Posisi aset dan likuiditas">
                            <thead>
                              <tr>
                                <th scope="col">Komponen</th>
                                <th scope="col">Nominal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rowCell("Total aset diketahui", data.assets.totalMinor)}
                              {rowCell("Dana likuid", data.assets.liquidMinor)}
                              {rowCell("Dapat digunakan", data.assets.spendableMinor)}
                              {rowCell(
                                "Setelah kewajiban",
                                data.assets.availableMinor,
                                report.context?.planningReady
                                  ? `Sampai ${dayLabel(report.context.throughDay)}`
                                  : "Planning belum tersedia",
                              )}
                            </tbody>
                          </table>
                        </div>
                        {data.assets.unpricedCount > 0 && (
                          <p className="insight-note">
                            {data.assets.unpricedCount} posisi tanpa harga tidak termasuk dalam total aset diketahui.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="insight-empty">Konteks aset tidak disertakan atau belum tersedia untuk mata uang ini.</p>
                    )}
                  </div>

                  <div className="u-table-section">
                    <h4 className="u-table-title">Valuasi &amp; transaksi investasi</h4>
                    <div className="u-table-wrap">
                      <table className="u-table" aria-label="Valuasi dan arus kas investasi">
                        <thead>
                          <tr>
                            <th scope="col">Indikator</th>
                            <th scope="col">Nominal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.investment && (
                            <>
                              {rowCell("Nilai pasar yang diketahui", data.investment.marketMinor)}
                              {rowCell("P/L belum terealisasi (posisi berharga)", data.investment.unrealizedMinor)}
                              {rowCell("P/L terealisasi sepanjang riwayat", data.investment.realizedMinor)}
                            </>
                          )}
                          {data.flows && BigInt(data.flows.tradeCount) > 0n && (
                            <>
                              {rowCell("Pembelian instrumen", data.flows.purchasePrincipalMinor, "Periode terpilih")}
                              {rowCell("Hasil penjualan instrumen", data.flows.saleProceedsMinor, "Periode terpilih")}
                              {rowCell("Biaya transaksi investasi", data.flows.feesMinor, "Periode terpilih")}
                              {rowCell("Arus kas bersih investasi", data.flows.netCashMinor, "Periode terpilih")}
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {(!data.flows || BigInt(data.flows.tradeCount) === 0n) && (
                      <p className="insight-note">Belum ada transaksi jual/beli investasi pada periode ini.</p>
                    )}
                    {data.investment && data.investment.unpricedCount > 0 && (
                      <p className="insight-warning" style={{ marginTop: 10 }}>
                        {data.investment.unpricedCount} posisi belum memiliki harga. Nilai pasar dan P/L belum terealisasi tidak mencakup posisi tersebut.
                      </p>
                    )}
                  </div>
                </div>
                <p className="insight-note">
                  Snapshot kondisi saat laporan dibaca (
                  {new Intl.DateTimeFormat("id-ID", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Jakarta",
                  }).format(new Date(report.generatedAt))}{" "}
                  WIB), bukan nilai pada akhir periode terpilih.
                </p>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
