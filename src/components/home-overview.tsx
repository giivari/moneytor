import { AppLink as Link } from "./app-link";
import { ArrowRight, ArrowDownLeft, ArrowUpRight, ArrowsLeftRight, CreditCard, HandCoins, Scales, Wallet } from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";
import type { IconProps } from "@phosphor-icons/react";
import type { financeSnapshot } from "@/lib/finance/summary";
import type { AnalyticsReport } from "@/lib/analytics/types";
import type { FinanceActivity, FinanceAsset } from "@/lib/finance/types";
import { formatMinor } from "@/lib/finance/format";
import { sortNamed } from "@/lib/list-order";
import { computeCreditBills, isCreditAsset, isReceivableAsset } from "@/lib/domain/credit";
import { creditBillsDue, netWorthComponents, receivablesSummary } from "@/lib/domain/home-briefing";
import { FinancialAmount } from "./financial-amount";
import { HomeComposition, HomeTrend } from "./home-analytics";
import { HomeAutomationConfirmations } from "./home-automation-confirmations";
import { HomeCard } from "./home-card";
import { InspectorRow, InspectorRowButton } from "./inspector";
import { InspectorFacts } from "./inspector-facts";
import { PageTabLink, PageTabs } from "./page-tabs";
import { ICON_SM } from "./icon-size";

type Snapshot = Awaited<ReturnType<typeof financeSnapshot>>;
type CurrencyEntry = Snapshot["currencies"][number];
type Tone = "positive" | "negative" | "";

const toneOf = (value: bigint): Tone => (value < 0n ? "negative" : "");
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00+07:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

function Amount({ value, level = "row", tone = "" }: { value: string; level?: "summary" | "entity" | "row" | "supporting"; tone?: Tone }) {
  return <FinancialAmount value={value} level={level} className={`home-amount${tone ? ` pnl-${tone}` : ""}`} />;
}

function Kpi({ title, icon: Icon, tone, value, valueTone = "", note, action }: {
  title: string; icon: ComponentType<IconProps>; tone: string; value: string; valueTone?: Tone; note: React.ReactNode; action?: React.ReactNode;
}) {
  return <section className="home-kpi" data-tone={tone}>
    <header><h2>{title}</h2><span className="home-kpi-icon" aria-hidden="true"><Icon size={ICON_SM} weight="bold" /></span></header>
    <Amount value={value} level="summary" tone={valueTone} />
    <div className="home-kpi-note">{note}</div>
    {action && <div className="home-kpi-action">{action}</div>}
  </section>;
}

function Breakdown({ title, rows, total }: { title: string; rows: { label: string; value: string; sign?: "minus"; hint?: string }[]; total: { label: string; value: string; tone: Tone } }) {
  return <HomeCard className="home-breakdown" title={title}>
    <dl className="home-breakdown-list">
      {rows.map((row) => <div key={row.label} data-sign={row.sign}>
        <dt>{row.sign === "minus" ? "Dikurangi: " : ""}{row.label}{row.hint && <small>{row.hint}</small>}</dt>
        <dd><Amount value={row.value} tone={row.sign === "minus" ? "negative" : ""} /></dd>
      </div>)}
      <div className="home-breakdown-total"><dt>{total.label}</dt><dd><Amount value={total.value} level="entity" tone={total.tone} /></dd></div>
    </dl>
  </HomeCard>;
}

function activityParts(item: FinanceActivity) {
  const charges = item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n);
  const total = item.kind === "transfer" ? BigInt(item.baseAmountMinor) : BigInt(item.baseAmountMinor) + charges;
  const sign = item.kind === "expense" ? "−" : item.kind === "income" ? "+" : "";
  const kind = item.kind === "income" ? "Pemasukan" : item.kind === "expense" ? "Pengeluaran" : "Transfer";
  const accounts = item.kind === "transfer" ? [item.sourceName, item.destinationName].filter(Boolean).join(" → ") : (item.sourceName || item.destinationName || "");
  return { total, sign, kind, accounts };
}

function ActivityDetail({ item }: { item: FinanceActivity }) {
  const money = (value: string | bigint) => formatMinor(value, item.currency, item.exponent);
  const { total, sign, kind, accounts } = activityParts(item);
  const occurred = new Date(item.occurredAt).toLocaleString("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" });
  return <>
    <InspectorFacts items={[
      { label: "Jenis", value: kind },
      { label: "Waktu", value: occurred },
      { label: item.kind === "transfer" ? "Alur rekening" : "Rekening", value: accounts || "—" },
      ...(item.categoryName ? [{ label: "Kategori", value: item.categoryName }] : []),
      ...(item.recurringRuleName ? [{ label: "Otomatisasi", value: item.recurringRuleName }] : []),
      { label: "Jumlah dasar", value: <Amount value={money(item.baseAmountMinor)} /> },
      ...item.charges.map((charge) => ({ label: charge.typeName, value: <Amount value={money(charge.amountMinor)} /> })),
      { label: item.kind === "transfer" ? "Dipindahkan" : "Total mutasi", value: <Amount value={`${sign}${money(total)}`} tone={item.kind === "expense" ? "negative" : item.kind === "income" ? "positive" : ""} /> },
    ]} />
    {item.note && <p className="inspector-note">{item.note}</p>}
    <Link href="/transactions" className="text-link">Buka di Mutasi <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>
  </>;
}

function RecentActivity({ recent }: { recent: FinanceActivity[] }) {
  return <HomeCard className="home-recent" title="Mutasi terakhir" action={<Link href="/transactions" className="text-link">Lihat semua <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!recent.length ? <p className="home-muted home-card-body">Belum ada transaksi tercatat.</p> : <>
      <div className="home-recent-head" aria-hidden="true"><span>Tanggal</span><span>Jenis</span><span>Keterangan</span><span>Total</span></div>
      <ul className="home-recent-list">{recent.slice(0, 6).map((item) => {
        const { total, sign, kind, accounts } = activityParts(item);
        const amount = `${sign}${formatMinor(total, item.currency, item.exponent)}`;
        const Icon = item.kind === "income" ? ArrowDownLeft : item.kind === "expense" ? ArrowUpRight : ArrowsLeftRight;
        const fee = item.kind === "transfer" && item.charges[0] ? `Biaya ${formatMinor(item.charges[0].amountMinor, item.currency, item.exponent)}` : null;
        const context = [accounts, item.recurringRuleName ? "Otomatisasi" : item.categoryName, fee].filter(Boolean).join(" · ");
        return <InspectorRow key={item.id} id={`activity:${item.id}`} title={item.note || kind} subtitle={`${kind} · ${shortDate(item.occurredAt)}`} detail={<ActivityDetail item={item} />} className="home-recent-row">
          <span className="home-recent-date">{shortDate(item.occurredAt)}</span>
          <span className={`home-kind home-kind--${item.kind}`}><Icon size={ICON_SM} aria-hidden="true" /><span>{kind}</span></span>
          <div className="home-recent-copy"><InspectorRowButton><strong>{item.note || kind}</strong></InspectorRowButton><small>{context}</small></div>
          <Amount value={amount} tone={item.kind === "expense" ? "negative" : item.kind === "income" ? "positive" : ""} />
        </InspectorRow>;
      })}</ul>
    </>}
  </HomeCard>;
}

function CreditDetail({ asset }: { asset: FinanceAsset }) {
  const bills = computeCreditBills(asset);
  const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
  return <>
    <InspectorFacts items={[
      { label: `Tagihan jatuh tempo ${shortDate(bills.currentDueIso)}`, value: <Amount value={money(bills.currentBillMinor)} /> },
      { label: `Tagihan ${shortDate(bills.nextDueIso)}`, value: <Amount value={money(bills.nextBillMinor)} /> },
      { label: "Cicilan bulan berikutnya", value: <Amount value={money(bills.laterBillMinor)} /> },
      { label: "Sisa seluruh utang", value: <Amount value={money(bills.totalUnpaidMinor)} tone={bills.totalUnpaidMinor > 0n ? "negative" : ""} /> },
      ...(bills.overpaidMinor > 0n ? [{ label: "Lebih bayar", value: <Amount value={money(bills.overpaidMinor)} tone="positive" /> }] : []),
      ...(bills.limitMinor > 0n ? [{ label: "Limit", value: <Amount value={money(bills.limitMinor)} /> }] : []),
      ...(bills.availableLimitMinor !== null ? [{ label: "Sisa limit", value: <Amount value={money(bills.availableLimitMinor)} /> }] : []),
      { label: "Tanggal cetak / jatuh tempo", value: `${bills.cutoffDay} / ${bills.dueDay} tiap bulan` },
    ]} />
    <Link href="/credit" className="text-link">Buka Kredit &amp; Talangan <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>
  </>;
}

function AssetDetail({ asset }: { asset: FinanceAsset }) {
  const money = (value: string) => formatMinor(value, asset.currency, asset.exponent);
  return <>
    <InspectorFacts items={[
      { label: "Jenis", value: [asset.assetTypeName, asset.providerName].filter(Boolean).join(" · ") },
      { label: "Klasifikasi", value: isReceivableAsset(asset) ? "Piutang" : "Aset" },
      { label: "Likuid", value: asset.normallyLiquid ? "Ya" : "Tidak" },
      { label: "Dapat dipakai belanja", value: asset.normallySpendable ? "Ya" : "Tidak" },
      { label: "Status", value: asset.isActive ? "Aktif" : "Diarsipkan" },
      { label: "Saldo awal", value: <Amount value={money(asset.openingMinor)} /> },
      { label: "Saldo saat ini", value: <Amount value={money(asset.balanceMinor)} tone={toneOf(BigInt(asset.balanceMinor))} /> },
    ]} />
    <Link href="/assets" className="text-link">Buka Aset <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>
  </>;
}

function DueBills({ snapshot, entry, horizon }: { snapshot: Snapshot; entry: CurrencyEntry; horizon: string }) {
  const { items } = creditBillsDue(snapshot.assets, entry.currency, snapshot.throughDay);
  const byId = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  return <HomeCard className="home-due" title="Jatuh tempo terdekat" meta={`S.d. ${horizon} · ${entry.currency}`}>
    {!items.length ? <p className="home-muted home-card-body">Tidak ada tagihan kredit dalam 30 hari.</p> : <ul className="home-row-list">{items.map((bill) => {
      const asset = byId.get(bill.assetId)!;
      return <InspectorRow key={`${bill.assetId}:${bill.dueIso}`} id={`credit:${bill.assetId}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} />} className="home-row">
        <span className="home-date-chip">{shortDate(bill.dueIso)}</span>
        <div className="home-row-copy"><InspectorRowButton><strong>{bill.name}</strong></InspectorRowButton><small>{asset.providerName ?? asset.assetTypeName}</small></div>
        <Amount value={formatMinor(bill.amountMinor, entry.currency, entry.exponent)} />
      </InspectorRow>;
    })}</ul>}
  </HomeCard>;
}

function Accounts({ assets }: { assets: FinanceAsset[] }) {
  const accounts = assets.filter((asset) => asset.isActive && !isCreditAsset(asset)).slice(0, 5);
  return <HomeCard className="home-accounts" title="Akun &amp; aset" action={<Link href="/assets" className="text-link">Lihat semua <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!accounts.length ? <p className="home-muted home-card-body">{assets.some((asset) => !isCreditAsset(asset)) ? "Belum ada akun aktif. Akun yang diarsipkan tetap terhitung di Aset." : "Belum ada akun atau aset tercatat."}</p> : <ul className="home-row-list">{accounts.map((asset) => {
      const balance = formatMinor(asset.balanceMinor, asset.currency, asset.exponent);
      return <InspectorRow key={asset.id} id={`asset:${asset.id}`} title={asset.displayName} subtitle="Rincian rekening" detail={<AssetDetail asset={asset} />} className="home-row">
        <div className="home-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{[asset.providerName ?? asset.assetTypeName, isReceivableAsset(asset) ? "Piutang" : null].filter(Boolean).join(" · ")}</small></div>
        <Amount value={balance} tone={toneOf(BigInt(asset.balanceMinor))} />
      </InspectorRow>;
    })}</ul>}
  </HomeCard>;
}

function Investments({ investment }: { investment: Snapshot["investment"] }) {
  return <HomeCard className="home-investments" title="Investasi" action={<Link href="/assets/investments" className="text-link">Kelola <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>}>
    {!investment.totals.length ? <p className="home-muted home-card-body">Catat portofolio, posisi awal, atau transaksi investasi.</p> : <dl className="home-breakdown-list">
      {sortNamed(investment.totals, (total) => total.currency, (total) => total.currency).flatMap((total) => [
        <div key={`${total.currency}:market`}><dt>Nilai pasar · {total.currency}</dt><dd><Amount value={formatMinor(total.marketMinor, total.currency, total.exponent)} /></dd></div>,
        <div key={`${total.currency}:pnl`}><dt>Laba/rugi belum terealisasi{total.unpricedCount ? " · posisi berharga" : ""}</dt><dd><Amount value={formatMinor(total.unrealizedMinor, total.currency, total.exponent)} tone={BigInt(total.unrealizedMinor) < 0n ? "negative" : BigInt(total.unrealizedMinor) > 0n ? "positive" : ""} /></dd></div>,
        ...(total.unpricedCount ? [<p key={`${total.currency}:unpriced`} className="home-warning" data-tone="warning">{total.unpricedCount} posisi belum memiliki harga.</p>] : []),
      ])}
    </dl>}
  </HomeCard>;
}

export function HomeOverview({ snapshot, date, analytics = null }: { snapshot: Snapshot; date: string; analytics?: AnalyticsReport | null }) {
  const { assets, recent, investment, planningReady, throughDay } = snapshot;
  const currencies = sortNamed(snapshot.currencies, (entry) => entry.currency, (entry) => entry.currency);
  const horizon = shortDate(throughDay);
  const heading = <div className="page-heading-row"><div><h1>Beranda</h1><p>{date}</p></div></div>;
  if (!assets.length && !investment.hasHoldings) return <div className="page home-page">
    <header className="page-header">{heading}</header>
    <section className="home-card home-empty"><h2>Mulai dari aset pertama</h2>
      <p>Catat akun atau aset dan saldo awalnya untuk melihat posisi keuangan yang nyata di sini.</p>
      <Link href="/assets" className="button-primary">Tambah aset <ArrowRight size={ICON_SM} aria-hidden="true" /></Link></section>
  </div>;

  const kpis = currencies.map((entry) => {
    const money = (value: string | bigint) => formatMinor(value, entry.currency, entry.exponent);
    const nearest = creditBillsDue(assets, entry.currency, throughDay).nearest;
    const receivables = receivablesSummary(assets, entry.currency);
    const ready = planningReady ? BigInt(entry.availableMinor) : BigInt(entry.spendableMinor);
    return <div className="home-currency" key={entry.currency}>
      <div className="home-kpis" aria-label={`Ringkasan ${entry.currency}`}>
        <Kpi title="Kekayaan bersih" icon={Scales} tone="neutral" value={money(entry.netWorthMinor)} valueTone={toneOf(BigInt(entry.netWorthMinor))}
          note={<>Aset − seluruh kewajiban · {entry.currency}</>} action={<PageTabLink tab="rincian">Lihat rincian</PageTabLink>} />
        <Kpi title="Dana siap pakai" icon={Wallet} tone="info" value={money(ready)} valueTone={toneOf(ready)}
          note={planningReady ? <>Setelah cadangan &amp; kewajiban s.d. {horizon}</> : "Rencana belum diaktifkan"} action={<PageTabLink tab="rincian">Cara hitung</PageTabLink>} />
        <Kpi title="Tagihan kredit terdekat" icon={CreditCard} tone="negative" value={money(nearest?.amountMinor ?? 0n)}
          note={nearest ? <><span className="home-date-chip">{shortDate(nearest.dueIso)}</span> <span className="home-kpi-names">{nearest.names.join(", ")}</span></> : "Tidak ada tagihan dalam 30 hari"}
          action={<Link href="/credit" className="text-link">Kredit</Link>} />
        <Kpi title="Piutang belum kembali" icon={HandCoins} tone="warning" value={money(receivables.totalMinor)} valueTone={toneOf(receivables.totalMinor)}
          note={receivables.openCount ? <><span className="home-date-chip">{receivables.openCount} akun</span> Menunggu pelunasan</> : "Tidak ada piutang terbuka"}
          action={<Link href="/credit" className="text-link">Talangan</Link>} />
      </div>
      <div className="home-warnings">
        {entry.unpricedCount > 0 && <p className="home-warning" data-tone="warning">{entry.unpricedCount} posisi tanpa harga belum termasuk. <Link href="/assets/investments">Lihat investasi</Link></p>}
        {planningReady && BigInt(entry.uncoveredMinor) > 0n && <p className="home-warning" data-tone="warning">Kewajiban belum tercakup cadangan: <Amount value={money(entry.uncoveredMinor)} />, s.d. {horizon}.</p>}
        {planningReady && BigInt(entry.availableMinor) < 0n && <p className="home-warning" data-tone="negative">Dana siap pakai negatif: kewajiban 30 hari melebihi saldo yang bebas.</p>}
      </div>
    </div>;
  });

  const primary = currencies[0];
  const summary = <div className="home-grid">
    <div className="home-main">
      {primary && <HomeTrend report={analytics} currency={primary.currency} exponent={primary.exponent} />}
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
      return <div className="home-details-grid" key={entry.currency}>
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
    <p className="home-muted home-reading">Saldo dihitung dari saldo awal dan seluruh mutasi yang tercatat. Pembelian cicilan sudah dibukukan penuh, jadi kewajiban kredit memuat cicilan yang belum jatuh tempo. Grafik memakai periode enam bulan terpisah dari posisi saat ini.</p>
  </div>;

  return <div className="page home-page">
    <PageTabs label="Tampilan Beranda" heading={heading}
      shared={<div className="home-currencies">{kpis}</div>}
      tabs={[{ id: "ringkasan", label: "Ringkasan", panel: summary }, { id: "rincian", label: "Rincian kalkulasi", panel: details }]} />
  </div>;
}
