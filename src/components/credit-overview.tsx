"use client";

import { useState } from "react";
import { AppLink as Link } from "./app-link";
import { ArrowRight, CalendarDots, CreditCard, Gauge, HandCoins } from "@phosphor-icons/react/dist/ssr";
import type { financeSnapshot } from "@/lib/finance/summary";
import type { FinanceAsset } from "@/lib/finance/types";
import { formatMinor } from "@/lib/finance/format";
import { sortNamed } from "@/lib/list-order";
import { creditBillsDue, receivablesSummary } from "@/lib/domain/home-briefing";
import { billPayment, creditFacilities, creditTotals, installmentContracts, receivableAccounts, type CreditFacility } from "@/lib/domain/credit-overview";
import { AssetDetail, CreditDetail, creditStatusLabel } from "./entity-details";
import { Amount, Card, Chip, Kpi, PageHeading, monthLabel, shortDate, toneOf } from "./ui";
import { InspectorRow, InspectorRowButton } from "./inspector";
import { PageTabs } from "./page-tabs";
import { PayBillButton, RepayDebtButton, SettleReceivableButton } from "./pay-bill-button";
import { ICON_SM } from "./icon-size";

type Snapshot = Awaited<ReturnType<typeof financeSnapshot>>;

const provider = (asset: FinanceAsset) => asset.providerName ?? asset.assetTypeName;

function FacilityCard({ facility }: { facility: CreditFacility }) {
  const { asset, bills, status } = facility;
  const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
  const state = creditStatusLabel[status];
  const payment = billPayment(facility);
  const used = bills.limitMinor > 0n ? Number((bills.totalUnpaidMinor * 1000n) / bills.limitMinor) / 10 : null;
  return <InspectorRow as="div" id={`credit:${asset.id}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} link={false} />} className="ui-card credit-facility">
    <header className="credit-facility-header">
      <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{provider(asset)}</small></div>
      <Chip tone={state.tone}>{state.label}</Chip>
    </header>
    <p className="credit-facility-cycle">Cetak tgl {bills.cutoffDay} · Jatuh tempo tgl {bills.dueDay}</p>
    {bills.availableLimitMinor !== null && used !== null && <div className="credit-facility-limit">
      <div><span>Sisa limit</span><Amount value={money(bills.availableLimitMinor)} level="entity" /></div>
      <div className="ui-meter" data-tone={used >= 90 ? "negative" : undefined} role="img" aria-label={`Terpakai ${used.toLocaleString("id-ID")}% dari limit`}><span style={{ width: `${Math.min(100, used)}%` }} /></div>
      <small>Limit <Amount value={money(bills.limitMinor)} /></small>
    </div>}
    <dl className="credit-facility-bills">
      <div><dt>Tagihan Periode Berjalan ({shortDate(bills.currentDueIso)})</dt><dd><Amount value={money(bills.currentBillMinor)} level="entity" tone={bills.currentBillMinor > 0n ? "negative" : ""} /></dd></div>
      <div><dt>Periode Berikutnya ({shortDate(bills.nextDueIso)})</dt><dd><Amount value={money(bills.nextBillMinor)} level="entity" /></dd></div>
    </dl>
    {(payment || (asset.isActive && bills.totalUnpaidMinor > 0n)) && <div className="credit-facility-actions">
      {payment && <PayBillButton assetId={asset.id} name={asset.displayName} exponent={asset.exponent}
        amountMinor={payment.amountMinor.toString()} dueIso={payment.dueIso} />}
      {asset.isActive && bills.totalUnpaidMinor > 0n && <RepayDebtButton assetId={asset.id} name={asset.displayName} exponent={asset.exponent}
        amountMinor={bills.totalUnpaidMinor.toString()} />}
    </div>}
    <footer className="credit-facility-footer">
      <span>{bills.overpaidMinor > 0n ? "Lebih bayar" : "Sisa seluruh utang"}</span>
      <Amount value={money(bills.overpaidMinor > 0n ? bills.overpaidMinor : bills.totalUnpaidMinor)} tone={bills.overpaidMinor > 0n ? "positive" : bills.totalUnpaidMinor > 0n ? "negative" : ""} />
    </footer>
  </InspectorRow>;
}

function Facilities({ facilities }: { facilities: CreditFacility[] }) {
  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const active = facilities.filter((item) => item.asset.isActive), archived = facilities.filter((item) => !item.asset.isActive);
  if (!facilities.length) return <section className="ui-card ui-empty"><h2>Belum ada akun kredit</h2>
    <p>Tambahkan kartu kredit atau PayLater di Aset dengan klasifikasi Kewajiban. Tagihan dan cicilannya muncul di sini.</p>
    <Link href="/assets" className="button-primary">Buka Aset</Link></section>;
  return <div className="credit-stack">
    <div className="credit-toolbar">
      <div className="view-mode-toggle" role="group" aria-label="Mode tampilan kredit">
        <button
          type="button"
          className={`view-mode-btn ${viewMode === "card" ? "view-mode-btn--active" : ""}`}
          onClick={() => setViewMode("card")}
        >
          Kartu
        </button>
        <button
          type="button"
          className={`view-mode-btn ${viewMode === "table" ? "view-mode-btn--active" : ""}`}
          onClick={() => setViewMode("table")}
        >
          Tabel
        </button>
      </div>
    </div>
    {viewMode === "card" ? (
      <div className="credit-grid">{active.map((facility) => <FacilityCard key={facility.asset.id} facility={facility} />)}</div>
    ) : (
      <Card title="Fasilitas kredit aktif" meta={`${active.length} fasilitas`}>
        <div className="credit-contract-head" aria-hidden="true">
          <span>Fasilitas</span><span>Jatuh tempo</span><span>Sisa limit</span><span>Tagihan berjalan</span><span>Total utang</span>
        </div>
        <ul className="ui-rows">
          {active.map(({ asset, bills }) => (
            <InspectorRow key={asset.id} id={`credit:${asset.id}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} link={false} />} className="credit-contract-row">
              <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{provider(asset)}</small></div>
              <span className="credit-contract-tenor">Tgl {bills.dueDay}</span>
              <span>{bills.availableLimitMinor !== null ? formatMinor(bills.availableLimitMinor, asset.currency, asset.exponent) : "—"}</span>
              <Amount value={formatMinor(bills.currentBillMinor, asset.currency, asset.exponent)} tone={bills.currentBillMinor > 0n ? "negative" : ""} />
              <Amount value={formatMinor(bills.totalUnpaidMinor, asset.currency, asset.exponent)} level="entity" tone={bills.totalUnpaidMinor > 0n ? "negative" : ""} />
            </InspectorRow>
          ))}
        </ul>
      </Card>
    )}
    {archived.length > 0 && <Card title="Diarsipkan" meta="Sisa utangnya tetap dihitung sebagai kewajiban">
      <ul className="ui-rows">{archived.map(({ asset, bills }) => <InspectorRow key={asset.id} id={`credit:${asset.id}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} link={false} />} className="ui-row">
        <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{provider(asset)}</small></div>
        <Amount value={formatMinor(bills.totalUnpaidMinor, asset.currency, asset.exponent)} tone={bills.totalUnpaidMinor > 0n ? "negative" : ""} />
      </InspectorRow>)}</ul>
    </Card>}
  </div>;
}

function Installments({ facilities }: { facilities: CreditFacility[] }) {
  const contracts = facilities.flatMap((facility) => installmentContracts(facility.asset).map((contract) => ({ facility, contract })));
  if (!contracts.length) return <section className="ui-card ui-empty"><h2>Belum ada cicilan terjadwal</h2>
    <p>Pembelian cicilan dari Catat (Pengeluaran dari akun kredit, dengan tenor) membuat jadwal di sini. Seluruh pokok dan bunganya sudah dibukukan saat pembelian.</p></section>;
  return <Card title="Kontrak cicilan" meta={`${contracts.length} kontrak`}>
    <div className="credit-contract-head" aria-hidden="true"><span>Fasilitas</span><span>Tenor</span><span>Periode</span><span>Per bulan</span><span>Total</span></div>
    <ul className="ui-rows">{contracts.map(({ facility, contract }) => {
      const { asset } = facility;
      const money = (value: bigint) => formatMinor(value, asset.currency, asset.exponent);
      return <InspectorRow key={`${asset.id}:${contract.activityId}`} id={`credit:${asset.id}`} title={asset.displayName} subtitle="Rincian fasilitas kredit" detail={<CreditDetail asset={asset} link={false} />} className="credit-contract-row">
        <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{contract.upcomingCount ? `${contract.upcomingCount} bulan tersisa di jadwal` : "Seluruh bulan sudah lewat"}</small></div>
        <span className="credit-contract-tenor">{contract.count} bulan</span>
        <span className="credit-contract-period">{monthLabel(contract.firstPeriod)} – {monthLabel(contract.lastPeriod)}</span>
        <Amount value={money(contract.monthlyMinor)} />
        <Amount value={money(contract.totalMinor)} level="entity" />
      </InspectorRow>;
    })}</ul>
    <p className="ui-muted ui-card-body credit-note">Status bayar tiap bulan dihitung dari saldo akun kredit, bukan dari jadwal.</p>
  </Card>;
}

function Receivables({ assets, currencies }: { assets: FinanceAsset[]; currencies: string[] }) {
  const lists = currencies.map((currency) => ({ currency, items: receivableAccounts(assets, currency), summary: receivablesSummary(assets, currency) })).filter((list) => list.items.length);
  if (!lists.length) return <section className="ui-card ui-empty"><h2>Belum ada piutang</h2>
    <p>Split bill dari Catat membuat akun piutang untuk bagian teman. Pinjaman ke orang lain dicatat sebagai akun Aset berklasifikasi Piutang.</p></section>;
  return <div className="credit-stack">{lists.map(({ currency, items, summary }) => {
    const exponent = items[0]?.asset.exponent ?? 0;
    return <Card key={currency} title={`Piutang & talangan · ${currency}`} meta={`${summary.openCount} terbuka · ${formatMinor(summary.totalMinor, currency, exponent)}`}>
      <ul className="ui-rows">{items.map(({ asset, status }) => <InspectorRow key={asset.id} id={`asset:${asset.id}`} title={asset.displayName} subtitle="Rincian piutang" detail={<AssetDetail asset={asset} />} className="ui-row">
        <div className="ui-row-copy"><InspectorRowButton><strong>{asset.displayName}</strong></InspectorRowButton><small>{[provider(asset), asset.isActive ? null : "Diarsipkan"].filter(Boolean).join(" · ")}</small></div>
        <Chip tone={status === "lunas" ? "positive" : "warning"}>{status === "lunas" ? "Lunas" : "Menunggu"}</Chip>
        <Amount value={formatMinor(asset.balanceMinor, asset.currency, asset.exponent)} tone={toneOf(BigInt(asset.balanceMinor))} />
        {asset.isActive && BigInt(asset.balanceMinor) > 0n && <SettleReceivableButton assetId={asset.id} name={asset.displayName} exponent={asset.exponent} amountMinor={asset.balanceMinor} />}
      </InspectorRow>)}</ul>
    </Card>;
  })}</div>;
}

export function CreditOverview({ snapshot }: { snapshot: Snapshot }) {
  const { assets, throughDay } = snapshot;
  const facilities = creditFacilities(assets);
  const horizon = shortDate(throughDay);
  const relevant = sortNamed(snapshot.currencies, (entry) => entry.currency, (entry) => entry.currency)
    .filter((entry) => facilities.some((item) => item.asset.currency === entry.currency) || receivablesSummary(assets, entry.currency).totalMinor !== 0n || assets.some((asset) => asset.currency === entry.currency && asset.assetClass === "receivable"));
  const heading = <PageHeading title="Kredit & Talangan"
    actions={<Link href="/assets" className="text-link">Kelola akun di Aset <ArrowRight size={ICON_SM} aria-hidden="true" /></Link>} />;

  const kpis = <div className="credit-currencies">{relevant.map((entry) => {
    const money = (value: string | bigint) => formatMinor(value, entry.currency, entry.exponent);
    const totals = creditTotals(assets, entry.currency, throughDay);
    const nearest = creditBillsDue(assets, entry.currency, throughDay).nearest;
    const receivables = receivablesSummary(assets, entry.currency);
    return <div className="ui-kpis" key={entry.currency} aria-label={`Ringkasan kredit ${entry.currency}`}>
      <Kpi title="Sisa seluruh utang" icon={CreditCard} tone="negative" value={money(entry.liabilitiesMinor)}
        note={<>{totals.facilityCount} fasilitas · termasuk cicilan nanti · {entry.currency}</>} />
      <Kpi title={`Tagihan s.d. ${horizon}`} icon={CalendarDots} tone="warning" value={money(entry.creditDebtMinor)}
        note={nearest ? <><Chip>{shortDate(nearest.dueIso)}</Chip> <span className="ui-kpi-names">{nearest.names.join(", ")}</span></> : "Tidak ada tagihan dalam 30 hari"} />
      <Kpi title="Sisa limit" icon={Gauge} tone="info" value={money(totals.availableLimitMinor)}
        note={totals.limitKnownCount ? `Dari ${totals.limitKnownCount} fasilitas aktif yang mencatat limit` : "Limit belum dicatat di akun kredit"} />
      <Kpi title="Piutang terbuka" icon={HandCoins} tone="positive" value={money(receivables.totalMinor)} valueTone={toneOf(receivables.totalMinor)}
        note={receivables.openCount ? <><Chip tone="warning">{receivables.openCount} akun</Chip> Menunggu pelunasan</> : "Tidak ada piutang terbuka"} />
    </div>;
  })}</div>;

  return <div className="page credit-page">
    <PageTabs label="Tampilan Kredit & Talangan" heading={heading} shared={kpis}
      tabs={[
        { id: "kredit", label: "Kredit & PayLater", panel: <Facilities facilities={facilities} /> },
        { id: "cicilan", label: "Cicilan", panel: <Installments facilities={facilities} /> },
        { id: "piutang", label: "Piutang & talangan", panel: <Receivables assets={assets} currencies={relevant.map((entry) => entry.currency)} /> },
      ]} />
  </div>;
}
