import { AppLink as Link } from "./app-link";
import { ArrowRight, ArrowCounterClockwise, ArrowDownLeft, ArrowUpRight, ArrowsLeftRight, CreditCard, HandCoins, Scales, Wallet } from "@phosphor-icons/react/dist/ssr";
import type { financeSnapshot } from "@/lib/finance/summary";
import type { AnalyticsReport } from "@/lib/analytics/types";
import type { FinanceActivity, FinanceAsset } from "@/lib/finance/types";
import { formatMinor } from "@/lib/finance/format";
import { sortNamed } from "@/lib/list-order";
import { isCreditAsset, isReceivableAsset } from "@/lib/domain/credit";
import { creditBillsDue, netWorthComponents, receivablesSummary } from "@/lib/domain/home-briefing";
import { HomeComposition, HomeTrend } from "./home-analytics";
import { HomeAutomationConfirmations } from "./home-automation-confirmations";
import { HomeKpiCarousel } from "./home-kpi-carousel";
import { ActivityDetail, AssetDetail, CreditDetail, activityParts } from "./entity-details";
import { Amount, Breakdown, Card, Kpi, PageHeading, shortDate, toneOf } from "./ui";
import { InspectorRow, InspectorRowButton } from "./inspector";
import { PageTabLink, PageTabs } from "./page-tabs";
import { ICON_SM } from "./icon-size";

type Snapshot = Awaited<ReturnType<typeof financeSnapshot>>;
type CurrencyEntry = Snapshot["currencies"][number];

function RecentActivity({ recent }: { recent: FinanceActivity[] }) {
  return <Card className="home-recent" title="Mutasi terakhir" action={<Link href="/transactions" className="text-link">Lihat semua <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!recent.length ? <p className="ui-muted ui-card-body">Belum ada transaksi tercatat.</p> : <>
      <div className="home-recent-head" aria-hidden="true"><span>Tanggal</span><span>Jenis</span><span>Keterangan</span><span>Total</span></div>
      <ul className="home-recent-list">{recent.slice(0, 6).map((item) => {
        const { total, sign, kind, accounts } = activityParts(item);
        const amount = `${sign}${formatMinor(total, item.currency, item.exponent)}`;
        const Icon = item.kind === "income" ? ArrowDownLeft : item.kind === "expense" ? ArrowUpRight : item.kind === "refund" ? ArrowCounterClockwise : item.kind === "adjustment" ? Scales : ArrowsLeftRight;
        const toneKind = item.kind === "income" || item.kind === "expense" ? item.kind : "transfer";
        const fee = (item.kind === "transfer" || item.kind === "borrow" || item.kind === "repay") && item.charges[0] ? `Biaya ${formatMinor(item.charges[0].amountMinor, item.currency, item.exponent)}` : null;
        const context = [accounts, item.recurringRuleName ? "Otomatisasi" : item.categoryName, fee].filter(Boolean).join(" · ");
        return <InspectorRow key={item.id} id={`activity:${item.id}`} title={item.note || kind} subtitle={`${kind} · ${shortDate(item.occurredAt)}`} detail={<ActivityDetail item={item} />} className="home-recent-row">
          <span className="home-recent-date">{shortDate(item.occurredAt)}</span>
          <span className={`ui-kind ui-kind--${toneKind}`} data-kind={item.kind}><Icon size={ICON_SM} aria-hidden="true" /><span>{kind}</span></span>
          <div className="home-recent-copy"><InspectorRowButton><strong>{item.note || kind}</strong></InspectorRowButton><small>{context}</small></div>
          <Amount value={amount} tone={item.kind === "expense" ? "negative" : item.kind === "income" ? "positive" : ""} />
        </InspectorRow>;
      })}</ul>
    </>}
  </Card>;
}

function DueBills({ snapshot, entry, horizon }: { snapshot: Snapshot; entry: CurrencyEntry; horizon: string }) {
  const { items } = creditBillsDue(snapshot.assets, entry.currency, snapshot.throughDay);
  const byId = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  return <Card className="home-due" title="Jatuh tempo terdekat" meta={`S.d. ${horizon} · ${entry.currency}`}>
    {!items.length ? <p className="ui-muted ui-card-body">Tidak ada tagihan kredit dalam 30 hari.</p> : <ul className="ui-rows">{items.map((bill) => {
      const asset = byId.get(bill.assetId)!;
      return <InspectorRow key={`${bill.assetId}:${bill.dueIso}`} id={`credit:${bill.assetId}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} />} className="ui-row">
        <span className="ui-chip">{shortDate(bill.dueIso)}</span>
        <div className="ui-row-copy"><InspectorRowButton><strong>{bill.name}</strong></InspectorRowButton><small>{asset.providerName ?? asset.assetTypeName}</small></div>
        <Amount value={formatMinor(bill.amountMinor, entry.currency, entry.exponent)} />
      </InspectorRow>;
    })}</ul>}
  </Card>;
}

function Accounts({ assets }: { assets: FinanceAsset[] }) {
  const accounts = assets.filter((asset) => asset.isActive && !isCreditAsset(asset)).slice(0, 5);
  return <Card className="home-accounts" title="Akun &amp; aset" action={<Link href="/assets" className="text-link">Lihat semua <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!accounts.length ? <p className="ui-muted ui-card-body">{assets.some((asset) => !isCreditAsset(asset)) ? "Belum ada akun aktif. Akun yang diarsipkan tetap terhitung di Aset." : "Belum ada akun atau aset tercatat."}</p> : <ul className="ui-rows">{accounts.map((asset) => {
      const balance = formatMinor(asset.balanceMinor, asset.currency, asset.exponent);
      return <InspectorRow key={asset.id} id={`asset:${asset.id}`} title={asset.displayName} subtitle="Rincian rekening" detail={<AssetDetail asset={asset} />} className="ui-row">
        <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{[asset.providerName ?? asset.assetTypeName, isReceivableAsset(asset) ? "Piutang" : null].filter(Boolean).join(" · ")}</small></div>
        <Amount value={balance} tone={toneOf(BigInt(asset.balanceMinor))} />
      </InspectorRow>;
    })}</ul>}
  </Card>;
}

function Investments({ investment }: { investment: Snapshot["investment"] }) {
  return <Card className="home-investments" title="Investasi" action={<Link href="/assets/investments" className="text-link">Kelola <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!investment.totals.length ? <p className="ui-muted ui-card-body">Catat portofolio, posisi awal, atau transaksi investasi.</p> : <dl className="ui-breakdown">
      {sortNamed(investment.totals, (total) => total.currency, (total) => total.currency).flatMap((total) => [
        <div key={`${total.currency}:market`}><dt>Nilai pasar · {total.currency}</dt><dd><Amount value={formatMinor(total.marketMinor, total.currency, total.exponent)} /></dd></div>,
        <div key={`${total.currency}:pnl`}><dt>Laba/rugi belum terealisasi{total.unpricedCount ? " · posisi berharga" : ""}</dt><dd><Amount value={formatMinor(total.unrealizedMinor, total.currency, total.exponent)} tone={BigInt(total.unrealizedMinor) < 0n ? "negative" : BigInt(total.unrealizedMinor) > 0n ? "positive" : ""} /></dd></div>,
        ...(total.unpricedCount ? [<p key={`${total.currency}:unpriced`} className="ui-notice" data-tone="warning">{total.unpricedCount} posisi belum memiliki harga.</p>] : []),
      ])}
    </dl>}
  </Card>;
}

export function HomeOverview({ snapshot, date, analytics = null }: { snapshot: Snapshot; date: string; analytics?: AnalyticsReport | null }) {
  const { assets, recent, investment, planningReady, throughDay } = snapshot;
  const currencies = sortNamed(snapshot.currencies, (entry) => entry.currency, (entry) => entry.currency);
  const horizon = shortDate(throughDay);
  const heading = <PageHeading title="Beranda" description={date} />;
  if (!assets.length && !investment.hasHoldings) return <div className="page home-page">
    <header className="page-header">{heading}</header>
    <section className="ui-card ui-empty"><h2>Mulai dari aset pertama</h2>
      <p>Catat akun atau aset dan saldo awalnya untuk melihat posisi keuangan yang nyata di sini.</p>
      <Link href="/assets" className="button-primary">Tambah aset <ArrowRight size={ICON_SM} aria-hidden="true" /></Link></section>
  </div>;

  const kpis = currencies.map((entry) => {
    const money = (value: string | bigint) => formatMinor(value, entry.currency, entry.exponent);
    const nearest = creditBillsDue(assets, entry.currency, throughDay).nearest;
    const receivables = receivablesSummary(assets, entry.currency);
    const ready = planningReady ? BigInt(entry.availableMinor) : BigInt(entry.spendableMinor);
    return <div className="home-currency" key={entry.currency}>
      <HomeKpiCarousel currency={entry.currency}>
        <div className="ui-kpis" aria-label={`Ringkasan ${entry.currency}`}>
          <Kpi title="Kekayaan bersih" icon={Scales} tone="neutral" value={money(entry.netWorthMinor)} valueTone={toneOf(BigInt(entry.netWorthMinor))}
            note={<>Aset − seluruh kewajiban · {entry.currency}</>} action={<PageTabLink tab="rincian">Lihat rincian</PageTabLink>} />
          <Kpi title="Dana siap pakai" icon={Wallet} tone="info" value={money(ready)} valueTone={toneOf(ready)}
            note={planningReady ? <>Setelah cadangan &amp; kewajiban s.d. {horizon}</> : "Rencana belum diaktifkan"} action={<PageTabLink tab="rincian">Cara hitung</PageTabLink>} />
          <Kpi title="Tagihan kredit terdekat" icon={CreditCard} tone="negative" value={money(nearest?.amountMinor ?? 0n)}
            note={nearest ? <><span className="ui-chip">{shortDate(nearest.dueIso)}</span> <span className="ui-kpi-names">{nearest.names.join(", ")}</span></> : "Tidak ada tagihan dalam 30 hari"}
            action={<Link href="/credit" className="text-link">Kredit</Link>} />
          <Kpi title="Piutang belum kembali" icon={HandCoins} tone="warning" value={money(receivables.totalMinor)} valueTone={toneOf(receivables.totalMinor)}
            note={receivables.openCount ? <><span className="ui-chip">{receivables.openCount} akun</span> Menunggu pelunasan</> : "Tidak ada piutang terbuka"}
            action={<Link href="/credit" className="text-link">Talangan</Link>} />
        </div>
      </HomeKpiCarousel>
      <div className="ui-notices">
        {entry.unpricedCount > 0 && <p className="ui-notice" data-tone="warning">{entry.unpricedCount} posisi tanpa harga belum termasuk. <Link href="/assets/investments">Lihat investasi</Link></p>}
        {planningReady && BigInt(entry.uncoveredMinor) > 0n && <p className="ui-notice" data-tone="warning">Kewajiban belum tercakup cadangan: <Amount value={money(entry.uncoveredMinor)} />, s.d. {horizon}.</p>}
        {planningReady && BigInt(entry.availableMinor) < 0n && <p className="ui-notice" data-tone="negative">Dana siap pakai negatif: kewajiban 30 hari melebihi saldo yang bebas.</p>}
      </div>
    </div>;
  });

  const primary = currencies[0];
  const summary = <div className="home-grid">
    <div className="home-main">
      {primary && <HomeTrend report={analytics} currency={primary.currency} exponent={primary.exponent} expenseMinor={primary.expenseMinor} />}
      <RecentActivity recent={recent} />
    </div>
    <div className="home-side">
      <HomeAutomationConfirmations items={snapshot.pendingAutomations ?? []} limit={3} />
      {currencies.map((entry) => <DueBills key={entry.currency} snapshot={snapshot} entry={entry} horizon={horizon} />)}
      <Accounts assets={assets} />
      <Investments investment={investment} />
      {primary && <HomeComposition report={analytics} currency={primary.currency} />}
    </div>
  </div>;

  const details = <div className="home-details">
    {currencies.map((entry) => {
      const money = (value: string | bigint) => formatMinor(value, entry.currency, entry.exponent);
      const parts = netWorthComponents(assets, investment.totals.map((total) => ({ ...total })), entry.currency);
      const optional = (label: string, value: bigint, hint?: string) => (value !== 0n ? [{ label, value: money(value), hint }] : []);
      return <div className="ui-split" key={entry.currency}>
        <Breakdown title={`Komponen kekayaan bersih · ${entry.currency}`} rows={[
          { label: "Kas & rekening likuid", value: money(parts.cashMinor) },
          ...optional("Aset tidak likuid atau diarsipkan", parts.otherAssetsMinor),
          ...optional("Investasi (nilai pasar)", parts.investmentsMinor, entry.unpricedCount ? `${entry.unpricedCount} posisi tanpa harga tidak terhitung` : undefined),
          ...optional("Piutang", parts.receivablesMinor),
          ...optional("Kelebihan bayar kredit", parts.overpaidCreditMinor),
          { label: "Seluruh kewajiban kredit", value: money(parts.liabilitiesMinor), sign: "minus" as const, hint: "Termasuk cicilan bulan-bulan berikutnya" },
        ]} total={{ label: "Kekayaan bersih", value: money(parts.netWorthMinor), tone: toneOf(parts.netWorthMinor) }} />
        <Breakdown title={`Rumus dana siap pakai · ${entry.currency}`} rows={planningReady ? [
          { label: "Saldo akun yang dapat dipakai", value: money(entry.eligibleMinor), hint: "Akun aktif bertanda dapat dipakai belanja" },
          { label: "Cadangan aktif", value: money(entry.reservedMinor), sign: "minus" as const },
          { label: `Kewajiban & tagihan s.d. ${horizon} yang belum tercakup`, value: money(entry.uncoveredMinor), sign: "minus" as const, hint: `Total kewajiban ${money(entry.dueMinor)}, tercakup cadangan ${money(entry.coveredMinor)}` },
        ] : [{ label: "Saldo akun yang dapat dipakai", value: money(entry.eligibleMinor), hint: "Cadangan dan kewajiban dihitung setelah Rencana diaktifkan" }]}
          total={{ label: "Dana siap pakai", value: money(planningReady ? entry.availableMinor : entry.spendableMinor), tone: toneOf(BigInt(planningReady ? entry.availableMinor : entry.spendableMinor)) }} />
      </div>;
    })}
    <p className="ui-muted home-reading">Saldo dihitung dari saldo awal dan seluruh mutasi yang tercatat. Pembelian cicilan sudah dibukukan penuh, jadi kewajiban kredit memuat cicilan yang belum jatuh tempo. Grafik memakai periode enam bulan terpisah dari posisi saat ini.</p>
  </div>;

  return <div className="page home-page">
    <PageTabs label="Tampilan Beranda" heading={heading}
      shared={<div className="home-currencies">{kpis}</div>}
      tabs={[{ id: "ringkasan", label: "Ringkasan", panel: summary }, { id: "rincian", label: "Rincian kalkulasi", panel: details }]} />
  </div>;
}
