import type { ReactNode } from "react";
import type { AnalyticsReport, DimensionRow } from "@/lib/analytics/types";
import { dayLabel, feePartition, insightsCurrency, originLabel, percentageLabel, periodLabel, signedMoney } from "@/lib/analytics/presentation";
import { formatMinor } from "@/lib/finance/format";
import { InsightsTrend } from "./insights-trend";
import type { InsightsMonthSelection } from "./use-insights-month";
import type { InsightsSlideSelection } from "./insights-carousel";
import { InsightsCostBars } from "./insights-visuals";
import { InsightsPrimary } from "./insights-primary";
import { InsightsSecondary } from "./insights-secondary";
import { FinancialAmount } from "./financial-amount";
import { SectionHeading } from "./section-heading";

function Money({ value, currency, exponent, className = "", suffix = "" }: { value: string; currency: string; exponent: number; className?: string; suffix?: string }) {
  const text = formatMinor(value, currency, exponent) + suffix;
  return <FinancialAmount value={text} as="span" className={`insight-money ${className}`} />;
}
function Lines({ children }: { children: ReactNode }) { return <dl className="insight-lines">{children}</dl>; }
function Dimensions({ rows, origin = false }: { rows: DimensionRow[]; origin?: boolean }) {
  if (!rows.length) return <p className="insight-note">Belum ada aktivitas tercatat pada periode ini.</p>;
  return <ul className="insight-dimensions">{rows.map((row) => <li key={row.key}>
    <div className="insight-dimension-heading"><strong>{origin ? originLabel(row.key) : row.name}{row.archived && <small> · Diarsipkan</small>}</strong><span>{row.activityCount} transaksi</span></div>
    <dl className="insight-small-values"><div><dt>Pemasukan</dt><dd><Money value={row.incomeMinor} currency={row.currency} exponent={row.exponent} /></dd></div><div><dt>Belanja & biaya</dt><dd><Money value={row.spendingMinor} currency={row.currency} exponent={row.exponent} /></dd></div><div><dt>Transfer keluar</dt><dd><Money value={row.transferPrincipalMinor} currency={row.currency} exponent={row.exponent} /></dd></div></dl>
  </li>)}</ul>;
}

export function InsightsReportView({ report, currency, periodKind = "current_month", monthSelection, slideSelection = { index: 0, select: () => {} } }: { report: AnalyticsReport; currency: string; periodKind?: string; monthSelection?: InsightsMonthSelection; slideSelection?: InsightsSlideSelection }) {
  const data = insightsCurrency(report, currency), summary = data.summary;
  if (!summary) return <div className="surface insight-state" role="status">Belum ada akun atau portofolio dengan mata uang yang dapat dilaporkan.</div>;
  const money = (value: string, className = "") => <Money value={value} currency={currency} exponent={summary.exponent} className={className} />;
  const fees = feePartition(data.charges);
  const line = (label: string, value: string) => <div key={label}><dt>{label}</dt><dd>{money(value,
    BigInt(value) < 0n ? "insight-negative" : label.startsWith("P/L") && BigInt(value) > 0n ? "insight-positive" : "")}</dd></div>;
  return <div className="insight-report">
    <div className="insight-period-heading"><div><strong>{periodLabel(report.period)}</strong><span>{currency} · Kalender Asia/Jakarta</span></div><small>Dibaca {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(report.generatedAt))} WIB</small></div>
    {(report.period.partial || report.comparison.partialComparison) && <p className="insight-warning" role="note">{report.period.partial ? "Periode berjalan — angka dapat berubah hingga akhir periode. " : "Periode pembanding belum lengkap. "}Perbandingan bukan penyamaan jumlah hari yang sudah berlalu.</p>}
    {!!(data.assets?.unpricedCount || data.investment?.unpricedCount) && <p className="insight-warning" role="note">Ada posisi investasi tanpa harga. Total aset diketahui dan nilai pasar belum mencakup semuanya; rincian ada di Aset & investasi.</p>}
    {report.context && !report.context.planningReady && <p className="insight-warning" role="note">Planning belum tersedia; konteks kewajiban belum lengkap.</p>}
    <section className="surface insight-panel insight-overview" aria-label="Ringkasan keuangan">
      <div className="insight-main-metrics">{([
        ["Pemasukan", "incomeMinor", "income", "positive"],
        ["Total belanja", "spendingMinor", "spending", "negative"],
        ["Net operasional", "netMinor", "net", BigInt(summary.netMinor) < 0n ? "negative" : "positive"],
      ] as const).map(([label, valueKey, compareKey, tone]) => {
        const comparison = data.comparison?.[compareKey];
        return <div className="insight-main-metric" key={valueKey}><span>{label}</span><strong>{money(summary[valueKey], `insight-${tone}`)}</strong>
          <small>{comparison ? <>{signedMoney(comparison.differenceMinor, currency, summary.exponent)} <span>({percentageLabel(comparison.percentageChangeBps, true)})</span></> : "—"}<span className="insight-comparison-label">Selisih dari periode pembanding</span></small>
        </div>;
      })}</div>
      <p className="insight-note"><span className="insight-net-short">Net = pemasukan − belanja; bukan pertumbuhan aset.</span><span className="insight-net-full">Net = pemasukan − belanja, bukan pertumbuhan total aset. Pokok Transfer internal tidak dihitung sebagai pemasukan atau belanja.</span></p>
      <details className="insight-inline-detail insight-summary-detail"><summary>Komponen & perbandingan</summary>
      <dl className="insight-support-metrics">{line("Pokok Expense", summary.expensePrincipalMinor)}{line("Biaya layanan & Transfer", summary.feesMinor)}{line("Pajak", summary.taxesMinor)}{line("Biaya lainnya", summary.otherChargesMinor)}</dl>
      <dl className="insight-comparison-details">{([['Pemasukan', 'income'], ['Belanja', 'spending'], ['Net operasional', 'net']] as const).map(([label, key]) => <div key={key}><dt>Selisih {label}</dt><dd>{data.comparison ? `${signedMoney(data.comparison[key].differenceMinor, currency, summary.exponent)} (${percentageLabel(data.comparison[key].percentageChangeBps, true)})` : '—'}</dd></div>)}</dl>
      <p className="insight-note">Pembanding: {periodLabel(report.comparison.period)}. {periodKind === "custom" ? "Interval sebelumnya dengan jumlah hari yang sama." : "Blok kalender sebelumnya secara penuh."} Persentase — berarti basis tidak positif atau tidak dapat dibandingkan.</p>
      <p className="insight-note">Pokok Transfer internal tidak dihitung sebagai pemasukan atau belanja.</p>
      <p className="insight-note insight-activity-meta"><span>{summary.activityCount} transaksi P3 efektif: {summary.incomeCount} Income · {summary.expenseCount} Expense · {summary.transferCount} Transfer.</span>
        <span className="insight-transfer-meta">Transfer: <Money value={summary.transferPrincipalMinor} currency={currency} exponent={summary.exponent} suffix="." /></span></p>
      </details>
      {summary.activityCount === "0" && <p className="insight-empty">Belum ada transaksi P3 efektif pada periode ini. Konteks aset dan investasi tetap ditampilkan jika tersedia.</p>}
    </section>
    <InsightsPrimary report={report} currency={currency} exponent={summary.exponent} selection={monthSelection} slides={slideSelection} categories={data.categories.rows} origins={data.origins} />
    <InsightsSecondary items={[
      { key: "fees", title: "Biaya & pajak", summary: `${formatMinor(summary.chargesMinor, currency, summary.exponent)} · Sudah termasuk dalam belanja`, action: "Rincian biaya & pajak", content: <>
        <SectionHeading title="Biaya & pajak" helper="Sudah termasuk dalam belanja P3." />
        <InsightsCostBars currency={currency} exponent={summary.exponent} rows={[
          { key: "fee", label: "Layanan (termasuk Transfer)", amount: summary.feesMinor },
          { key: "tax", label: "Pajak", amount: summary.taxesMinor },
          { key: "other", label: "Biaya lainnya", amount: summary.otherChargesMinor },
        ]} />
        {BigInt(summary.chargesMinor) === 0n && <p className="insight-empty">Tidak ada biaya atau pajak P3 pada periode ini.</p>}
      </>, details: <>
        <InsightsCostBars currency={currency} exponent={summary.exponent} rows={data.charges.map((row) => ({ key: `${row.typeId}:${row.activityKind}`, label: `${row.name} · ${row.activityKind}`, amount: row.amountMinor }))} />
        <Lines>{line("Administrasi / layanan", fees.serviceMinor)}{line("Biaya layanan pada Transfer", fees.transferMinor)}{line("Pajak", summary.taxesMinor)}{line("Biaya lainnya", summary.otherChargesMinor)}</Lines>
        <p className="insight-note">Biaya Transfer adalah bagian dari total biaya layanan dan belanja, bukan tambahan lagi. Biaya perdagangan P4 ditampilkan terpisah di investasi.</p>
        {data.charges.length ? <ul className="insight-charges">{data.charges.map((row) => <li key={`${row.typeId}:${row.activityKind}`}><span><strong>{row.name}</strong>{row.archived && <small> · Diarsipkan</small>}<small>{row.activityKind} · {row.bucket === "tax" ? "Pajak" : row.bucket === "fee" ? "Biaya layanan" : "Biaya lainnya"} · {row.chargeCount} biaya</small></span>{money(row.amountMinor)}</li>)}</ul> : <p className="insight-empty">Tidak ada biaya atau pajak P3 pada periode ini.</p>}
      </> },
      { key: "accounts", title: "Aktivitas menurut akun", summary: `${data.accounts.length} akun · Penerima pemasukan / pembayar biaya / asal Transfer`, action: "Rincian aktivitas akun", content: <>
        <SectionHeading title="Aktivitas menurut akun" helper="Belanja per akun pembayar · Bukan saldo akun." />
        <InsightsCostBars currency={currency} exponent={summary.exponent} rows={[...data.accounts].sort((a,b) => BigInt(a.spendingMinor) === BigInt(b.spendingMinor) ? a.key.localeCompare(b.key) : BigInt(a.spendingMinor) > BigInt(b.spendingMinor) ? -1 : 1).slice(0,4).map(row => ({key:row.key,label:`${row.name}${row.archived ? " · Diarsipkan" : ""}`,amount:row.spendingMinor}))} />
        {!data.accounts.some(row => BigInt(row.spendingMinor) > 0n) && <p className="insight-empty">Belum ada belanja pada akun di periode ini. Pemasukan dan Transfer tersedia di rincian.</p>}
      </>, details: <>
        <p className="insight-note">Dimensi akun menunjukkan penerima Income, pembayar Expense/biaya, dan asal pokok Transfer keluar. Ini bukan mutasi rekening lengkap dua sisi dan bukan saldo akun.</p><Dimensions rows={data.accounts} />
      </> },
      { key: "monthly", title: "Rincian angka bulanan", summary: `${data.monthly.length} bulan · Grafik lengkap dan tabel tepat`, action: "Lihat angka bulanan", details: <>
        <InsightsTrend rows={data.monthly} report={report} selection={monthSelection} tableDisclosure={false} />
        <h3>Aktivitas menurut asal</h3><p className="insight-note">Pemasukan, belanja dan Transfer dilaporkan terpisah; bukan denominator grafik asal belanja.</p><Dimensions rows={data.origins} origin />
      </> },
      { key: "investments", title: "Aset & investasi saat ini", mobileSummary: "Snapshot terkini · Terpisah dari periode laporan", summary: `${data.assets ? `Aset diketahui ${formatMinor(data.assets.totalMinor, currency, summary.exponent)} · ` : ""}Snapshot terkini · Terpisah dari periode laporan`, action: "Rincian aset & investasi", content: <>
        <SectionHeading title="Aset & investasi saat ini" helper="Snapshot terkini · Arus perdagangan terpisah dari belanja P3." />
        {data.investment && <p className="insight-investment-snapshot">Nilai pasar diketahui {money(data.investment.marketMinor)}</p>}
        {data.flows && BigInt(data.flows.tradeCount) > 0n ? <InsightsCostBars currency={currency} exponent={summary.exponent} rows={[
          { key: "buy", label: "Pokok beli P4", amount: data.flows.purchasePrincipalMinor },
          { key: "sell", label: "Hasil jual P4", amount: data.flows.saleProceedsMinor },
          { key: "fee", label: "Biaya perdagangan P4", amount: data.flows.feesMinor },
        ]} /> : <p className="insight-empty">Tidak ada perdagangan P4 pada periode ini.</p>}
        {!!data.investment?.unpricedCount && <p className="insight-note">{data.investment.unpricedCount} posisi tanpa harga; nilai pasar belum lengkap.</p>}
      </>, details: <>
        <p className="insight-note">Nilai berikut adalah kondisi saat laporan dibaca, bukan nilai pada akhir periode terpilih. Riwayat valuasi aset belum tersedia.</p>
        <p className="insight-note">Snapshot dibaca {new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(report.generatedAt))} WIB.</p>
        {data.assets ? <><Lines>{line("Total aset diketahui", data.assets.totalMinor)}{line("Dana likuid", data.assets.liquidMinor)}{line("Dapat digunakan", data.assets.spendableMinor)}{line("Setelah kewajiban", data.assets.availableMinor)}</Lines>
          <p className="insight-note">{report.context?.planningReady ? `Setelah cadangan dan kewajiban sampai ${dayLabel(report.context.throughDay)}.` : "Planning belum tersedia; konteks kewajiban belum lengkap."}</p>
          {data.assets.unpricedCount > 0 && <p className="insight-warning">{data.assets.unpricedCount} posisi tanpa harga tidak termasuk dalam total aset diketahui.</p>}</> : <p className="insight-empty">Konteks aset tidak disertakan atau belum tersedia untuk mata uang ini.</p>}
        {data.investment && <><h3>Valuasi investasi terkini</h3><Lines>{line("Nilai pasar yang diketahui", data.investment.marketMinor)}{line("P/L belum terealisasi (posisi berharga)", data.investment.unrealizedMinor)}{line("P/L terealisasi sepanjang riwayat", data.investment.realizedMinor)}</Lines>
          {data.investment.unpricedCount > 0 && <p className="insight-warning">{data.investment.unpricedCount} posisi belum memiliki harga. Nilai pasar dan P/L belum terealisasi tidak mencakup posisi tersebut.</p>}</>}
        <h3>Arus perdagangan pada periode terpilih</h3><p className="insight-note">Pembelian/penjualan investasi dan biaya P4 bukan konsumsi Expense atau Income biasa. P/L terealisasi di atas adalah sepanjang riwayat, bukan P/L periode ini.</p>
        {data.flows ? <Lines>{line("Pokok pembelian P4", data.flows.purchasePrincipalMinor)}{line("Hasil penjualan P4", data.flows.saleProceedsMinor)}{line("Biaya perdagangan P4", data.flows.feesMinor)}{line("Arus kas net perdagangan P4", data.flows.netCashMinor)}</Lines> : <p className="insight-empty">Tidak ada perdagangan P4 pada periode ini.</p>}
      </> },
    ]} />
  </div>;
}
