"use client";

import { activityValueMinor } from "@/lib/record-values";
import { useActivityPage } from "./activity-page";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useRef, useState } from "react";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { ArrowRight, FileArrowUp, X } from "@phosphor-icons/react";
import { financeRequest } from "@/lib/finance/client";
import { formatMinor } from "@/lib/finance/format";
import type { FinanceActivity } from "@/lib/finance/types";
import { ExportMenuButton } from "./export-menu-button";
import { FinancialDataTable } from "./financial-data-table";
import { ListToolbar } from "./list-toolbar";
import { ListContent } from './list-content';
import { ListFilterControl } from "./list-filter-control";
import { MoneyMovementRow } from "./money-movement-row";
import { TransactionEditor } from "./transaction-editor";
import { AppLink } from "./app-link";

const labels = { income: "Pemasukan", expense: "Pengeluaran", transfer: "Transfer" };
function totalMinor(item: FinanceActivity) {
  return (BigInt(item.baseAmountMinor) + item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n)).toString();
}
export function TransactionsView({ activities, monthly }: { activities: FinanceActivity[]; monthly: { currency: string; exponent: number; expenseMinor: string }[] }) {
  const { refresh, notify, refreshing } = useFinanceFeedback();
  const [filter, setFilter] = useState<"all" | FinanceActivity["kind"]>("all");
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState<FinanceActivity | null>(null);
  const [editing, setEditing] = useState<FinanceActivity | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState("");
  const { pending, begin, finish } = useMutationPending();
  const sort = useListSort("transactions");
  const replay = useRef<{ id: string; key: string } | null>(null);
  const activityPage=useActivityPage(activities,filter,history,sort.direction);
  const shown=activityPage.items;
  function openDetails(item: FinanceActivity) {
    if (refreshing) return;
    setSelected(item); setError(""); setConfirmVoid(false);
  }
  async function remove() {
    if (!selected || refreshing || !begin()) return;
    setError("");
    try {
      if (replay.current?.id !== selected.id) replay.current = { id: selected.id, key: crypto.randomUUID() };
      await financeRequest("void", { id: selected.id, idempotencyKey: replay.current.key });
      setSelected(null); setConfirmVoid(false); refresh(); notify("Transaksi berhasil dibatalkan."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Pembatalan gagal."); }
    finally { finish(); }
  }
  return <div className="page"><div className="page-heading"><div><span className="eyebrow">CATATAN UANG</span><h1>Transactions</h1>
    <p>Aktivitas tersimpan, dengan jumlah dasar dan biaya yang terpisah.</p></div><div className="transactions-header-actions"><AppLink href="/transactions/imports" className="finance-edit-button transactions-import-trigger"><FileArrowUp size={16} /> Impor CSV/Excel</AppLink><AppLink href="/transactions/automation" className="text-link automation-entry">Otomatisasi <ArrowRight size={16} /></AppLink></div></div>
    <div className="summary-strip"><div><span>Pengeluaran bulan ini</span><strong>{monthly.length ? monthly.map((item) => formatMinor(item.expenseMinor, item.currency, item.exponent)).join(" · ") : "—"}</strong></div>
      <div><span>Aktivitas pada halaman</span><strong>{shown.length}</strong></div></div>
    <section className="surface"><div className="section-heading"><div><span className="eyebrow">RIWAYAT TERCATAT</span><h2>Aktivitas terakhir</h2></div></div>
      <ListToolbar label="Filter dan urutan transaksi"
        visibility={<><label className="finance-history-toggle"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> Tampilkan koreksi & pembatalan</label><ExportMenuButton dataset="transactions" label="Ekspor Mutasi" /></>}>
        <ListFilterControl value={filter} onChange={setFilter} label="Jenis" options={[{value:"all",label:"Semua"},{value:"expense",label:"Pengeluaran"},{value:"income",label:"Pemasukan"},{value:"transfer",label:"Transfer"}]} />
        <ListSortControl {...sort} />
      </ListToolbar>
      <ListContent loading={activityPage.loading} error={activityPage.error} hasItems={shown.length>0} onRetry={activityPage.retry}
        empty={activities.length?'Tidak ada transaksi pada filter ini.':'Belum ada transaksi. Gunakan Tambah transaksi untuk mulai mencatat.'}>
      {shown.length>0 && (
        <FinancialDataTable label="Riwayat transaksi" records={shown} identity={item => item.id} rowAction={{onActivate:openDetails,disabled:refreshing}} columns={[
          {key:"date",heading:"Tanggal",render:item=><time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</time>},
          {key:"activity",heading:"Aktivitas",render:item=><><button type="button" className="record-title-button" disabled={refreshing} aria-haspopup="dialog" aria-label={`Buka rincian transaksi: ${item.note || labels[item.kind]}`} onClick={()=>openDetails(item)}>{item.note || labels[item.kind]}</button><small data-kind={item.kind}>{labels[item.kind]}</small></>},
          {key:"asset",heading:"Akun / aset",render:item=><>{item.kind==="transfer" ? <>{item.sourceName} → {item.destinationName}</> : item.sourceName || item.destinationName}{item.categoryName&&<small>{item.categoryName}</small>}</>},
          {key:"origin",heading:"Asal",secondary:true,render:item=><span className="record-muted">{item.recurringRuleName ? <>Otomatisasi<small>{item.recurringRuleName}</small></> : "Manual"}</span>},
          {key:"amount",heading:"Nominal",numeric:true,render:item=><><strong className="financial-value financial-value--row" data-kind={item.kind}>{item.kind==="expense"?"−":item.kind==="income"?"+":""}{formatMinor(activityValueMinor(item),item.currency,item.exponent)}</strong>{item.charges.length>0&&<small>{item.kind==="transfer"?"Biaya "+formatMinor(item.charges.reduce((n,c)=>n+BigInt(c.amountMinor),0n).toString(),item.currency,item.exponent):"Termasuk biaya tambahan"}</small>}</>},
          {key:"status",heading:"Status",render:item=><small>{item.status==="posted"?"Aktif":item.status==="voided"?"Dibatalkan":"Dikoreksi"}</small>},
        ]} compact={item=><button type="button" className="transaction-button" key={item.id} disabled={refreshing} onClick={() => openDetails(item)}>
            <MoneyMovementRow kind={item.kind} title={item.note || labels[item.kind]}
              context={`${item.categoryName || labels[item.kind]} · ${item.kind === "transfer" ? `${item.sourceName} → ${item.destinationName}` : item.sourceName || item.destinationName}`} provenance={item.recurringRuleName}
              compactContext={item.kind === "transfer" ? `${item.sourceName} → ${item.destinationName}` : item.sourceName || item.destinationName}
              status={item.status !== "posted" ? item.status === "voided" ? "Dibatalkan" : "Dikoreksi" : undefined}
              amount={`${item.kind === "expense" ? "−" : item.kind === "income" ? "+" : ""}${formatMinor(activityValueMinor(item), item.currency, item.exponent)}`}
              date={new Date(item.occurredAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              fee={item.kind === "transfer" && item.charges[0] ? `Biaya ${formatMinor(item.charges[0].amountMinor, item.currency, item.exponent)}` : undefined} />
          </button>} />)}
      </ListContent>
      <ListToolbar label="Halaman transaksi"><button type="button" className="row-action" disabled={activityPage.loading||activityPage.pageNumber===1} onClick={activityPage.previous}>Sebelumnya</button><span className="record-muted">Halaman {activityPage.pageNumber}</span><button type="button" className="row-action" disabled={activityPage.loading||!activityPage.hasNext} onClick={activityPage.next}>Berikutnya</button></ListToolbar></section>

    <details className="context-help"><summary>Tentang riwayat transaksi</summary><p className="supporting-prose supporting-prose--section">Koreksi dan pembatalan tetap ada dalam riwayat dan dibalik di ledger.</p></details>
    {selected && <div className="dialog-backdrop" onMouseDown={(event) => { if (!pending && event.target === event.currentTarget) setSelected(null); }}>
      <section className="detail-dialog finance-detail" role="dialog" aria-modal="true" aria-busy={pending} aria-labelledby="finance-detail-title" onKeyDown={(event) => { if (!pending && event.key === "Escape") setSelected(null); }}>
        <div className="dialog-heading"><div><span className="eyebrow">RINCIAN TRANSAKSI</span><h2 id="finance-detail-title">{selected.note || labels[selected.kind]}</h2></div>
          <button type="button" className="icon-button" disabled={pending} onClick={() => setSelected(null)} aria-label="Tutup rincian"><X size={20} /></button></div>
        <dl className="detail-list"><div><dt>Status</dt><dd>{selected.status === "posted" ? "Aktif" : selected.status === "voided" ? "Dibatalkan" : "Diganti oleh koreksi"}</dd></div>
          <div><dt>Jenis</dt><dd>{labels[selected.kind]}</dd></div>
          {selected.recurringRuleName && <div><dt>Asal</dt><dd>Otomatisasi: {selected.recurringRuleName}</dd></div>}
          {selected.allocationAdjustmentId && <div><dt>Penyesuaian alokasi</dt><dd>Transaksi tambahan dari peninjauan pemasukan. Transaksi awal tetap tersimpan; hasil ini mengikuti alur koreksi dan pembatalan biasa.</dd></div>}
          {(selected.eventSourceIncomeId || selected.automationSourceActivityId) && <div><dt>Dipicu oleh</dt><dd>{labels[selected.automationSourceKind ?? "income"]} {selected.eventSourceAmountMinor ? formatMinor(selected.eventSourceAmountMinor,selected.eventSourceCurrency ?? selected.currency,selected.eventSourceExponent??selected.exponent) : ""} · {selected.eventSourceOccurredAt ? new Date(selected.eventSourceOccurredAt).toLocaleString("id-ID") : ""}</dd></div>}
          {selected.sourceName && <div><dt>Dari</dt><dd>{selected.sourceName}</dd></div>}
          {selected.destinationName && <div><dt>Ke</dt><dd>{selected.destinationName}</dd></div>}
          {selected.categoryName && <div><dt>Kategori</dt><dd>{selected.categoryName}</dd></div>}
          <div><dt>Waktu</dt><dd>{new Date(selected.occurredAt).toLocaleString("id-ID")}</dd></div>
          <div><dt>Jumlah dasar</dt><dd>{formatMinor(selected.baseAmountMinor, selected.currency, selected.exponent)}</dd></div>
          {selected.charges.map((charge) => <div key={charge.id}><dt>{charge.typeName}</dt><dd>{formatMinor(charge.amountMinor, selected.currency, selected.exponent)}</dd></div>)}
          <div className="detail-total"><dt>{selected.kind === "transfer" ? "Pokok + biaya" : "Total"}</dt><dd>{formatMinor(totalMinor(selected), selected.currency, selected.exponent)}</dd></div></dl>
        {selected.kind === "transfer" && <p className="finance-hint">Pokok transfer berpindah antar aset tanpa mengubah total. Hanya biayanya mengurangi total.</p>}
        {selected.status === "posted" && <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => { setEditing(selected); setSelected(null); }}>Koreksi</button>
          <button type="button" className="finance-danger" disabled={pending} onClick={() => setConfirmVoid(true)}>Batalkan transaksi</button></div>}
        {confirmVoid && <div className="finance-confirm"><p>Batalkan transaksi ini? Semua pergerakannya akan dibalik. Catatan asli tetap ada dalam riwayat.</p>
          <button type="button" className="finance-danger" onClick={remove} disabled={pending} aria-busy={pending}>{pending ? <LoadingIndicator>Membatalkan…</LoadingIndicator> : "Ya, batalkan"}</button>
          <button type="button" className="finance-secondary" onClick={() => setConfirmVoid(false)} disabled={pending}>Kembali</button></div>}
        {error && <p role="alert" className="finance-error">{error}</p>}</section></div>}
    {editing && <TransactionEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} />}
  </div>;
}
