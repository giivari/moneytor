import { AppLink as Link } from "./app-link";
import { ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr";
import type { financeSnapshot } from "@/lib/finance/summary";
import type { AnalyticsReport } from "@/lib/analytics/types";
import { formatMinor } from "@/lib/finance/format";
import { sortNamed } from "@/lib/list-order";
import { SectionHeading } from "./section-heading";
import { FinancialAmount } from "./financial-amount";
import { HomeAnalytics } from "./home-analytics";
import { resolveProviderMark } from "@/lib/domain/provider-marks";
import { ProviderBrandMark } from "./provider-brand-mark";

type Snapshot = Awaited<ReturnType<typeof financeSnapshot>>;
function HomeAmount({ value, level = "supporting", tone = "", inline = false }: {
  value: string; level?: "hero" | "summary" | "entity" | "row" | "supporting"; tone?: string; inline?: boolean;
}) {
  return <FinancialAmount value={value} level={level} className={`home-amount ${tone}${inline ? " home-inline-money" : ""}`} />;
}

export function HomeOverview({ snapshot, date, analytics = null }: { snapshot: Snapshot; date: string; analytics?: AnalyticsReport | null }) {
  const { assets, recent, currencies, investment, planningReady, throughDay } = snapshot;
  const horizon = new Date(`${throughDay}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
  const empty = !assets.length && !investment.hasHoldings;
  return <div className="page home-page">
    <header className="welcome-row home-heading"><h1>Keuangan hari ini</h1><span>{date}</span></header>
    {empty ? <section className="surface finance-empty"><h2>Mulai dari aset pertama</h2>
      <p>Catat akun atau aset dan saldo awalnya untuk melihat posisi keuangan yang nyata di sini.</p>
      <Link href="/assets" className="button-primary">Tambah aset <ArrowRight size={17} aria-hidden="true" /></Link></section> : <>
      <div className="home-currencies">{sortNamed(currencies, entry => entry.currency, entry => entry.currency).map(entry => {
        const obligationsRelevant = planningReady && (BigInt(entry.dueMinor) > 0n || BigInt(entry.uncoveredMinor) > 0n || BigInt(entry.availableMinor) < 0n);
        const money = (value: string) => formatMinor(value, entry.currency, entry.exponent);
        return <div className="home-currency" key={entry.currency}>
          <div className="home-kpis" aria-label={`Ringkasan ${entry.currency}`}>
            <section className="surface home-kpi home-hero"><h2>Dapat digunakan <small>{entry.currency}</small></h2>
              <HomeAmount value={money(entry.spendableMinor)} level="summary" tone={BigInt(entry.spendableMinor) < 0n ? "pnl-negative" : ""} />
              <small>{planningReady ? "Setelah cadangan aktif" : "Planning belum diaktifkan"}</small>
              <p className="home-known-assets home-desktop-only">Total aset diketahui <HomeAmount value={money(entry.totalMinor)} inline /></p>
            </section>
            <section className="surface home-kpi home-expense"><h2>Pengeluaran bulan ini</h2><HomeAmount value={money(entry.expenseMinor)} level="summary" tone="pnl-negative" /><small>Termasuk biaya · {entry.currency}</small></section>
            <section className="surface home-kpi home-liquid"><h2>Dana likuid</h2><HomeAmount value={money(entry.liquidMinor)} level="summary" /><small>Saldo akun likuid · {entry.currency}</small></section>
            <section className="surface home-kpi home-obligations" data-mobile-relevant={obligationsRelevant}><h2>Setelah kewajiban</h2>
              {planningReady ? <><HomeAmount value={money(entry.availableMinor)} level="summary" tone={BigInt(entry.availableMinor) < 0n ? "pnl-negative" : ""} /><small>S.d. {horizon} · Setelah cadangan terkait</small></> : <p className="home-muted">Planning belum tersedia.</p>}
            </section>
          </div>
          <div className="home-warnings">
            {entry.unpricedCount > 0 && <p className="investment-warning home-warning">{entry.unpricedCount} posisi tanpa harga belum termasuk. <Link href="/assets/investments">Lihat investasi</Link></p>}
            {planningReady && BigInt(entry.uncoveredMinor) > 0n && <p className="investment-warning home-warning">Kewajiban belum tercakup cadangan: <HomeAmount value={money(entry.uncoveredMinor)} inline />, s.d. {horizon}.</p>}
            {planningReady && BigInt(entry.availableMinor) < 0n && <p className="pnl-negative home-warning">Posisi setelah kewajiban negatif.</p>}
          </div>
          <HomeAnalytics report={analytics} currency={entry.currency} exponent={entry.exponent} />
        </div>;
      })}</div>

      <div className="home-support-grid">
        <section className="surface home-investments home-desktop-only"><SectionHeading title="Investasi" action={<Link href="/assets/investments" className="text-link">Kelola <ArrowRight size={15} aria-hidden="true" /></Link>} />
          {!investment.totals.length ? <p>Catat portofolio, posisi awal, atau transaksi investasi.</p> : sortNamed(investment.totals, total => total.currency, total => total.currency).map(total => <div className="home-investment-currency" key={total.currency}>
            <dl><div><dt>Nilai pasar berharga · {total.currency}</dt><dd><HomeAmount value={formatMinor(total.marketMinor, total.currency, total.exponent)} level="entity" /></dd></div>
              <div><dt>Laba/rugi belum terealisasi{total.unpricedCount ? " · posisi berharga" : ""}</dt><dd><HomeAmount value={formatMinor(total.unrealizedMinor, total.currency, total.exponent)} level="entity" tone={BigInt(total.unrealizedMinor) < 0n ? "pnl-negative" : BigInt(total.unrealizedMinor) > 0n ? "pnl-positive" : ""} /></dd></div></dl>
            {total.unpricedCount > 0 && <small className="investment-warning">{total.unpricedCount} posisi belum memiliki harga.</small>}
          </div>)}
        </section>
        <section className="surface home-accounts home-desktop-only"><SectionHeading title="Akun & aset" action={<Link href="/assets" className="text-link">Lihat semua <ArrowRight size={15} aria-hidden="true" /></Link>} />
          {!assets.length && <p className="finance-empty-inline">Belum ada akun atau aset tercatat.</p>}
          <ul className="home-account-list">{assets.slice(0, 3).map(asset => {
            const mark = resolveProviderMark(asset.providerName, asset.displayName, asset.normallySpendable ? "blue" : asset.normallyLiquid ? "cyan" : "violet");
            return <li key={asset.id} data-wide={formatMinor(asset.balanceMinor, asset.currency, asset.exponent).length > 18}>
              <ProviderBrandMark mark={mark} />
              <div className="home-account-copy"><strong>{asset.displayName}</strong><span>{asset.providerName ?? asset.assetTypeName}{asset.isActive ? "" : " · Diarsipkan"}</span></div>
              <HomeAmount value={formatMinor(asset.balanceMinor, asset.currency, asset.exponent)} level="row" />
            </li>;
          })}</ul>
        </section>
        <section className="surface home-recent"><SectionHeading title="Transaksi terkini" action={<Link href="/transactions" className="text-link">Lihat semua <ArrowRight size={15} aria-hidden="true" /></Link>} />
          {!recent.length ? <p className="finance-empty-inline">Belum ada transaksi tercatat.</p> : <ul className="home-recent-list">{recent.slice(0, 3).map(item => {
            const total = item.kind === "transfer" ? BigInt(item.baseAmountMinor) : BigInt(item.baseAmountMinor) + item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
            const amount = `${item.kind === "expense" ? "−" : item.kind === "income" ? "+" : ""}${formatMinor(total, item.currency, item.exponent)}`;
            const kind = item.kind === "income" ? "Pemasukan" : item.kind === "expense" ? "Pengeluaran" : "Transfer";
            const Icon = item.kind === "income" ? ArrowDownLeft : item.kind === "expense" ? ArrowUpRight : ArrowsLeftRight;
            const accounts = item.kind === "transfer" ? [item.sourceName, item.destinationName].filter(Boolean).join(" → ") : item.sourceName || item.destinationName;
            const occurred = new Date(item.occurredAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
            const fee = item.kind === "transfer" && item.charges[0] ? `Biaya ${formatMinor(item.charges[0].amountMinor, item.currency, item.exponent)}` : null;
            const context = [accounts, item.recurringRuleName ? "Otomatisasi" : item.categoryName, occurred, fee].filter(Boolean).join(" · ");
            const fullContext = [kind, item.categoryName, accounts, item.recurringRuleName ? `Otomatis: ${item.recurringRuleName}` : null, occurred, fee].filter(Boolean).join(" · ");
            return <li key={item.id} data-wide={amount.length > 18}>
              <span className={`transaction-icon ${item.kind}`}><Icon size={16} aria-hidden="true" /></span>
              <div className="home-recent-copy"><strong title={item.note || kind}>{item.note || kind}</strong><small title={fullContext}>{context}</small></div>
              <HomeAmount value={amount} level="row" tone={item.kind === "expense" ? "pnl-negative" : item.kind === "income" ? "pnl-positive" : ""} />
            </li>;
          })}</ul>}
        </section>
      </div>
      <aside className="home-context"><details><summary>Cara membaca posisi keuangan</summary>
        <p className="supporting-prose supporting-prose--section">{planningReady ? "Total aset menghitung saldo awal dan pergerakan nyata. Hanya cadangan aktif mengurangi dana dapat digunakan; sisa kewajiban terbuka hingga 30 hari mengurangi dana setelah kewajiban." : "Total aset menghitung saldo awal dan semua pergerakan. Dana dapat digunakan mengikuti tanda pada aset; cadangan dan kewajiban belum diperhitungkan sampai migrasi 007 diaktifkan."} Pengeluaran bulan ini termasuk biaya. Grafik memakai periode enam bulan terpisah dari snapshot posisi saat ini; net operasional bukan pertumbuhan aset.</p>
        <Link href="/planning" className="text-link">Lihat Planning <ArrowRight size={15} aria-hidden="true" /></Link>
      </details></aside>
    </>}
  </div>;
}
