"use client";

import { activityValueMinor } from "@/lib/record-values";
import { useActivityPage } from "./activity-page";
import { useListSort } from "./use-list-sort";
import { ListSortControl } from "./list-sort-control";

import { useRef, useState } from "react";
import { useFinanceFeedback, useMutationPending } from "./finance-feedback";
import { LoadingIndicator } from "./loading-indicator";
import { ArrowRight, FileArrowUp, Receipt, Rows } from "@phosphor-icons/react";
import { financeRequest } from "@/lib/finance/client";
import { formatMinor, minorToInput } from "@/lib/finance/format";
import type { TransactionPreset } from "@/lib/domain/transaction-preset";
import type { FinanceActivity } from "@/lib/finance/types";
import { ExportMenuButton } from "./export-menu-button";
import { FinancialDataTable } from "./financial-data-table";
import { ListToolbar } from "./list-toolbar";
import { ListContent } from './list-content';
import { ListFilterControl } from "./list-filter-control";
import { MoneyMovementRow } from "./money-movement-row";
import { TransactionEditor } from "./transaction-editor";
import { AppLink } from "./app-link";
import { useInspector } from "./inspector";
import { Card, Kpi, PageHeading } from "./ui";
import { StatusBar } from "./status-bar";
import { ICON_SM } from "./icon-size";

const labels: Record<FinanceActivity["kind"], string> = {
  income: "Pemasukan",
  expense: "Pengeluaran",
  transfer: "Transfer",
  borrow: "Pinjam",
  repay: "Lunas",
  refund: "Refund",
  adjustment: "Koreksi",
};
const isFlowKind = (kind: FinanceActivity["kind"]) => kind === "transfer" || kind === "borrow" || kind === "repay";
const visualKind = (kind: FinanceActivity["kind"]) => (kind === "income" || kind === "expense" ? kind : "transfer");
const activityRouteText = (item: FinanceActivity) =>
  item.sourceName && item.destinationName ? `${item.sourceName} → ${item.destinationName}` : item.sourceName || item.destinationName || "";
const statusLabel = (item: FinanceActivity) => (item.status === "posted" ? "Aktif" : item.status === "voided" ? "Dibatalkan" : "Dikoreksi");
function describeCharges(item: FinanceActivity): string | undefined {
  const parts: string[] = [];
  if (item.charges.length) {
    const totalFee = item.charges.reduce((n, c) => n + BigInt(c.amountMinor), 0n);
    const formattedTotal = formatMinor(totalFee.toString(), item.currency, item.exponent);
    if (item.charges.length === 1) {
      const label = item.charges[0].typeName?.trim() || "Biaya tambahan";
      parts.push(isFlowKind(item.kind) ? `${label}: ${formattedTotal}` : `Termasuk ${label} ${formattedTotal}`);
    } else {
      const names = item.charges.map((c) => c.typeName?.trim() || "Biaya").join(" + ");
      parts.push(isFlowKind(item.kind) ? `${names}: ${formattedTotal}` : `Termasuk ${names} (${formattedTotal})`);
    }
  }
  if (item.refundedMinor && BigInt(item.refundedMinor) > 0n) {
    parts.push(`Di-refund ${formatMinor(item.refundedMinor, item.currency, item.exponent)} · Bersih ${formatMinor(item.netMinor ?? item.baseAmountMinor, item.currency, item.exponent)}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}
function totalMinor(item: FinanceActivity) {
  return (BigInt(item.baseAmountMinor) + item.charges.reduce((sum, charge) => sum + BigInt(charge.amountMinor), 0n)).toString();
}

/**
 * Inspector body for one activity. Correction opens the editor (a replacement); cancellation posts a void
 * (reversal movements). Both keep the original record, as the ledger is append-only.
 */
function ActivityInspector({
  item,
  onEdit,
  onRefund,
}: {
  item: FinanceActivity;
  onEdit: (item: FinanceActivity) => void;
  onRefund: (item: FinanceActivity) => void;
}) {
  const { refresh, notify } = useFinanceFeedback();
  const { close } = useInspector();
  const { pending, begin, finish } = useMutationPending();
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [error, setError] = useState("");
  const replay = useRef<string | null>(null);
  async function remove() {
    if (!begin()) return;
    setError("");
    try {
      replay.current ??= crypto.randomUUID();
      await financeRequest("void", { id: item.id, idempotencyKey: replay.current });
      close(); refresh(); notify("Transaksi berhasil dibatalkan.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Pembatalan gagal."); }
    finally { finish(); }
  }
  const money = (value: string) => formatMinor(value, item.currency, item.exponent);
  const canRefund = item.kind === "expense" && item.status === "posted" && BigInt(item.netMinor ?? item.baseAmountMinor) > 0n;
  return <div aria-busy={pending}>
    <dl className="inspector-facts">
      <div><dt>Status</dt><dd>{item.status === "posted" ? "Aktif" : item.status === "voided" ? "Dibatalkan" : "Diganti oleh koreksi"}</dd></div>
      <div><dt>Jenis</dt><dd>{labels[item.kind]}</dd></div>
      {item.adjustmentReason && <div><dt>Alasan koreksi</dt><dd>{item.adjustmentReason === "opening_debt" ? "Saldo awal utang" : "Rekonsiliasi saldo"}</dd></div>}
      {item.refundOfActivityId && <div><dt>Refund atas</dt><dd>{item.refundOfActivityId}</dd></div>}
      {item.recurringRuleName && <div><dt>Asal</dt><dd>Otomatisasi: {item.recurringRuleName}</dd></div>}
      {(item.eventSourceIncomeId || item.automationSourceActivityId) && <div><dt>Dipicu oleh</dt><dd>{labels[item.automationSourceKind ?? "income"]} {item.eventSourceAmountMinor ? formatMinor(item.eventSourceAmountMinor, item.eventSourceCurrency ?? item.currency, item.eventSourceExponent ?? item.exponent) : ""} · {item.eventSourceOccurredAt ? new Date(item.eventSourceOccurredAt).toLocaleString("id-ID") : ""}</dd></div>}
      {item.sourceName && <div><dt>Dari</dt><dd>{item.sourceName}</dd></div>}
      {item.destinationName && <div><dt>Ke</dt><dd>{item.destinationName}</dd></div>}
      {item.categoryName && <div><dt>Kategori</dt><dd>{item.categoryName}</dd></div>}
      <div><dt>Waktu</dt><dd>{new Date(item.occurredAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</dd></div>
      <div><dt>Jumlah dasar</dt><dd>{money(item.baseAmountMinor)}</dd></div>
      {item.charges.map((charge) => <div key={charge.id}><dt>{charge.typeName}</dt><dd>{money(charge.amountMinor)}</dd></div>)}
      <div className="detail-total"><dt>{isFlowKind(item.kind) ? "Pokok + biaya" : "Total"}</dt><dd>{money(totalMinor(item))}</dd></div>
      {item.refundedMinor && BigInt(item.refundedMinor) > 0n && (
        <>
          <div><dt>Di-refund</dt><dd>{money(item.refundedMinor)}</dd></div>
          <div><dt>Pengeluaran bersih</dt><dd>{money(item.netMinor ?? item.baseAmountMinor)}</dd></div>
        </>
      )}
    </dl>
    {item.allocationAdjustmentId && <p className="inspector-note">Penyesuaian alokasi: transaksi tambahan dari peninjauan pemasukan. Transaksi awal tetap tersimpan; hasil ini mengikuti alur koreksi dan pembatalan biasa.</p>}
    {item.note && <p className="inspector-note">{item.note}</p>}
    {isFlowKind(item.kind) && <p className="inspector-note ui-muted">Pokok berpindah antar akun tanpa mengubah total. Hanya biayanya mengurangi total.</p>}
    {item.status === "posted" && !confirmVoid && <div className="finance-actions"><button type="button" className="finance-secondary" disabled={pending} onClick={() => { close(); onEdit(item); }}>Koreksi</button>
      {canRefund && <button type="button" className="finance-secondary" disabled={pending} onClick={() => { close(); onRefund(item); }}>Catat refund</button>}
      <button type="button" className="finance-danger" disabled={pending} onClick={() => setConfirmVoid(true)}>Batalkan transaksi</button></div>}
    {confirmVoid && <div className="finance-confirm"><p>Batalkan transaksi ini? Semua pergerakannya akan dibalik. Catatan asli tetap ada dalam riwayat.</p>
      <button type="button" className="finance-danger" onClick={remove} disabled={pending} aria-busy={pending}>{pending ? <LoadingIndicator>Membatalkan…</LoadingIndicator> : "Ya, batalkan"}</button>
      <button type="button" className="finance-secondary" onClick={() => setConfirmVoid(false)} disabled={pending}>Kembali</button></div>}
    {error && <p role="alert" className="finance-error">{error}</p>}
  </div>;
}

export function TransactionsView({
  activities,
  monthly,
}: {
  activities: FinanceActivity[];
  monthly: { currency: string; exponent: number; expenseMinor: string }[];
}) {
  const { refreshing } = useFinanceFeedback();
  const { open } = useInspector();
  const [filter, setFilter] = useState<"all" | FinanceActivity["kind"]>("all");
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState<FinanceActivity | null>(null);
  const [refundPreset, setRefundPreset] = useState<TransactionPreset | null>(null);
  const sort = useListSort("transactions");
  const activityPage = useActivityPage(activities, filter, history, sort.direction);
  const shown = activityPage.items;
  function openRefund(item: FinanceActivity) {
    setRefundPreset({
      kind: "refund",
      refundOfActivityId: item.id,
      accountId: item.sourceAssetId ?? undefined,
      amount: minorToInput(item.netMinor ?? item.baseAmountMinor, item.exponent),
      note: item.note ? `Refund ${item.note}` : "Refund pengeluaran",
    });
  }
  function openDetails(item: FinanceActivity, trigger?: HTMLElement | null) {
    if (refreshing) return;
    const when = new Date(item.occurredAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
    open({ id: `activity:${item.id}`, title: item.note || labels[item.kind], subtitle: `${labels[item.kind]} · ${when} · ${statusLabel(item)}`,
      body: <ActivityInspector key={item.id} item={item} onEdit={setEditing} onRefund={openRefund} /> }, trigger ?? (document.activeElement as HTMLElement | null));
  }
  const spending = monthly.length
    ? monthly.map((item) => formatMinor(BigInt(item.expenseMinor) < 0n ? "0" : item.expenseMinor, item.currency, item.exponent)).join(" · ")
    : "—";
  const totalInMinor = shown
    .filter((t) => t.kind === "income" && t.status === "posted")
    .reduce((sum, t) => sum + BigInt(t.baseAmountMinor), 0n);
  const totalOutMinor = shown
    .filter((t) => t.kind === "expense" && t.status === "posted")
    .reduce((sum, t) => sum + BigInt(totalMinor(t)), 0n);
  const currency = shown[0]?.currency ?? "IDR";
  const exponent = shown[0]?.exponent ?? 0;
  return <div className="page transactions-page">
    <header className="page-header">
      <PageHeading title="Mutasi"
        description={`Total ${activities.length} aktivitas tercatat`}
        actions={<><AppLink href="/transactions/imports" className="finance-edit-button transactions-import-trigger"><FileArrowUp size={ICON_SM} /> Impor CSV/Excel</AppLink>
          <AppLink href="/transactions/automation" className="text-link automation-entry">Otomatisasi <ArrowRight size={ICON_SM} /></AppLink></>} />
    </header>
    <div className="ui-kpis transactions-kpis" data-columns="2">
      <Kpi title="Belanja bulan ini" icon={Receipt} tone="negative" value={spending} note="Pengeluaran termasuk biaya, per mata uang" />
      <Kpi title="Aktivitas di halaman ini" icon={Rows} tone="neutral" value={String(shown.length)} note={`Halaman ${activityPage.pageNumber}${history ? " · termasuk koreksi & pembatalan" : ""}`} />
    </div>
    <Card className="transactions-history" title="Riwayat mutasi" meta={filter === "all" ? "Semua jenis" : labels[filter]}
      action={<ExportMenuButton dataset="transactions" label="Ekspor Mutasi" />}>
      <div className="transactions-toolbar">
        <ListToolbar label="Filter dan urutan transaksi"
          visibility={<label className="finance-history-toggle"><input type="checkbox" checked={history} onChange={(event) => setHistory(event.target.checked)} /> Tampilkan koreksi & pembatalan</label>}>
          <ListFilterControl value={filter} onChange={setFilter} label="Jenis" options={[{ value: "all", label: "Semua" }, { value: "expense", label: "Pengeluaran" }, { value: "income", label: "Pemasukan" }, { value: "transfer", label: "Transfer" }, { value: "borrow", label: "Pinjam" }, { value: "repay", label: "Lunas" }, { value: "refund", label: "Refund" }, { value: "adjustment", label: "Koreksi" }]} />
          <ListSortControl {...sort} />
        </ListToolbar>
      </div>
      <ListContent loading={activityPage.loading} error={activityPage.error} hasItems={shown.length > 0} onRetry={activityPage.retry}
        empty={activities.length ? "Tidak ada transaksi pada filter ini." : "Belum ada transaksi. Gunakan Catat untuk mulai mencatat."}>
        {shown.length > 0 && (
          <FinancialDataTable label="Riwayat transaksi" records={shown} identity={(item) => item.id} rowAction={{ onActivate: (item) => openDetails(item), disabled: refreshing }} columns={[
            { key: "date", heading: "Tanggal", render: (item) => <time dateTime={item.occurredAt}>{new Date(item.occurredAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time> },
            { key: "activity", heading: "Aktivitas", render: (item) => <><button type="button" className="record-title-button" disabled={refreshing} aria-haspopup="dialog" aria-label={`Buka rincian transaksi: ${item.note || labels[item.kind]}`} onClick={(event) => openDetails(item, event.currentTarget)}>{item.note || labels[item.kind]}</button><small data-kind={visualKind(item.kind)}>{labels[item.kind]}</small></> },
            { key: "asset", heading: "Akun / aset", render: (item) => <>{activityRouteText(item)}{item.categoryName && <small>{item.categoryName}</small>}</> },
            { key: "origin", heading: "Asal", secondary: true, render: (item) => <span className="record-muted">{item.recurringRuleName ? <>Otomatisasi<small>{item.recurringRuleName}</small></> : "Manual"}</span> },
            { key: "amount", heading: "Nominal", numeric: true, render: (item) => { const feeText = describeCharges(item); return <><strong className="financial-value financial-value--row" data-kind={visualKind(item.kind)}>{item.kind === "expense" ? "−" : item.kind === "income" ? "+" : ""}{formatMinor(activityValueMinor(item), item.currency, item.exponent)}</strong>{feeText && <small>{feeText}</small>}</>; } },
            { key: "status", heading: "Status", render: (item) => <small>{statusLabel(item)}</small> },
          ]} compact={(item) => <button type="button" className="transaction-button" key={item.id} disabled={refreshing} onClick={(event) => openDetails(item, event.currentTarget)}>
            <MoneyMovementRow kind={item.kind} title={item.note || labels[item.kind]}
              context={`${item.categoryName || labels[item.kind]} · ${activityRouteText(item)}`} provenance={item.recurringRuleName}
              compactContext={activityRouteText(item)}
              status={item.status !== "posted" ? statusLabel(item) : undefined}
              amount={`${item.kind === "expense" ? "−" : item.kind === "income" ? "+" : ""}${formatMinor(activityValueMinor(item), item.currency, item.exponent)}`}
              date={new Date(item.occurredAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
              fee={describeCharges(item)} />
          </button>} />)}
      </ListContent>
      <div className="transactions-pager">
        <ListToolbar label="Halaman transaksi"><button type="button" className="row-action" disabled={activityPage.loading || activityPage.pageNumber === 1} onClick={activityPage.previous}>Sebelumnya</button><span className="record-muted">Halaman {activityPage.pageNumber}</span><button type="button" className="row-action" disabled={activityPage.loading || !activityPage.hasNext} onClick={activityPage.next}>Berikutnya</button></ListToolbar>
      </div>
    </Card>
    <StatusBar
      rowCount={shown.length}
      totalIn={formatMinor(totalInMinor.toString(), currency, exponent)}
      totalOut={formatMinor(totalOutMinor.toString(), currency, exponent)}
    />
    {editing && <TransactionEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} />}
    {refundPreset && <TransactionEditor key={`refund:${refundPreset.refundOfActivityId}`} preset={refundPreset} onClose={() => setRefundPreset(null)} />}
  </div>;
}
